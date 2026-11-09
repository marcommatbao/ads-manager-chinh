// ============================================================
// Outcome Evaluator — Evaluation window configurations
// ============================================================

import type { EvaluationWindowConfig } from "./types";

export const WINDOWS: Record<string, EvaluationWindowConfig> = {
  "1d": {
    label:           "1d",
    hours:           24,
    minSpend:        500_000,    // 500K VND
    minImpressions:  500,
    description:     "24-hour quick check — good for pause/resume and urgent budget changes",
  },
  "3d": {
    label:           "3d",
    hours:           72,
    minSpend:        1_500_000,  // 1.5M VND
    minImpressions:  2_000,
    description:     "3-day standard check — default for budget and creative changes",
  },
  "7d": {
    label:           "7d",
    hours:           168,
    minSpend:        3_000_000,  // 3M VND
    minImpressions:  5_000,
    description:     "7-day deep review — targeting changes, audience changes, launches",
  },
  "14d": {
    label:           "14d",
    hours:           336,
    minSpend:        7_000_000,  // 7M VND
    minImpressions:  10_000,
    description:     "14-day strategic review — A/B tests, campaign launches",
  },
};

/** Pick the recommended window for an event type */
export function recommendedWindow(event: string): EvaluationWindowConfig {
  const group = event.split(".")[0];
  switch (group) {
    case "creative":  return WINDOWS["7d"];
    case "adset":     return WINDOWS["7d"];
    case "campaign":
      if (event === "campaign.pause" || event === "campaign.resume") return WINDOWS["3d"];
      if (event === "campaign.launch") return WINDOWS["7d"];
      return WINDOWS["3d"];
    case "budget":
      if (event === "budget.decrease") return WINDOWS["1d"];
      return WINDOWS["3d"];
    case "automation":
    case "nba":
      return WINDOWS["3d"];
    default:
      return WINDOWS["3d"];
  }
}

export function getWindow(label: string): EvaluationWindowConfig {
  return WINDOWS[label] ?? WINDOWS["3d"];
}
