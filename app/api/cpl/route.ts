import { NextResponse } from "next/server";
import { canAccessCompany } from "@/lib/permissions";
import { metaClient } from "@/lib/meta-client";
import { calcCPL, classifyCPL, getOfflineOrdersByMonth, getCplThresholds, saveCplThresholds, getCplReferenceAov } from "@/lib/cpl-calculator";
import { detectCompany } from "@/store/useAdsStore";
import { getCurrentUser } from "@/lib/auth";
import { callGemini } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditEntry, writeAuditSnapshot, computeDiff } from "@/lib/settings/audit";
import { validateCplConfig } from "@/lib/settings/validators/cpl";
import { validateRevenueTargets } from "@/lib/settings/validators/revenue";
import { guardEditThresholds } from "@/lib/settings/guards";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { isCompany } from "@/lib/companies/registry";

export const maxDuration = 60; // Up to 60s for insights

const REVENUE_TARGETS_FILE = path.join(process.cwd(), "data", "revenue-targets.json");

// Helper to get pixel conversions dynamically from Meta
function getPixelConversionsForCompany(actions: Array<{ action_type: string; value: string }> | null, company: string | null): number {
  if (!actions) return 0;
  
  // Rule from user:
  // MBC: purchase
  // MBI: complete_registration (also MBC)
  // 'omni_purchase' already aggregates web/app/offline purchase in Meta's
  // own taxonomy — summing it together with 'purchase' double-counts the
  // same conversion event. Use 'omni_purchase' (the superset) instead of
  // 'purchase' so cross-channel purchases are still captured without
  // double-counting the web-only subset.
  return actions
    .filter(a => ['omni_purchase', 'complete_registration'].includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || "0", 10), 0);
}

// GET ?month=2026-03 — returns campaign CPL data
// GET (no params) — returns revenue config (thresholds + targets)
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");

  // If no month provided, return the saved config for the settings page
  if (!month) {
    const thresholds = getCplThresholds();
    const targets = getRevenueTargets();
    return NextResponse.json({
      MBC: { monthly_target: targets.MBC.monthly_target, cpl: thresholds.MBC, referenceAov: getCplReferenceAov() },
      MBI: { monthly_target: targets.MBI.monthly_target, cpl: thresholds.MBI },
    });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);

  const startDay = new Date(year, m - 1, 1).toISOString().split("T")[0];
  const endDay = new Date(year, m, 0).toISOString().split("T")[0];

  try {
    // 1. Fetch campaigns
    const campaigns = await metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED"] });
    if (campaigns.length === 0) return NextResponse.json({ success: true, data: [] });

    // 2. Fetch insights
    const insights = await metaClient.getCampaignInsights(
      campaigns.map(c => c.id),
      { from: startDay, to: endDay }
    );

    // 3. Fetch offline orders
    const offlineOrders = getOfflineOrdersByMonth(month);

    // 4. Merge results
    const results = campaigns.map(c => {
      const insight = insights.find(i => i.campaign_id === c.id);
      const company = detectCompany(c.name, c.name); // Using simplified logic since accountName is not in raw payload right now
      
      const spend = insight ? parseFloat(insight.spend || "0") : 0;
      const pixelConv = insight ? getPixelConversionsForCompany(insight.actions, company) : 0;
      
      // Calculate offline for this campaign (Match by ID or Name)
      const cOfflineOrders = offlineOrders
        .filter(o => o.campaign_id === c.id || o.campaign_name === c.name)
        .reduce((sum, o) => sum + o.orders_count, 0);

      const computed = calcCPL(spend, pixelConv, cOfflineOrders);
      
      const classified = classifyCPL(computed.cpl, company);
      computed.level = classified.level;
      computed.label = classified.label;

      return {
        campaign_id: c.id,
        campaign_name: c.name,
        company,
        spend,
        cpl_data: computed,
        badge: classified // { level, emoji, label }
      };
    });

    // 5. Filter by user's accessible companies
    // canAccessCompany(role, …) chấm theo VAI TRÒ. Bản cũ chấm theo
    // user.companies — trường đó là PHẠM VI và đang mang ["ALL"] cho MỌI tài
    // khoản (kiểm data/team-members.json 16/09/2026, kể cả viewer_mbc), nên
    // mọi phép kiểm quyền công ty ở đây LUÔN ĐÚNG cho tất cả mọi người.
    const filteredResults = results.filter(r =>
      canAccessCompany(user, (r.company ?? "") as string)
    );

    return NextResponse.json({ success: true, data: filteredResults, thresholds: getCplThresholds() });
  } catch (err) {
    console.error("[CPL GET]", err);
    return NextResponse.json({ success: false, error: "System Error" }, { status: 500 });
  }
}

