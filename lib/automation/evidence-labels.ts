import type { MessageKey } from "@/lib/i18n/messages";

const evidenceKeys: Record<string, MessageKey> = {
  campaign_attributed_revenue: "overview.evidence.campaign_attributed_revenue",
  approved_break_even_roas: "overview.evidence.approved_break_even_roas",
  campaign_attribution_coverage: "overview.evidence.campaign_attribution_coverage",
  verified_learning_status: "overview.evidence.verified_learning_status",
  verified_budget_currency_unit: "overview.evidence.verified_budget_currency_unit",
  daily_period_spend_mismatch: "overview.evidence.daily_period_spend_mismatch",
};
export function evidenceMessageKey(code: string): MessageKey {
  return Object.prototype.hasOwnProperty.call(evidenceKeys, code) ? evidenceKeys[code] : "overview.evidence.unknown";
}
