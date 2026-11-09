// ============================================================
// Automation Sim — safety guard pipeline
// Tái dùng campaign-health (learning), rules-engine (cooldown),
// change-tracker (recent change). Trả blockedBy[] + cờ downgraded.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { AutomationRule } from "@/lib/automation-shared";
import { getLearningStatus } from "@/lib/campaign-health";
import { isInCooldown } from "@/lib/rules-engine";
import { queryFor } from "@/lib/nba/store";
import type { SimContext, SimProposedAction, SimReasonCode, SimRisk, SimCompany } from "./types";
import { isCompany } from "@/lib/companies/registry";

// NBA recommendation types that imply SCALE (positive action on a campaign)
const SCALE_TYPES = new Set(["SCALE_BUDGET", "SCALE_WINNER"]);
// NBA recommendation types that imply PAUSE/STOP (destructive action on a campaign)
const PAUSE_TYPES = new Set(["PAUSE_WASTE", "PAUSE_FB_AD_LOW_CTR"]);

export const LOW_DATA_FLOOR = 40;       // dataCompleteness <
export const AUTO_CONFIDENCE_FLOOR = 75; // confidence < → không auto

export interface GuardOutput {
  blockedBy: SimReasonCode[];
  downgraded: boolean; // destructive bị hạ về advisory do learning
}

export function detectCompany(c: Campaign): SimCompany | null {
  if (isCompany(c.company)) return c.company;
  const n = (c.name ?? "").toUpperCase();
  if (n.includes("MBI")) return "MBI";
  if (n.includes("MBC")) return "MBC";
  return null;
}

export function runGuards(
  campaign: Campaign,
  rule: AutomationRule,
  action: SimProposedAction,
  risk: SimRisk,
  ctx: SimContext,
  recentlyChanged: Set<string>,
  largeMagnitude: boolean,
): GuardOutput {
  const blocks = new Set<SimReasonCode>();
  let downgraded = false;

  // 1) RBAC company silo
  const company = detectCompany(campaign);
  if (!company || !ctx.companies.includes(company)) {
    blocks.add("ROLE_RESTRICTION");
  }

  // chỉ action chạm tài khoản mới qua các guard rủi ro
  if (action.mutating) {
    // 2) Learning-phase — destructive khi new/learning → hạ về advisory
    try {
      const learning = getLearningStatus(campaign as Parameters<typeof getLearningStatus>[0]);
      if (learning.blockAutomation && action.destructive) {
        blocks.add("LEARNING_PHASE");
        downgraded = true;
      }
    } catch { /* CampaignLike không hợp lệ → bỏ qua */ }

    // 3) Cooldown rule
    if (isInCooldown(rule, rule.lastTriggered).inCooldown) blocks.add("COOLDOWN_ACTIVE");

    // 4) Recent change (change-tracker đổi <3 ngày)
    if (recentlyChanged.has(campaign.id)) blocks.add("RECENT_CHANGE");

    // 5) Low data / thiếu metric
    const hasData = (campaign.metrics.spend ?? 0) > 0 || (campaign.metrics.impressions ?? 0) > 0;
    if (!hasData) blocks.add("MISSING_METRICS");
    else if (risk.dataCompleteness < LOW_DATA_FLOOR) blocks.add("LOW_DATA");

    // 6) Reversibility
    if (!action.reversible) blocks.add("NOT_REVERSIBLE");

    // 7) Low confidence cho auto-apply
    if (risk.confidence < AUTO_CONFIDENCE_FLOOR) blocks.add("LOW_CONFIDENCE");

    // 8) Budget guard — giảm budget khi đã quá thấp
    if (action.type === "decrease_budget" && campaign.dailyBudget > 0 && campaign.dailyBudget < 100_000) {
      blocks.add("BUDGET_GUARD");
    }

    // 9) Magnitude — thay đổi quá lớn (vd ±budget > 50%)
    if (largeMagnitude) blocks.add("LARGE_MAGNITUDE");

    // 10) Conflicting NBA recommendation for same entity
    if (company) {
      const nbaRecs = queryFor([company]);
      const entityRecs = nbaRecs.filter(r => r.entityId === campaign.id);
      if (entityRecs.length > 0) {
        const proposingScale = action.type === "increase_budget" || action.type === "activate_campaign";
        const proposingPause = action.type === "pause_campaign" || action.type === "decrease_budget";
        const hasConflict = entityRecs.some(r =>
          (proposingScale && PAUSE_TYPES.has(r.recommendationType)) ||
          (proposingPause && SCALE_TYPES.has(r.recommendationType))
        );
        if (hasConflict) blocks.add("CONFLICTING_RECOMMENDATION");
      }
    }
  }

  return { blockedBy: [...blocks], downgraded };
}
