// ============================================================
// NBA adapter — map /improvements (ImprovementLike[]) → NbaSignal[]
// Gom các đề xuất hiện có vào engine thống nhất (không thay thế mù).
// ============================================================

import type {
  ImprovementLike,
  NbaSignal,
  NbaContext,
  NbaReasonCode,
  NbaEntityType,
  NbaCompany,
  NbaPlatform,
  NbaSeverity,
} from "../types";

const TYPE_TO_REASON: Record<string, NbaReasonCode> = {
  FIX_LOW_QS_KEYWORD: "FIX_LOW_QS_KEYWORD",
  PAUSE_FB_AD_LOW_CTR: "PAUSE_FB_AD_LOW_CTR",
  PAUSE_FB_AD_FATIGUE: "PAUSE_FB_AD_LOW_CTR",
  DAYPART_OPPORTUNITY: "DAYPART_OPPORTUNITY",
  PAUSE_KEYWORD: "NEGATIVE_KEYWORD_WASTE",
  PAUSE_SEARCH_TERM: "NEGATIVE_KEYWORD_WASTE",
  NEGATIVE_BRAND_LEAK: "NEGATIVE_KEYWORD_WASTE",
};

const REASON_ENTITY: Record<NbaReasonCode, NbaEntityType> = {
  CPL_CRITICAL: "campaign", CPL_WARNING: "campaign", ZERO_CONV_SPEND: "campaign",
  CREATIVE_FATIGUE: "creative", SCALE_WINNER: "budget", LOW_ROAS_REVIEW: "budget",
  FIX_LOW_QS_KEYWORD: "keyword", PAUSE_FB_AD_LOW_CTR: "creative",
  DAYPART_OPPORTUNITY: "schedule", NEGATIVE_KEYWORD_WASTE: "keyword",
  IMPROVEMENT_OTHER: "account",
};

function normCompany(c?: string): NbaCompany | null {
  const u = (c ?? "").toUpperCase();
  if (u.includes("MBI")) return "MBI";
  if (u.includes("MBC")) return "MBC";
  return null;
}

function platformOf(src?: string): NbaPlatform {
  return src === "FACEBOOK" ? "facebook" : "google";
}

function severityOf(priority?: string): NbaSeverity {
  return priority === "HIGH" ? "critical" : priority === "MEDIUM" ? "warning" : "info";
}

export function improvementsToSignals(improvements: ImprovementLike[], ctx: NbaContext): NbaSignal[] {
  const allowed = new Set(ctx.companies);
  const out: NbaSignal[] = [];

  improvements.forEach((imp, idx) => {
    const company = normCompany(imp.company);
    if (!company || !allowed.has(company)) return;

    const reasonCode = TYPE_TO_REASON[imp.type] ?? "IMPROVEMENT_OTHER";
    const entityType = REASON_ENTITY[reasonCode];
    const entityId = imp.id ?? `imp:${imp.type}:${imp.campaignName ?? imp.keyword ?? idx}`;
    const entityName = imp.campaignName ?? imp.keyword ?? imp.adName ?? imp.title ?? imp.type;

    out.push({
      reasonCode,
      company,
      platform: platformOf(imp.source),
      entityType,
      entityId,
      entityName,
      title: imp.title ?? imp.type,
      explanation: imp.description ?? imp.impact ?? "Đề xuất tối ưu từ hệ thống Improvements.",
      evidence: imp.impactValue ? [{ metric: "impactValue", current: Math.round(imp.impactValue), unit: "₫" }] : [],
      severity: severityOf(imp.priority),
      // improvements không có sample size rõ ràng → để engine hạ confidence/đánh LOW_DATA
      sampleSize: undefined,
      // Ước lượng thô (tỷ lệ gõ tay) không đưa thành "tiết kiệm/tháng" ở Next Best Action.
      impactEstimate: imp.impactValue && !imp.impactRough
        ? { metric: "spend", direction: "reduce_waste", estMonthlySavingsVnd: Math.round(imp.impactValue) }
        : undefined,
      sourceEngine: "improvements",
      originReason: imp.type,
    });
  });

  return out;
}
