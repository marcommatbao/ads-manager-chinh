// ============================================================
// Automation Sim — match evaluation (reuse lib/rules-engine, was orphan)
// Adapter: ads Campaign → automation ExtendedMetrics → evaluateRule.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { AutomationRule, CampaignMetrics } from "@/lib/automation-shared";
import { evaluateRule, buildExtendedMetrics, type EvaluationResult } from "@/lib/rules-engine";

/** ads-types metrics → automation CampaignMetrics (9 base; extended tính sau). */
function toAutoMetrics(c: Campaign): CampaignMetrics {
  const m = c.metrics;
  return {
    ctr: m.ctr ?? 0,
    cpc: m.cpc ?? 0,
    cpm: m.cpm ?? 0,
    // Giữ nguyên `null` (chưa đo được doanh thu) — ép về 0 ở đây thì bản mô
    // phỏng sẽ báo "luật sẽ khớp" cho những campaign mà luật thật phải bỏ qua.
    roas: m.roas ?? null,
    spend: m.spend ?? 0,
    impressions: m.impressions ?? 0,
    frequency: m.frequency ?? 0,
    budget_used_pct: c.dailyBudget > 0 ? Math.round(((m.spend ?? 0) / c.dailyBudget) * 100) : 0,
    conversions: m.conversions ?? 0,
    cpl: (m.conversions ?? 0) > 0 ? (m.spend ?? 0) / (m.conversions as number) : 0,
    ctr_drop_pct: 0,
    days_running: 0,
    remaining_budget: 0,
    days_until_end: 0,
    end_date_is_set: 0,
  };
}

export interface EvalRow {
  campaign: Campaign;
  result: EvaluationResult;
}

/** Đánh giá 1 rule trên danh sách campaign → kết quả + conditionTrace. */
export function evaluateRuleAgainst(rule: AutomationRule, campaigns: Campaign[]): EvalRow[] {
  return campaigns.map(c => {
    const metrics = buildExtendedMetrics({
      metrics: toAutoMetrics(c),
      startDate: c.startDate,
      endDate: c.endDate ?? undefined,
      dailyBudget: c.dailyBudget,
      lifetimeBudget: c.totalBudget,
    });
    const result = evaluateRule(rule, c.id, c.name, metrics, rule.lastTriggered);
    return { campaign: c, result };
  });
}
