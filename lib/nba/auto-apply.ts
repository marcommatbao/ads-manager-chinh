// ============================================================
// NBA — Auto-apply (slice 3)
// Tiêu thụ recommendation `auto_apply_eligible` + executor `automation-engine`.
// Mặc định DRY_RUN (không đụng tài khoản). Chỉ execute thật khi
// NBA_AUTO_APPLY=on. Có cap/công ty + log Telegram.
//
// Slice-3 chỉ execute Facebook budget-increase (SCALE_WINNER) — đảo ngược
// được. Google eligible → để manual.
// ============================================================

// 29/09: báo qua kênh cảnh báo hệ thống (Teams IT). Trước đây gửi Telegram — token hỏng → các thay đổi TỰ ĐỘNG ghi thật
// lên tài khoản không báo cho ai.
import { sendSystemAlert } from "@/lib/system-alert";
import { setStatus } from "./store";
import { recordDecision } from "@/lib/decision-memory/recorder";
import { checkRecentCampaignMutation } from "@/lib/mutation-guard";
import { checkSafety } from "@/lib/auto-apply-safety/eligibility";
import { getLearningStatus } from "@/lib/campaign-health";
import { recordApply, findUndoable, markUndone } from "@/lib/apply-undo-log";
import { isBlocked } from "./kill-switch";
import { hasOpenCase } from "@/lib/case/store";
import type { NbaRecommendation } from "./types";
import type { Campaign } from "@/types/ads.types";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const META_BASE = META_GRAPH_BASE;

export type AutoApplyMode = "off" | "dry_run" | "on";

export function getAutoApplyMode(): AutoApplyMode {
  const v = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  return v === "on" ? "on" : v === "off" ? "off" : "dry_run";
}

const MAX_PER_COMPANY = Math.max(1, Number(process.env.NBA_AUTO_APPLY_MAX ?? "3") || 3);
const MAX_BUDGET_INCREASE_PCT = 25; // trần cứng dù rec đề xuất cao hơn

export interface AutoApplyItem {
  id: string;
  company: string;
  reasonCode: string;
  title: string;
  executed: boolean;
  dryRun: boolean;
  note?: string;
}

export interface AutoApplyResult {
  mode: AutoApplyMode;
  eligible: number;
  items: AutoApplyItem[];
}

/** Nhãn hành động trong nhật ký hoàn tác dùng chung với Improvements. */
const UNDO_ACTION_FB_BUDGET = "NBA_FB_BUDGET_INCREASE";

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`;

/**
 * Đọc ngân sách ngày hiện tại. NÉM khi không đọc được, không trả 0.
 *
 * Bản cũ trả `0` cho cả ba trường hợp khác hẳn nhau: thiếu token, gọi hỏng, và
 * chiến dịch thật sự không có ngân sách ngày (dùng ngân sách trọn đời hoặc đặt
 * ở cấp nhóm). Với một ảnh chụp dùng để HOÀN TÁC thì sự mơ hồ đó là không chấp
 * nhận được — ghi nhầm 0 làm giá trị cũ nghĩa là hoàn tác sẽ kéo ngân sách về 0.
 */
async function metaReadDailyBudget(campaignId: string): Promise<number> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");
  const res = await fetch(`${META_BASE}/${campaignId}?fields=daily_budget&access_token=${token}`);
  const data = (await res.json().catch(() => ({}))) as { daily_budget?: string; error?: { message: string } };
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Meta API ${res.status} khi đọc daily_budget`);
  }
  const v = parseFloat(data.daily_budget ?? "");
  if (!Number.isFinite(v)) {
    throw new Error("Meta không trả daily_budget — chiến dịch có thể dùng ngân sách trọn đời hoặc đặt ở cấp nhóm quảng cáo");
  }
  return v;
}

/**
 * Ghi ngân sách rồi ĐỌC LẠI để xác nhận. Trả về giá trị THẬT sau khi ghi.
 *
 * Bản cũ chỉ kiểm `data.error` mà bỏ qua `res.ok`: Meta trả 4xx/5xx với thân
 * không đúng hình dạng mong đợi là hàm coi như thành công. Nguy hiểm gấp đôi ở
 * đây, vì ngay sau lượt ghi này ta ghi một bản "hoàn tác" — một bản hoàn tác
 * cho thay đổi CHƯA TỪNG xảy ra, mà hoàn tác nó là tự tay làm hỏng thứ đang đúng.
 *
 * Đọc lại là phép kiểm duy nhất đáng tin: "API trả thành công" không đồng nghĩa
 * "đã ghi".
 */
