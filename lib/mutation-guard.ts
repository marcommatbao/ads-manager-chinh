// ============================================================
// Campaign-level mutation-safety coordination
// ============================================================
// Four independent code paths can each mutate live Google Ads campaign
// budgets/bids with no awareness of each other: Google Audit's Auto-Fix
// (app/api/google/audit/auto-fix/route.ts), Improvements' apply endpoint
// (app/api/improvements/apply/route.ts, UPDATE_BUDGET/UPDATE_TARGET_CPA/
// UPDATE_DEVICE_BID), the Google budget-optimizer cron (fully autonomous,
// app/api/automation/google/budget-optimizer/route.ts), and lib/nba's
// auto-apply (Facebook only today, but the pattern already exists there).
//
// This is a thin wrapper around the existing lib/decision-memory
// primitives (getRecentByEntity/recordDecision) — scoped deliberately to
// CAMPAIGN-level budget/bid mutations only, the actual collision risk
// (two systems overwriting the same numeric field). Finer-grained
// mutations (pause one keyword, add one negative keyword) are NOT routed
// through this — they don't collide with each other the way two systems
// both deciding a campaign's budget/bid do, and force-fitting every
// mutation type into decision-memory's DecisionEvent/EntityType taxonomy
// (built for lib/nba's outcome-evaluation pipeline) risks feeding noise
// into NBA's confidence-adjustment signal (see lib/decision-memory/signal.ts).

import { getRecentByEntity } from "./decision-memory/query";
import { recordDecision } from "./decision-memory/recorder";
import type { DecisionSource, DecisionEvent } from "./decision-memory/types";

const COOLDOWN_HOURS = 12;

export interface RecentMutationCheck {
  hasConflict: boolean;
  note: string | null;
}

/**
 * Has a DIFFERENT source mutated this campaign within the cooldown window?
 * Manual paths (Audit Auto-Fix, Improvements) should surface `note` as a
 * warning and let the human decide. The autonomous cron should treat
 * `hasConflict` as a hard skip.
 */
export function checkRecentCampaignMutation(
  campaignId: string,
  company: string,
  ownSourceType: DecisionSource["type"]
): RecentMutationCheck {
  const recent = getRecentByEntity(campaignId, company, 5);
  const cutoffMs = Date.now() - COOLDOWN_HOURS * 3_600_000;
  const conflict = recent.find(
    (e) => Date.parse(e.createdAt) >= cutoffMs && e.source.type !== ownSourceType
  );
  if (!conflict) return { hasConflict: false, note: null };

  const hoursAgo = Math.round((Date.now() - Date.parse(conflict.createdAt)) / 3_600_000);
  return {
    hasConflict: true,
    note: `Campaign này đã bị "${conflict.source.type}" sửa ${hoursAgo}h trước (${conflict.event}) — kiểm tra kỹ trước khi áp dụng thêm thay đổi.`,
  };
}

/** Fire-and-forget record — never let logging failure break the caller's mutation flow. */
export function recordCampaignMutation(params: {
  source: DecisionSource;
  event: DecisionEvent;
  company: string;
  campaignId: string;
  campaignName: string;
  rationale: string;
  notes?: string;
  /** Nền tảng của campaign. Mặc định google_ads vì đó là toàn bộ người dùng cũ
   *  của hàm này; nhánh Facebook PHẢI truyền "meta". Trước đây trường này bị ghi
   *  cứng google_ads, nên mọi thay đổi Facebook đều bị dán nhãn sai — không sai
   *  phép so xung đột (so theo entityId + company) nhưng sai dữ liệu, và chính
   *  chú thích đầu file này cảnh báo việc bơm nhiễu vào tín hiệu của NBA. */
  platform?: "meta" | "google_ads";
  /** Đợt 23 (3c): giá trị trước/sau dạng máy đọc được — có thì trang "Đã làm & kết quả" cho bấm Hoàn tác.
   *  status: chuỗi trạng thái của nền tảng (Meta ACTIVE/PAUSED, Google ENABLED/PAUSED); daily_budget: VND/ngày. */
  change?: { field: "status" | "daily_budget"; before: string | number; after: string | number };
  /** 26d: ghi ở cấp NHÓM quảng cáo — campaignId lúc đó là id nhóm, parentId là chiến dịch chứa nó (để đo lại theo chiến dịch). */
  entityType?: "campaign" | "adset";
  parentId?: string;
  parentName?: string;
}): void {
  recordDecision({
    source: params.source,
    event: params.event,
    action: params.change
      ? { notes: params.notes, field: params.change.field, valueBefore: params.change.before, valueAfter: params.change.after, unit: params.change.field === "daily_budget" ? "VND" : undefined }
      : { notes: params.notes },
    target: {
      company: params.company,
      platform: params.platform ?? "google_ads",
      entityType: params.entityType ?? "campaign",
      entityId: params.campaignId,
      entityName: params.campaignName,
      ...(params.parentId ? { parentId: params.parentId, parentName: params.parentName } : {}),
    },
    rationale: params.rationale,
  }).catch(() => { /* non-blocking, same pattern as lib/nba/auto-apply.ts */ });
}
