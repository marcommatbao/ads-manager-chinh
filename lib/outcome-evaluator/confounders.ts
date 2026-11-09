// ============================================================
// Outcome Evaluator — Confounder detection
// Identifies noise factors that degrade verdict confidence.
// ============================================================

import type { Confounder, EvaluationInput, EvaluationWindowConfig } from "./types";

export function detectConfounders(
  input:  EvaluationInput,
  window: EvaluationWindowConfig,
): Confounder[] {
  const found: Confounder[] = [];
  const after  = input.after;
  const before = input.before;
  const ctx    = input.context;

  // Learning phase — entity re-entered learning after the action
  if (ctx.learningPhase) {
    found.push({
      type:   "learning_phase",
      detail: "Entity is in or returned to learning phase — Meta algorithm is still adjusting delivery",
      impact: "severe",
    });
  }

  // External anomaly detected during evaluation window
  if (ctx.anomalyDetected) {
    found.push({
      type:   "anomaly_detected",
      detail: "An anomaly signal was detected during the evaluation window — results may reflect external factors",
      impact: "moderate",
    });
  }

  // Concurrent changes on same entity
  if ((ctx.concurrentChanges ?? 0) > 0) {
    found.push({
      type:   "concurrent_change",
      detail: `${ctx.concurrentChanges} other change(s) were made on this entity during the evaluation window — isolation is limited`,
      impact: ctx.concurrentChanges! >= 3 ? "severe" : ctx.concurrentChanges! >= 2 ? "moderate" : "mild",
    });
  }

  // Budget cap hit during window
  if (ctx.budgetCapHit) {
    found.push({
      type:   "budget_capped",
      detail: "Budget cap was reached during the evaluation window — delivery may have been artificially constrained",
      impact: "moderate",
    });
  }

  // Low spend (after period)
  if (after.spend < window.minSpend) {
    found.push({
      type:   "low_spend",
      detail: `After-period spend (₫${Math.round(after.spend / 1000)}K) is below the confidence threshold (₫${Math.round(window.minSpend / 1000)}K) for a ${window.label} window`,
      impact: after.spend < window.minSpend * 0.3 ? "severe" : "moderate",
    });
  }

  // Low impression volume
  if (after.impressions < window.minImpressions) {
    found.push({
      type:   "low_impressions",
      detail: `After-period impressions (${after.impressions.toLocaleString("vi-VN")}) are below the minimum for reliable statistical comparison (${window.minImpressions.toLocaleString("vi-VN")})`,
      impact: after.impressions < window.minImpressions * 0.3 ? "severe" : "moderate",
    });
  }

  // Frequency spike (potential reach saturation)
  if ((after.frequency ?? 0) > 4.5 && (before.frequency ?? 0) < (after.frequency ?? 0) * 0.8) {
    found.push({
      type:   "seasonality",
      detail: `Frequency rose from ${(before.frequency ?? 0).toFixed(1)} to ${(after.frequency ?? 0).toFixed(1)} — audience saturation may be masking true performance effect`,
      impact: "mild",
    });
  }

  // Evaluation window shorter than recommended for targeting/creative changes
  const group = input.event.split(".")[0];
  const longWindowEvents = ["adset", "creative", "campaign"];
  if (longWindowEvents.includes(group) && window.hours < 72) {
    found.push({
      type:   "short_window",
      detail: `${window.label} window is shorter than the recommended 3d for ${group} changes — Meta needs time to re-optimize delivery`,
      impact: "mild",
    });
  }

  return found;
}

/** Convert confounder list to a confidence penalty (0 = no penalty, 1 = full degradation) */
export function confounderPenalty(confounders: Confounder[]): number {
  const WEIGHTS = { mild: 0.10, moderate: 0.25, severe: 0.45 } as const;
  const total = confounders.reduce((sum, c) => sum + WEIGHTS[c.impact], 0);
  return Math.min(1, total);
}