async function metaWriteDailyBudgetVerified(
  campaignId: string,
  newDaily: number,
  expectedBefore: number
): Promise<number> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");
  const target = Math.round(newDaily);
  const res = await fetch(`${META_BASE}/${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ daily_budget: String(target), access_token: token }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message: string } };
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Meta API ${res.status} khi ghi daily_budget`);
  }

  const actual = await metaReadDailyBudget(campaignId);
  if (Math.round(actual) === Math.round(expectedBefore) && Math.round(expectedBefore) !== target) {
    throw new Error(
      `Meta báo thành công nhưng ngân sách vẫn là ${vnd(actual)} (muốn đặt ${vnd(target)}) — lệnh không có hiệu lực`
    );
  }
  return actual;
}

async function executeFbBudgetIncrease(rec: NbaRecommendation): Promise<string> {
  const pctRaw = Number((rec.suggestedAction?.params as { pct?: number } | undefined)?.pct ?? 0);
  const pct = Math.min(MAX_BUDGET_INCREASE_PCT, Math.max(0, pctRaw));
  if (pct <= 0) throw new Error("pct không hợp lệ");

  // Ảnh chụp TRƯỚC khi ghi. Giá trị này vốn đã được đọc ở bản cũ nhưng chỉ dùng
  // để tính rồi vứt đi — nên hành động tự động duy nhất đang chạy thật trên tài
  // khoản sống không có đường lùi nào.
  const before = await metaReadDailyBudget(rec.entityId);
  if (before <= 0) throw new Error("không lấy được daily_budget hiện tại");

  const next = before * (1 + pct / 100);
  const after = await metaWriteDailyBudgetVerified(rec.entityId, next, before);

  // Ghi nhật ký CHỈ SAU KHI Meta đã xác nhận bằng phép đọc lại — đúng nguyên
  // tắc đã ghi trong lib/apply-undo-log.ts. Ghi trước mà lệnh hỏng sẽ để lại
  // một bản hoàn tác cho thay đổi chưa từng xảy ra.
  recordApply({
    improvementId: rec.id,
    company:       rec.company,
    action:        UNDO_ACTION_FB_BUDGET,
    resourceName:  rec.entityId,
    label:         rec.entityName ?? rec.title,
    before:        { daily_budget: before },
    after:         { daily_budget: after },
  });

  return `+${pct}% (${vnd(before)} → ${vnd(after)})`;
}

export interface UndoOutcome {
  ok: boolean;
  detail: string;
}

/**
 * Hoàn tác một lượt tăng ngân sách Facebook do NBA tự áp.
 *
 * Ba chốt, theo đúng thứ tự:
 *  1. Phải có bản ghi giá trị cũ. Không có thì từ chối thẳng, không đoán ngược
 *     từ giá trị hiện tại — "giảm lại 25%" KHÔNG đưa về đúng mức cũ
 *     (100 → +25% = 125; 125 − 25% = 93,75).
 *  2. Ngân sách hiện tại phải còn khớp giá trị hệ thống đã đặt. Lệch nghĩa là
 *     có người sửa tay sau đó — hoàn tác lúc này là xoá mất việc của họ.
 *  3. Ghi xong phải ĐỌC LẠI để xác nhận Meta thật sự nhận.
 */
