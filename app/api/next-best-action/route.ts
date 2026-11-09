// ============================================================
// Next Best Action API (Prompt C + E)
// GET  /api/next-best-action
//   filters: ?company= &platform= &status= &minPriority= &executionMode=
//            &recommendationType= &from= &to= &refresh=1
//   → rich response cho dashboard "Cần xử lý hôm nay" + /improvements triage.
// POST /api/next-best-action
//   { id, action: seen|acknowledge|dismiss|resolve|snooze|feedback,
//     hours?, feedback? }
//
// Auth: getCurrentUser. RBAC: company-scoped. Viewer: read-only (executable=false).
// Không thực thi action lên tài khoản quảng cáo ở route này.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole, isAdmin, isSuperAdmin, hasPermission } from "@/lib/permissions";
import { undoFbBudgetIncrease } from "@/lib/nba/auto-apply";
import { runEngine, NBA_CALC_VERSION } from "@/lib/nba/engine";
import { getCplThresholds } from "@/lib/cpl-calculator";
import { gatherCampaigns } from "@/lib/nba/gather";
import { upsertMany, queryFor, setStatus, setFeedback, snooze, getOccurrenceMap, getRecommendation } from "@/lib/nba/store";
import { findUndoable } from "@/lib/apply-undo-log";
import { priorityBand } from "@/lib/nba/scoring";
import { getPriors, recordFeedback } from "@/lib/nba/feedback";
import type {
  NbaCompany, NbaPlatform, NbaStatus, NbaExecutionMode,
  NbaRecommendationType, NbaFeedbackValue, NbaRecommendation,
} from "@/lib/nba/types";
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_STATUS: NbaStatus[] = ["new", "seen", "acknowledged", "snoozed", "resolved", "applied", "auto_applied", "dismissed", "expired", "superseded"];

