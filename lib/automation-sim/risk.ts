// ============================================================
// Automation Sim — action metadata + risk scoring
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { Action, ActionType } from "@/lib/automation-shared";
import type { SimProposedAction, SimRisk, SimRiskBand } from "./types";

interface ActionMeta { label: string; mutating: boolean; destructive: boolean; reversible: boolean }

const ACTION_META: Record<ActionType, ActionMeta> = {
  pause_campaign:       { label: "Tạm dừng campaign", mutating: true, destructive: true, reversible: true },
  activate_campaign:    { label: "Bật lại campaign", mutating: true, destructive: false, reversible: true },
  pause_adset:          { label: "Tạm dừng ad set", mutating: true, destructive: true, reversible: true },
  pause_ad:             { label: "Tạm dừng ad", mutating: true, destructive: true, reversible: true },
  increase_budget:      { label: "Tăng ngân sách", mutating: true, destructive: false, reversible: true },
  decrease_budget:      { label: "Giảm ngân sách", mutating: true, destructive: true, reversible: true },
  send_notification:    { label: "Gửi thông báo", mutating: false, destructive: false, reversible: true },
  send_email:           { label: "Gửi email", mutating: false, destructive: false, reversible: true },
  send_webhook:         { label: "Gọi webhook", mutating: false, destructive: false, reversible: true },
  add_to_report:        { label: "Thêm vào báo cáo", mutating: false, destructive: false, reversible: true },
  request_ai_evaluation:{ label: "Yêu cầu AI đánh giá", mutating: false, destructive: false, reversible: true },
  create_alert:         { label: "Tạo cảnh báo", mutating: false, destructive: false, reversible: true },
  suggest_new_creative: { label: "Gợi ý creative mới", mutating: false, destructive: false, reversible: true },
};

export function describeAction(action: Action): SimProposedAction {
  const meta = ACTION_META[action.type];
  const params: Record<string, number | string> = {};
  if (action.value != null) params.value = action.value;
  if (action.message) params.message = action.message;
  return { type: action.type, label: meta.label, params, mutating: meta.mutating, destructive: meta.destructive, reversible: meta.reversible };
}

/** Ước tính ₫ ảnh hưởng/tháng của action lên campaign. */
export function estImpactVnd(c: Campaign, action: SimProposedAction): number {
  const spend = c.metrics.spend ?? 0;
  if (!action.mutating) return 0;
  if (action.destructive) return Math.round(spend); // pause/giảm → chặn lãng phí ≈ spend kỳ
  if (action.type === "increase_budget") return Math.round(spend * ((Number(action.params?.value) || 20) / 100));
  return Math.round(spend * 0.1);
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function scoreImpact(vnd: number): number {
  if (vnd <= 0) return 10;
  return clamp((Math.log10(vnd) - 4) * 30);
}

function scoreConfidence(sampleSize: number): number {
  if (sampleSize >= 200) return 95;
  if (sampleSize >= 50) return 80;
  if (sampleSize >= 20) return 55;
  if (sampleSize >= 5) return 35;
  return 15;
}

function band(score: number): SimRiskBand {
  return score >= 70 ? "high" : score >= 40 ? "medium" : "low";
}

export function scoreRisk(c: Campaign, action: SimProposedAction): SimRisk {
  const sample = (c.metrics.conversions ?? 0) || (c.metrics.clicks ?? 0);
  const impactVnd = estImpactVnd(c, action);
  const impact = scoreImpact(impactVnd);
  const confidence = scoreConfidence(sample);
  const dataCompleteness = scoreConfidence(sample);
  const reversibility = action.reversible ? 90 : 20;
  const destructiveness = action.destructive ? 90 : action.mutating ? 40 : 5;
  // urgency: phá hoại trên spend lớn = gấp
  const urgency = action.destructive ? clamp(impact + 20) : action.mutating ? 40 : 15;

  // riskScore = mức rủi ro khi auto-apply
  const riskScore = clamp(
    0.35 * destructiveness +
    0.25 * (100 - reversibility) +
    0.25 * (100 - confidence) +
    0.15 * impact
  );
  // safetyScore = đảo ngược được + ít phá hoại
  const safetyScore = clamp(0.6 * reversibility + 0.4 * (100 - destructiveness));

  return { impact, urgency, confidence, dataCompleteness, reversibility, destructiveness, riskScore, safetyScore, band: band(riskScore) };
}