export async function undoFbBudgetIncrease(recommendationId: string): Promise<UndoOutcome> {
  const entry = findUndoable(recommendationId);
  if (!entry) {
    return { ok: false, detail: "Không có bản ghi giá trị cũ cho khuyến nghị này — có thể nó được áp trước khi có nhật ký hoàn tác, hoặc đã hoàn tác rồi. Phải sửa tay trên Meta Ads." };
  }
  if (entry.action !== UNDO_ACTION_FB_BUDGET) {
    return { ok: false, detail: `Bản ghi này thuộc hành động "${entry.action}", không phải tăng ngân sách Facebook.` };
  }

  const before = Number(entry.before?.daily_budget);
  const recorded = Number(entry.after?.daily_budget);
  if (!Number.isFinite(before) || before <= 0) {
    return { ok: false, detail: "Bản ghi giá trị cũ không hợp lệ — từ chối hoàn tác thay vì đặt một con số đoán được." };
  }

  let current: number;
  try {
    current = await metaReadDailyBudget(entry.resourceName);
  } catch (err) {
    return { ok: false, detail: `Không đọc được ngân sách hiện tại: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (Number.isFinite(recorded) && Math.round(current) !== Math.round(recorded)) {
    return {
      ok: false,
      detail: `Ngân sách hiện tại ${vnd(current)} khác mức hệ thống đã đặt ${vnd(recorded)} — đã có người sửa sau đó. Hoàn tác lúc này sẽ xoá mất thay đổi của họ, nên dừng lại. Muốn về ${vnd(before)} thì sửa tay.`,
    };
  }

  try {
    const restored = await metaWriteDailyBudgetVerified(entry.resourceName, before, current);
    markUndone(entry.id);
    return { ok: true, detail: `Đã hoàn tác: ${vnd(current)} → ${vnd(restored)}` };
  } catch (err) {
    return { ok: false, detail: `Hoàn tác thất bại: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Áp các recommendation đủ điều kiện auto-apply.
 * @param recs danh sách recommendation vừa persist (sau guards).
 * @param campaigns campaign data cùng đợt gather (dùng để build context cho
 *   checkSafety(): learning-phase live + current daily budget thật). Optional
 *   để không phá caller cũ, nhưng khi bỏ trống thì learning-phase/currentBudget
 *   sẽ không có trong context (an toàn hơn = block, không phải bypass).
 * @param recentlyChangedEntityIds entityId vừa bị đổi (change-tracker) —
 *   cùng nguồn dữ liệu đã dùng để build recs (guards.ts), truyền lại đây để
 *   checkSafety() tự chạy cooldown check độc lập (defense-in-depth).
 */
export async function applyEligible(
  recs: NbaRecommendation[],
  campaigns: Campaign[] = [],
  recentlyChangedEntityIds: string[] = []
): Promise<AutoApplyResult> {
  const mode = getAutoApplyMode();
  const eligible = recs
    .filter(r => r.status === "new" && r.actionMode === "auto_apply_eligible" && r.executor === "automation-engine")
    .sort((a, b) => b.scores.priority - a.scores.priority);

  const campaignById = new Map(campaigns.map(c => [c.id, c]));
  const recentlyChanged = new Set(recentlyChangedEntityIds);

  const items: AutoApplyItem[] = [];
  const perCompany = new Map<string, number>();

  for (const rec of eligible) {
    const used = perCompany.get(rec.company) ?? 0;
    if (used >= MAX_PER_COMPANY) {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: mode === "dry_run", note: "vượt cap/công ty" });
      continue;
    }
    perCompany.set(rec.company, used + 1);

    if (mode === "off") {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: false, note: "auto-apply tắt" });
      continue;
    }

    // Hệ thống khác vừa sửa campaign này chưa? Cờ `recentlyChanged` truyền vào
    // checkSafety() dựng từ getPendingChecks() — kho riêng của NBA — nên nó KHÔNG
    // thấy rule engine, vốn chạy trước NBA vài giây trong cùng lượt cron. Hỏi thẳng
    // mutation-guard, nơi mọi đường ghi ngân sách khác đều khai báo vào.
    //
    // Kiểm cả ở dry_run: xem trước phải mô phỏng đúng thứ sẽ xảy ra. Bỏ chốt ở
    // dry-run thì báo cáo nói "sẽ áp" trong khi chạy thật lại bị chặn.
    const conflict = checkRecentCampaignMutation(
      rec.entityId, rec.company as string, "nba_engine",
    );
    if (conflict.hasConflict) {
      items.push({
        id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title,
        executed: false, dryRun: mode === "dry_run",
        note: conflict.note ?? "Campaign vừa được hệ thống khác sửa",
      });
      continue;
    }

    // Chỉ tăng ngân sách Facebook mới có đường thực thi. Chốt này phải đứng TRƯỚC
    // nhánh dry_run: trước đây nó nằm sau, nên dry-run báo "sẽ áp" cho cả đề xuất
    // Google mà lúc chạy thật sẽ rơi vào "cần làm thủ công". Xem trước phải nói
    // đúng thứ sẽ xảy ra, nếu không thì nó chỉ là một con số dễ nhìn.
    if (rec.platform !== "facebook" || rec.reasonCode !== "SCALE_WINNER") {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: mode === "dry_run", note: "cần làm thủ công (chưa hỗ trợ execute)" });
      continue;
    }

    // Chiến dịch đang có phiên "Xử lý chiến dịch" mở → không tự tăng tiền (user
    // chốt 27/09): vừa xử lý vừa bị máy tăng ngân sách thì số đo lại vô nghĩa.
    // Đứng trước dry_run để xem trước nói đúng thứ sẽ xảy ra.
    if (hasOpenCase(rec.entityId)) {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: mode === "dry_run", note: "chiến dịch đang có phiên xử lý mở — không tự tăng ngân sách" });
      continue;
    }

    if (mode === "dry_run") {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: true, note: "sẽ áp (dry-run)" });
      continue;
    }

    // Build safety context from real data available at this call site.
    // NOTE: anomalyActive / budgetCapHit have no live per-campaign detector
    // wired into the NBA path yet — left unset (sub-checks no-op) rather
    // than faked. learningPhase/recentlyChanged/currentBudget ARE available
    // from the same-run campaign gather + change-tracker, so they're wired.
    const campaign = campaignById.get(rec.entityId);
    let learningPhase: boolean | undefined;
    if (campaign) {
      try { learningPhase = getLearningStatus(campaign).blockAutomation; }
      catch { /* CampaignLike không hợp lệ → bỏ qua, không chặn oan */ }
    }

    // Full closed-loop safety check
    const safety = checkSafety({
      event:           "budget.increase",
      entityId:        rec.entityId,
      entityName:      rec.entityName,
      entityType:      rec.entityType as "campaign",
      company:         rec.company as string,
      platform:        "facebook",
      confidenceScore: rec.scores.confidence,
      reasonCode:      rec.reasonCode,
      context: {
        learningPhase,
        recentlyChanged: recentlyChanged.has(rec.entityId),
        currentBudget:   campaign?.dailyBudget,
      },
    });
    if (!safety.eligible || safety.executionDecision !== "proceed") {
      const note = safety.explanation;
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: false, note });
      recordDecision({
        source:    { type: "nba_engine", recommendationId: rec.id, nbaConfidence: rec.scores.confidence / 100 },
        event:     "nba.recommendation_dismissed",
        action:    { field: "daily_budget", notes: `Blocked: ${note}` },
        target:    { company: rec.company as string, platform: "meta", entityType: rec.entityType as "campaign", entityId: rec.entityId, entityName: rec.entityName },
        rationale: `Safety gate blocked auto-apply: ${note}`,
        links:     { nbaRecommendationId: rec.id },
      }).catch(() => {/* non-blocking */});
      continue;
    }

    // ── Công tắc khẩn cấp ──────────────────────────────────────────────
    // Kiểm ngay TRƯỚC mỗi lượt ghi, không phải một lần đầu vòng lặp: người bấm
    // tắt giữa chừng phải chặn được những mục còn lại trong chính lượt đó.
    // Đọc một tệp JSON vài trăm byte nên rẻ.
    const gate = isBlocked(rec.reasonCode);
    if (gate.blocked) {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: false, note: gate.reason ?? "bị công tắc khẩn cấp chặn" });
      continue;
    }

    try {
      const detail = await executeFbBudgetIncrease(rec);
      await setStatus(rec.id, "auto_applied");
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: true, dryRun: false, note: detail });
      recordDecision({
        source:          { type: "nba_engine", recommendationId: rec.id, nbaConfidence: rec.scores.confidence / 100 },
        event:           "nba.recommendation_applied",
        action:          { field: "daily_budget", notes: detail },
        target:          { company: rec.company as string, platform: "meta", entityType: rec.entityType as "campaign", entityId: rec.entityId, entityName: rec.entityName },
        rationale:       rec.explanation,
        confidence:      rec.scores.confidence / 100,
        expectedOutcome: { direction: "improve", targetMetric: "leads", timeframeHours: 48, hypothesis: rec.expectedOutcome },
        links:           { nbaRecommendationId: rec.id },
      }).catch(() => {/* non-blocking */});
    } catch (err) {
      items.push({ id: rec.id, company: rec.company, reasonCode: rec.reasonCode, title: rec.title, executed: false, dryRun: false, note: `lỗi: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  await notify(mode, items);
  return { mode, eligible: eligible.length, items };
}

async function notify(mode: AutoApplyMode, items: AutoApplyItem[]): Promise<void> {
  if (mode === "off" || items.length === 0) return;
  // Chỉ báo khi có việc GHI THẬT (mode on + executed) — thử khô không cần làm ồn kênh IT.
  const executed = items.filter(i => i.executed);
  if (mode !== "on" || executed.length === 0) return;
  await sendSystemAlert({
    level: "warning",
    title: `🤖 NBA tự áp dụng ${executed.length} thay đổi THẬT lên tài khoản quảng cáo`,
    facts: executed.slice(0, 15).map(i => ({ title: `[${i.company}]`, value: `${i.title}${i.note ? ` — ${i.note}` : ""}` })),
    action: "Xem / hoàn tác: AdsCommand → Next Best Actions. Tắt tự áp dụng: biến NBA_AUTO_APPLY (Cài đặt → Jobs có cảnh báo).",
  }).catch(() => null);
}
