// ============================================================
// POST /api/dashboard/kpi-analysis
// Nút "Phân tích AI" ở Dashboard → KPI Tổng Quan.
// ------------------------------------------------------------
// Chia việc rõ ràng:
//   • lib/finance/kpi-analysis-facts.ts  → TÍNH toàn bộ con số (đạt bao nhiêu %,
//     vượt trần bao nhiêu, còn lại bao nhiêu ngân sách, tháng nào hụt nguồn).
//   • Gemini                              → chỉ VIẾT nhận định + đề xuất dựa trên
//     đúng bảng số đó.
// Route luôn trả `facts` kể cả khi AI hỏng, để bảng đánh giá vẫn dùng được —
// mất phần văn xuôi thì vẫn còn số, còn hơn hiện một khung lỗi trống trơn.
//
// Vì sao nhận số liệu từ client thay vì tự gọi lại getCompanyPnl(): tab KPI đã
// tải sẵn mục tiêu + thực tế cả năm rồi. Gọi lại nghĩa là bắn lại toàn bộ
// Meta/Google/Odoo cho 9–12 tháng (chậm, tốn quota) và mở ra khả năng AI phân
// tích một bộ số KHÁC bộ số người dùng đang nhìn. Payload được kiểm chặt ở dưới
// và chỉ chảy vào một prompt đọc-hiểu — không ghi, không kích hoạt hành động nào.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { callGemini, redactApiKeys } from "@/lib/gemini";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { buildKpiFacts, type KpiFacts } from "@/lib/finance/kpi-analysis-facts";
import { factsToTable, PROMPT_RULES, parseNarrative, type KpiAiNarrative } from "@/lib/finance/kpi-analysis-prompt";
import { emptyChannelBudget, type MonthKpi } from "@/lib/settings/kpi-store";
import type { MonthActual } from "@/app/api/dashboard/kpi-actuals/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RATE_MAX = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const CACHE_PATH = path.join(process.cwd(), "data", "kpi-analysis-cache.json");

export interface KpiAnalysisResponse {
  success: true;
  facts: KpiFacts;
  ai: KpiAiNarrative | null;
  /** Có giá trị khi ai === null: vì sao không có phần nhận định. */
  aiError: string | null;
  cached: boolean;
  generatedAt: string;
  model: string | null;
}

// ── Kiểm payload ──────────────────────────────────────────────
// Số liệu tới từ trình duyệt nên không tin mù. Không cần thư viện schema:
// hình dạng cố định và nhỏ, kiểm tay đọc còn rõ hơn.

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function channelBudget(v: unknown): Record<string, number> {
  const src = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = emptyChannelBudget(); // Đợt 27: gồm kênh tự thêm
  for (const k of Object.keys(out)) out[k] = num(src[k]);
  return out;
}

function parseTargets(v: unknown): MonthKpi[] | null {
  if (!Array.isArray(v) || v.length !== 12) return null;
  return v.map(raw => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      revenueMbc: num(o.revenueMbc),
      adSpendMbc: num(o.adSpendMbc),
      adSpendMbi: num(o.adSpendMbi),
      ordersMbi: num(o.ordersMbi),
      adSpendMbcByChannel: channelBudget(o.adSpendMbcByChannel),
      adSpendMbiByChannel: channelBudget(o.adSpendMbiByChannel),
    } as MonthKpi;
  });
}

function parseSide(v: unknown) {
  const o = (v ?? {}) as Record<string, unknown>;
  const ch = (o.spendByChannel ?? {}) as Record<string, unknown>;
  return {
    revenue: num(o.revenue),
    orders: num(o.orders),
    totalSpend: num(o.totalSpend),
    spendManual: num(o.spendManual),
    manualBreakdown: Array.isArray(o.manualBreakdown) ? o.manualBreakdown.slice(0, 20) : [],
    spendByChannel: {
      google: num(ch.google), facebook: num(ch.facebook),
      tiktok: num(ch.tiktok), zalo: num(ch.zalo), other: num(ch.other),
    },
    revenueSourceError: Boolean(o.revenueSourceError),
    ordersSourceError: Boolean(o.ordersSourceError),
    googleSpendError: Boolean(o.googleSpendError),
    facebookSpendError: Boolean(o.facebookSpendError),
  };
}