function tally<T extends string>(items: NbaRecommendation[], pick: (r: NbaRecommendation) => T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of items) { const k = pick(r); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const allowed = getCompaniesForRole(user) as NbaCompany[];
  const canExecute = isAdmin(user.role) || isSuperAdmin(user.role);

  // ── Filters ──
  const fCompany = sp.get("company")?.toUpperCase() as NbaCompany | null;
  const companies = fCompany && allowed.includes(fCompany) ? [fCompany] : allowed;
  const fPlatform = sp.get("platform") as NbaPlatform | null;
  const fStatusRaw = sp.get("status");
  const fStatuses = fStatusRaw
    ? (fStatusRaw.split(",").map(s => s.trim()).filter(s => VALID_STATUS.includes(s as NbaStatus)) as NbaStatus[])
    : undefined;
  const minPriority = Number(sp.get("minPriority") ?? "0") || 0;
  const fMode = sp.get("executionMode") as NbaExecutionMode | null;
  const fType = sp.get("recommendationType") as NbaRecommendationType | null;
  const fFrom = sp.get("from"); // YYYY-MM-DD
  const fTo = sp.get("to");
  const refresh = sp.get("refresh") === "1";

  try {
    // ── Compute on demand nếu refresh / store rỗng ──
    const baseline = queryFor(companies);
    // Tự tính lại khi có bản ghi sinh bằng CÔNG THỨC CŨ. Không có bước này thì
    // sau mỗi lần sửa công thức, người dùng phải NHỚ bấm "Làm mới" mới thấy số
    // đúng — mà không ai biết là cần bấm, vì số cũ trông y hệt số mới.
    const hasStaleCalc = baseline.some(r => (r.calcVersion ?? 1) !== NBA_CALC_VERSION);
    if (refresh || baseline.length === 0 || hasStaleCalc) {
      try {
        const campaigns = await gatherCampaigns();
        if (campaigns.length > 0) {
          const recs = runEngine(
            { campaigns, priorOccurrences: getOccurrenceMap(), priors: getPriors() },
            { companies: allowed }
          );
          await upsertMany(recs);
        }
      } catch (err) {
        console.warn("[nba/api] compute failed:", err instanceof Error ? err.message : err);
      }
    }

    // Truy cập field phòng thủ (store có thể chứa rec schema cũ)
    const pr = (r: NbaRecommendation) => r.scores?.priority ?? 0;
    const blk = (r: NbaRecommendation) => r.blockedBy ?? [];

    // ── Query + filter ──
    let recs = queryFor(companies, fStatuses ? { includeStatuses: fStatuses } : {});
    if (fPlatform) recs = recs.filter(r => r.platform === fPlatform);
    if (fMode) recs = recs.filter(r => r.executionMode === fMode);
    if (fType) recs = recs.filter(r => r.recommendationType === fType);
    if (minPriority > 0) recs = recs.filter(r => pr(r) >= minPriority);
    if (fFrom) recs = recs.filter(r => (r.createdAt ?? "").slice(0, 10) >= fFrom);
    if (fTo) recs = recs.filter(r => (r.createdAt ?? "").slice(0, 10) <= fTo);

    const VALID_MODE: NbaExecutionMode[] = ["advisory_only", "manual_action", "auto_apply_candidate"];
    // Chuẩn hoá đầy đủ shape → rec schema cũ trong store không làm UI crash.
    const items = recs.map(r => {
      const executionMode = VALID_MODE.includes(r.executionMode) ? r.executionMode : "manual_action";
      return {
        ...r,
        executionMode,
        blockedBy: blk(r),
        reasonCodes: r.reasonCodes ?? [],
        sourceSignals: r.sourceSignals ?? [],
        evidence: r.evidence ?? [],
        scores: r.scores ?? { impact: 0, urgency: 0, confidence: 0, safety: 0, dataCompleteness: 0, persistence: 0, priority: pr(r) },
        band: priorityBand(pr(r)),
        executable: canExecute && executionMode !== "advisory_only" && blk(r).length === 0,
      };
    });

    const blockedActions = items.filter(r => blk(r).length > 0);
    const actionable = items.filter(r => blk(r).length === 0);
    const topActionsToday = actionable.slice(0, 5);

    // ── Cộng tổng tiết kiệm: hai lỗi đã sửa ─────────────────────────────────
    //
    // 1. CỘNG ĐÚNG TẬP ĐANG HIỆN. Bản cũ cộng trên `items` (gồm cả mục bị
    //    chặn: LEARNING_PHASE, LOW_DATA…), trong khi con số "N việc" trên màn
    //    hình là số mục ĐÃ LỌC BỎ phần bị chặn. Hai con số cạnh nhau nói về
    //    hai tập khác nhau — người đọc trừ ra không bao giờ khớp.
    //
    // 2. KHÔNG CỘNG TRÙNG MỘT CHIẾN DỊCH. Ba collector cpl/budget/fatigue
    //    chạy độc lập và HOÀN TOÀN có thể cùng gắn cờ một campaign
    //    (CPL_CRITICAL 20% + LOW_ROAS_REVIEW 30% + CREATIVE_FATIGUE 15%).
    //    Cộng thẳng là tính 65% chi tiêu của cùng một campaign thành "tiết
    //    kiệm" ba lần. Phép khử trùng sẵn có trong guards.ts chỉ xử lý mục
    //    TRÙNG recommendationType, nên ba loại khác nhau này lọt hết.
    //    Cách chặn: mỗi campaign chỉ tính khoản LỚN NHẤT trong các gợi ý của
    //    nó. Vẫn là ước lượng, nhưng không còn nhân ba một cách vô lý.
    const savingsByEntity = new Map<string, number>();
    for (const r of actionable) {
      const v = r.estimatedMonthlySavings ?? r.impactEstimate?.estMonthlySavingsVnd ?? 0;
      if (!v) continue;
      const key = `${r.company}:${r.entityType}:${r.entityId}`;
      savingsByEntity.set(key, Math.max(savingsByEntity.get(key) ?? 0, v));
    }
    const totalMonthlySavingsVnd = [...savingsByEntity.values()].reduce((a, b) => a + b, 0);

    const liftByEntity = new Map<string, number>();
    for (const r of actionable) {
      const v = r.estimatedMonthlyLift ?? 0;
      if (!v) continue;
      const key = `${r.company}:${r.entityType}:${r.entityId}`;
      liftByEntity.set(key, Math.max(liftByEntity.get(key) ?? 0, v));
    }
    const totalMonthlyLiftVnd = [...liftByEntity.values()].reduce((a, b) => a + b, 0);

    // ── Ngưỡng CPL có đang chạy trên số cũ không? ───────────────────────────
    // Khi KPI tháng chưa nhập, ngưỡng CPL rơi về số tĩnh đóng băng từ 7/2026.
    // Mọi gợi ý "CPL vượt ngưỡng đỏ" khi đó so với mục tiêu của một tháng đã
    // qua — và trước bản này KHÔNG có gì báo. Một ngưỡng sai thời điểm trông
    // y hệt một ngưỡng đúng.
    const cplCfg = getCplThresholds();
    const thresholdWarnings = companyIds()
      // Đợt 21 B: công ty chưa có ngưỡng CPL (bản cài khách — ngưỡng hiện chỉ tính cho MBC/MBI) → bỏ qua, không sập cả trang.
      .filter((co) => companies.includes(co) && cplCfg[co]?.source === "fallback")
      .map((co) => cplCfg[co]?.staleWarning ?? "")
      .filter(Boolean);

    /** Nói rõ tổng được tính thế nào, thay vì để một con số trần không ai
     *  kiểm được. */
    const savingsBasis = {
      countedItems: actionable.length,
      blockedExcluded: blockedActions.length,
      distinctEntities: savingsByEntity.size,
      method: "Mỗi chiến dịch chỉ tính khoản lớn nhất trong các gợi ý của nó; mục đang bị chặn không tính. Ước tính quy từ chi tiêu 7 ngày gần nhất ra mức tháng.",
    };

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      role: user.role,
      canExecute,
      companies,
      count: items.length,
      totalMonthlySavingsVnd,
      totalMonthlyLiftVnd,
      savingsBasis,
      thresholdWarnings,
      totalsByPriorityBucket: tally(items, r => priorityBand(pr(r))),
      totalsByPlatform: tally(items, r => r.platform),
      totalsByCompany: tally(items, r => r.company),
      totalsByExecutionMode: tally(items, r => r.executionMode),
      topActionsToday,
      blockedActions,
      items,
      recommendations: items, // backward-compat
    });
  } catch (err) {
    console.error("[nba/api GET]", err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Lỗi engine NBA") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: string; action?: string; hours?: number; feedback?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { id, action } = body;
  const ACTIONS = ["seen", "acknowledge", "dismiss", "resolve", "snooze", "feedback", "undo"];
  if (!id || !action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Require { id, action: ${ACTIONS.join("|")} }` }, { status: 400 });
  }

  // ── undo: hành động DUY NHẤT ở route này ghi thật lên tài khoản quảng cáo ──
  // Mọi action khác chỉ đổi trạng thái bản ghi trong kho nội bộ, nên chỉ cần
  // đăng nhập. Hoàn tác thì đổi ngân sách thật, phải kiểm quyền đúng như hai
  // route ngân sách Meta/Google đang làm (`can_manage_budget`).
  // RBAC silo TRƯỚC mọi thay đổi (audit 30/09: trước đây kiểm SAU setStatus — trạng thái công ty kia đã bị đổi rồi
  // mới trả 403; còn undo thì không kiểm công ty chút nào → admin_mbc hoàn tác ngân sách Meta của MBI).
  const companies = new Set(getCompaniesForRole(user));
  const rec = getRecommendation(id);
  const undoEntry = action === "undo" ? findUndoable(id) : null;
  const ownerCompany = undoEntry?.company ?? rec?.company;
  if (ownerCompany && !companies.has(ownerCompany as NbaRecommendation["company"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "undo") {
    if (!hasPermission(user.role, "can_manage_budget")) {
      return NextResponse.json({ success: false, error: "Không có quyền chỉnh ngân sách" }, { status: 403 });
    }
    const outcome = await undoFbBudgetIncrease(id);
    if (!outcome.ok) {
      // 409: yêu cầu hợp lệ nhưng trạng thái hiện tại không cho phép hoàn tác
      // (không có bản ghi cũ, hoặc có người đã sửa tay sau đó). KHÔNG trả 200
      // kèm success:false — giao diện dễ đọc nhầm thành đã xong.
      return NextResponse.json({ success: false, error: outcome.detail }, { status: 409 });
    }
    await setStatus(id, "resolved");
    return NextResponse.json({ success: true, message: outcome.detail });
  }

  let updated: NbaRecommendation | null = null;

  if (action === "snooze") {
    updated = await snooze(id, Number(body.hours) || 24);
  } else if (action === "feedback") {
    const fb = body.feedback as NbaFeedbackValue;
    if (!["helped", "not_helpful", "ignored"].includes(fb)) {
      return NextResponse.json({ error: "feedback phải là helped|not_helpful|ignored" }, { status: 400 });
    }
    updated = await setFeedback(id, fb);
    if (updated) await recordFeedback(updated.reasonCode, fb); // hook học cho vòng sau
  } else {
    const statusMap: Record<string, NbaStatus> = {
      seen: "seen", acknowledge: "acknowledged", dismiss: "dismissed", resolve: "resolved",
    };
    updated = await setStatus(id, statusMap[action]);
  }

  if (!updated) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });

  // Kiểm lại trên bản ghi đã đổi (phòng khi bản ghi mới xuất hiện giữa lúc kiểm và lúc ghi).
  if (!companies.has(updated.company)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ success: true, recommendation: updated });
}