// POST for AI insight
// Audit 30/09: trước đây POST KHÔNG kiểm đăng nhập (middleware bỏ qua /api) → ai trên Internet cũng dùng được khoá
// Gemini của công ty, với prompt tuỳ ý dài (đo được 3 MB → 3 triệu ký tự). Nay: đăng nhập + 10 lượt/phút/người +
// cắt độ dài mọi chuỗi đưa vào prompt + chỉ giữ dòng thuộc công ty người gọi được xem.
const CPL_AI_MAX = 10
const CPL_AI_WINDOW_MS = 60_000
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { allowed } = await rateLimit(`cpl-ai:${user.id}`, CPL_AI_MAX, CPL_AI_WINDOW_MS);
  if (!allowed) return NextResponse.json({ success: false, error: "Gọi AI quá nhiều, thử lại sau 1 phút" }, { status: 429 });
  try {
    const body = await req.json();
    const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? "")) ? String(body.month) : "";
    const cplData: unknown[] = Array.isArray(body?.cplData) ? body.cplData : [];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: true, data: { insight: "Thiếu GEMINI_API_KEY trong biến môi trường." } });
    }

    // Trim to essential fields only — avoid sending full nested objects
    const str = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trimmed = (cplData as any[])
      .filter((c) => (isCompany(c?.company)) && canAccessCompany(user, c.company))
      .slice(0, 30).map((c) => ({
        name: str(c.campaign_name, 150),
        company: c.company as string,
        spend: num(c.spend),
        cpl: num(c.cpl_data?.cpl),
        level: str(c.cpl_data?.level, 20),
        leads: num(c.cpl_data?.totalLeads),
      }));
    if (!trimmed.length) return NextResponse.json({ success: false, error: "Không có dữ liệu CPL hợp lệ để phân tích" }, { status: 400 });

    // Ngưỡng thật, tính theo KPI tháng hiện tại — không hardcode số cũ
    // (trước đây ghi cứng "60K/150K" ở đây, không đồng bộ với ngưỡng thật
    // dùng để phân loại level ở trên, nên AI luôn phân tích sai ngưỡng).
    const th = getCplThresholds();
    const fmtK = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;
    const prompt = `Bạn là chuyên gia quảng cáo Facebook. Phân tích CPL tháng ${month}.
Ngưỡng: MBC CPL tốt ≤${fmtK(th.MBC.good)}, trung bình ${fmtK(th.MBC.good)}-${fmtK(th.MBC.warning)}, đắt ≥${fmtK(th.MBC.critical)}. MBI tốt ≤${fmtK(th.MBI.good)}, trung bình ${fmtK(th.MBI.good)}-${fmtK(th.MBI.warning)}, đắt ≥${fmtK(th.MBI.critical)}.

Chiến dịch (${trimmed.length} campaigns):
${trimmed.map(c => `${c.name} | ${c.company} | spend:${c.spend} | CPL:${c.cpl} | ${c.level}`).join("\n")}

Trả lời ngắn gọn (markdown):
1. **Scale ngay:** campaign nào và lý do.
2. **Dừng/review:** campaign nào và lý do.
3. **Xu hướng đáng chú ý:** 1-2 câu.`;

    const geminiRes = await callGemini(prompt, { temperature: 0.5, maxOutputTokens: 800, thinkingBudget: 0 }, apiKey);

    return NextResponse.json({ success: true, data: { insight: geminiRes.text } });
  } catch (err) {
    console.error("[CPL POST AI]", err);
    return NextResponse.json({ success: false, error: "AI Error" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// Revenue Targets helpers
// ─────────────────────────────────────────────

interface RevenueTargets {
  MBC: { monthly_target: number };
  MBI: { monthly_target: number };
}

function getRevenueTargets(): RevenueTargets {
  try {
    if (fs.existsSync(REVENUE_TARGETS_FILE)) {
      return JSON.parse(fs.readFileSync(REVENUE_TARGETS_FILE, "utf-8"));
    }
  } catch {
    // fallback to defaults
  }
  return {
    MBC: { monthly_target: 500000000 },
    MBI: { monthly_target: 300000000 },
  };
}

function saveRevenueTargets(targets: RevenueTargets): void {
  const dir = path.dirname(REVENUE_TARGETS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(REVENUE_TARGETS_FILE, JSON.stringify(targets, null, 2));
}

// PUT — save revenue config (monthly targets + CPL thresholds)
export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // CPL thresholds require can_edit_thresholds (super_admin only)
    const threshGuard = guardEditThresholds(user);
    if (threshGuard) return threshGuard;

    const body = await req.json() as {
      MBC?: { referenceAov?: number; labels?: Record<string, string>; monthly_target?: number };
      MBI?: { labels?: Record<string, string>; monthly_target?: number };
      note?: string;
    };

    // ── Validate ──────────────────────────────────────────
    // good/warning/critical are computed from KPI now — only referenceAov
    // (MBC) needs validating; labels are free text.
    const cplErrors = validateCplConfig({
      MBC: body.MBC?.referenceAov !== undefined ? { referenceAov: body.MBC.referenceAov } : undefined,
    });
    const revErrors = validateRevenueTargets({ MBC: body.MBC, MBI: body.MBI });
    const errors = [...cplErrors, ...revErrors];
    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 422 });
    }

    // ── Snapshot before write ─────────────────────────────
    const oldThresholds = getCplThresholds();
    const oldTargets    = getRevenueTargets();

    const [snapCpl, snapRev] = await Promise.all([
      writeAuditSnapshot("cpl_thresholds", user, oldThresholds),
      writeAuditSnapshot("revenue",         user, oldTargets),
    ]);

    // ── Save CPL settings (referenceAov + labels — good/warning/critical
    //    are never stored, always recomputed from KPI on read) ──────────
    if (body.MBC?.referenceAov !== undefined || body.MBC?.labels || body.MBI?.labels) {
      saveCplThresholds({
        MBC: (body.MBC?.referenceAov !== undefined || body.MBC?.labels)
          ? { referenceAov: body.MBC?.referenceAov, labels: body.MBC?.labels }
          : undefined,
        MBI: body.MBI?.labels ? { labels: body.MBI.labels } : undefined,
      });
    }

    // ── Save revenue targets ──────────────────────────────
    const targets = getRevenueTargets();
    if (body.MBC?.monthly_target !== undefined) targets.MBC.monthly_target = body.MBC.monthly_target;
    if (body.MBI?.monthly_target !== undefined) targets.MBI.monthly_target = body.MBI.monthly_target;
    saveRevenueTargets(targets);

    // ── Audit ─────────────────────────────────────────────
    const newThresholds = getCplThresholds();
    const newTargets    = getRevenueTargets();
    const auditOpts = { note: body.note };

    await Promise.all([
      writeAuditEntry(
        "cpl_thresholds", user, "update", "thresholds",
        oldThresholds, newThresholds, "ALL",
        {
          ...auditOpts,
          rollbackReference: snapCpl,
          diff: computeDiff(
            oldThresholds as unknown as Record<string, unknown>,
            newThresholds as unknown as Record<string, unknown>,
          ),
        },
      ),
      writeAuditEntry(
        "revenue", user, "update", "monthly_target",
        oldTargets, newTargets, "ALL",
        {
          ...auditOpts,
          rollbackReference: snapRev,
          diff: computeDiff(
            oldTargets as unknown as Record<string, unknown>,
            newTargets as unknown as Record<string, unknown>,
          ),
        },
      ),
    ]);

    const savedThresholds = getCplThresholds();
    const savedTargets    = getRevenueTargets();
    return NextResponse.json({
      success: true,
      data: {
        MBC: { monthly_target: savedTargets.MBC.monthly_target, cpl: savedThresholds.MBC, referenceAov: getCplReferenceAov() },
        MBI: { monthly_target: savedTargets.MBI.monthly_target, cpl: savedThresholds.MBI },
      },
    });
  } catch (err) {
    console.error("[CPL PUT]", err);
    return NextResponse.json({ success: false, error: "Save failed" }, { status: 500 });
  }
}