function parseActuals(v: unknown): (MonthActual | null)[] | null {
  if (!Array.isArray(v) || v.length !== 12) return null;
  return v.map((raw, i) => {
    if (raw === null || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    return {
      month: i + 1,
      mbc: parseSide(o.mbc),
      mbi: parseSide(o.mbi),
    } as unknown as MonthActual;
  });
}

// ── Cache ─────────────────────────────────────────────────────
// Khoá cache = vân tay của chính bảng số. Số chưa đổi thì bấm lại vẫn ra kết
// quả cũ, không đốt thêm quota Gemini; số đổi (sang tháng mới, sửa KPI, chi
// thêm tiền) thì vân tay đổi theo và tự phân tích lại.

interface CacheEntry { hash: string; generatedAt: string; model: string; ai: KpiAiNarrative }

async function readCache(): Promise<Record<string, CacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, "utf8")) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`kpi-analysis:${user.id}`, RATE_MAX, RATE_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: `Bạn đã yêu cầu phân tích quá ${RATE_MAX} lần trong 10 phút. Chờ ít phút rồi thử lại.` },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }

  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2020 || year > new Date().getFullYear() + 5) {
    return NextResponse.json({ error: "Năm không hợp lệ." }, { status: 400 });
  }
  const targets = parseTargets(body.targets);
  const actuals = parseActuals(body.actuals);
  if (!targets || !actuals) {
    return NextResponse.json({ error: "Thiếu dữ liệu 12 tháng để phân tích." }, { status: 400 });
  }

  const facts = buildKpiFacts(year, targets, actuals);

  // Không có tháng nào đo được thì không có gì để phân tích — nói thẳng, đừng
  // gọi AI để nó viết một đoạn văn hay ho về một bảng trống.
  if (facts.ytd.monthsCounted.length === 0) {
    const empty: KpiAnalysisResponse = {
      success: true, facts, ai: null,
      aiError: "Chưa có tháng nào đo được số liệu trong năm này nên chưa phân tích được.",
      cached: false, generatedAt: new Date().toISOString(), model: null,
    };
    return NextResponse.json(empty);
  }

  const table = factsToTable(facts);
  const hash = crypto.createHash("sha256").update(`${year}\n${table}`).digest("hex").slice(0, 32);
  const force = body.force === true;

  const cache = await readCache();
  const hit = cache[String(year)];
  if (!force && hit && hit.hash === hash) {
    const cachedRes: KpiAnalysisResponse = {
      success: true, facts, ai: hit.ai, aiError: null,
      cached: true, generatedAt: hit.generatedAt, model: hit.model,
    };
    return NextResponse.json(cachedRes);
  }

  let ai: KpiAiNarrative | null = null;
  let aiError: string | null = null;
  let model: string | null = null;

  try {
    const res = await callGemini(
      `${PROMPT_RULES}\n\n=== BẢNG SỐ LIỆU ===\n${table}`,
      { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: "application/json", thinkingBudget: 0, timeoutMs: 45000 },
    );
    model = res.model;
    try {
      ai = parseNarrative(res.text);
    } catch {
      console.error("[kpi-analysis] JSON parse failed. 300 ký tự đầu:", res.text.slice(0, 300));
      aiError = "AI trả về nội dung không đọc được. Bấm phân tích lại giúp tôi.";
    }
  } catch (err) {
    // describeGeminiError trong lib/gemini đã dịch sang việc người dùng làm
    // được (khoá bị khoá, hết hạn mức…) và đã che khoá API.
    aiError = redactApiKeys(err instanceof Error ? err.message : "Không gọi được AI.");
    console.error("[kpi-analysis] Gemini error:", aiError);
  }

  const generatedAt = new Date().toISOString();
  if (ai && model) {
    try {
      cache[String(year)] = { hash, generatedAt, model, ai };
      await writeFileAtomic(CACHE_PATH, JSON.stringify(cache, null, 2));
    } catch (err) {
      // Cache hỏng không được làm hỏng câu trả lời đang có trong tay.
      console.error("[kpi-analysis] không ghi được cache:", err);
    }
  }

  const out: KpiAnalysisResponse = { success: true, facts, ai, aiError, cached: false, generatedAt, model };
  return NextResponse.json(out);
}
