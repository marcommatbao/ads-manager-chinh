// ============================================================
// Outcome Evaluator — Multi-metric composite evaluator
//
// Compares before/after metric snapshots using business-weighted
// scoring. Detects confounders, assigns confidence, produces a
// fully-structured EvaluationResult.
// ============================================================

import { detectConfounders, confounderPenalty } from "./confounders";
import type {
  EvaluationInput,
  EvaluationResult,
  MetricDelta,
  CompositeScore,
  OutcomeLabel,
  ConfidenceLevel,
  MetricSnapshot,
  Confounder,
} from "./types";

// ── Metric weight model ───────────────────────────────────

interface MetricSpec {
  key:           keyof MetricSnapshot;
  label:         string;
  lowerIsBetter: boolean;
  weight:        number;           // base weight; adjusted by objective
  neutralBand:   number;           // % change within which verdict is neutral
}

const METRIC_SPECS: MetricSpec[] = [
  { key: "cpl",         label: "CPL",         lowerIsBetter: true,  weight: 0.35, neutralBand: 5  },
  { key: "roas",        label: "ROAS",         lowerIsBetter: false, weight: 0.25, neutralBand: 5  },
  { key: "leads",       label: "Leads",        lowerIsBetter: false, weight: 0.20, neutralBand: 5  },
  { key: "ctr",         label: "CTR",          lowerIsBetter: false, weight: 0.10, neutralBand: 8  },
  { key: "frequency",   label: "Frequency",    lowerIsBetter: true,  weight: 0.05, neutralBand: 10 },
  { key: "fatigueScore",label: "Fatigue",      lowerIsBetter: true,  weight: 0.05, neutralBand: 5  },
];

/** Adjust weights based on campaign objective */
function weightsForObjective(objective?: string): Record<string, number> {
  const base: Record<string, number> = {};
  METRIC_SPECS.forEach(m => { base[m.key as string] = m.weight; });

  if (!objective) return base;
  const obj = objective.toUpperCase();

  if (obj.includes("LEAD")) {
    base.cpl   = 0.40;
    base.leads = 0.25;
    base.roas  = 0.10;
  } else if (obj.includes("CONV") || obj.includes("PURCHASE")) {
    base.roas  = 0.40;
    base.cpl   = 0.25;
    base.leads = 0.10;
  } else if (obj.includes("AWARE") || obj.includes("REACH")) {
    base.ctr       = 0.35;
    base.frequency = 0.20;
    base.cpl       = 0.10;
    base.roas      = 0.05;
    base.leads     = 0.05;
  } else if (obj.includes("TRAFFIC")) {
    base.ctr  = 0.40;
    base.cpc  = 0.25;
    base.cpl  = 0.10;
    base.roas = 0.05;
  }

  // Re-normalize to sum to 1
  const total = Object.values(base).reduce((s, v) => s + v, 0);
  if (total > 0) {
    Object.keys(base).forEach(k => { base[k] /= total; });
  }
  return base;
}

// ── Per-metric delta ──────────────────────────────────────

function computeMetricDelta(
  spec:   MetricSpec,
  before: MetricSnapshot,
  after:  MetricSnapshot,
  weight: number,
  cplThreshold?: number,
): MetricDelta {
  const bv = before[spec.key] as number | undefined;
  const av = after[spec.key]  as number | undefined;

  if (bv === undefined || av === undefined || bv === null || av === null) {
    return {
      metric: spec.label, before: 0, after: 0,
      absoluteDelta: 0, pctDelta: 0, weight,
      direction: "unavailable",
    };
  }

  const abs      = av - bv;
  const pctDelta = bv !== 0 ? (abs / Math.abs(bv)) * 100 : 0;
  const isImproved = spec.lowerIsBetter ? pctDelta < -spec.neutralBand : pctDelta > spec.neutralBand;
  const isWorsened = spec.lowerIsBetter ? pctDelta > spec.neutralBand  : pctDelta < -spec.neutralBand;

  const direction: MetricDelta["direction"] =
    isImproved ? "improved" : isWorsened ? "worsened" : "neutral";

  const threshold = spec.key === "cpl" ? cplThreshold : undefined;
  const aboveThreshold = threshold !== undefined && spec.key === "cpl"
    ? av > threshold
    : undefined;

  return { metric: spec.label, before: bv, after: av, absoluteDelta: abs, pctDelta, direction, weight, threshold, aboveThreshold };
}

// ── Composite scoring ─────────────────────────────────────

function buildCompositeScore(
  deltas:    MetricDelta[],
  objective: string | undefined,
): CompositeScore {
  let score = 0;
  let primary = deltas[0];

  for (const d of deltas) {
    if (d.direction === "unavailable") continue;
    // Positive contribution if improved, negative if worsened
    const contribution = d.direction === "improved" ? d.weight * 100
                       : d.direction === "worsened" ? -d.weight * 100
                       : 0;
    score += contribution;
    if (d.weight > primary.weight) primary = d;
  }

  // Clamp to -100 to +100
  score = Math.max(-100, Math.min(100, score));

  return {
    value:         Math.round(score),
    components:    deltas,
    primaryMetric: primary.metric,
    primaryDelta:  primary,
  };
}

// ── Outcome label ─────────────────────────────────────────

function labelFromScore(
  score:       number,
  confounders: Confounder[],
  beforeMetrics: MetricSnapshot,
  afterMetrics:  MetricSnapshot,
  window:      { minSpend: number; minImpressions: number },
): OutcomeLabel {
  // Hard blocks
  if (confounders.some(c => c.type === "learning_phase")) return "blocked_by_learning";
  if (confounders.some(c => c.type === "anomaly_detected" && c.impact === "severe")) return "blocked_by_anomaly";

  // Insufficient data
  if (afterMetrics.spend < window.minSpend * 0.2 || afterMetrics.impressions < window.minImpressions * 0.2) {
    return "inconclusive";
  }

  if (score >= 40)  return "significantly_better";
  if (score >= 10)  return "better";
  if (score >= -10) return "neutral";
  if (score >= -20) return "mixed";
  if (score >= -40) return "worse";
  return "significantly_worse";
}

// ── Confidence level ──────────────────────────────────────

function confidenceFromPenalty(penalty: number, score: number): ConfidenceLevel {
  if (penalty >= 0.65) return "insufficient";
  if (penalty >= 0.35) return "low";
  if (penalty >= 0.15) return Math.abs(score) < 15 ? "low" : "medium";
  return Math.abs(score) >= 25 ? "high" : "medium";
}

// ── Rationale builder ─────────────────────────────────────

function buildPrimaryReason(composite: CompositeScore, outcome: OutcomeLabel): string {
  const p = composite.primaryDelta;
  const dir = p.direction;
  const fmt = (v: number) => Number.isInteger(v) ? v.toLocaleString("vi-VN") : v.toFixed(2);

  if (outcome === "blocked_by_learning") return "Verdict deferred — entity is still in learning phase";
  if (outcome === "blocked_by_anomaly")  return "Verdict invalidated — anomaly detected during window";
  if (outcome === "inconclusive") return "Insufficient spend or impression volume for reliable comparison";

  const delta = p.pctDelta >= 0 ? `+${p.pctDelta.toFixed(1)}%` : `${p.pctDelta.toFixed(1)}%`;
  const fromTo = `${fmt(p.before)} → ${fmt(p.after)}`;

  if (dir === "improved") return `${p.metric} improved ${delta} (${fromTo}) — primary positive driver`;
  if (dir === "worsened") return `${p.metric} degraded ${delta} (${fromTo}) — primary concern`;
  return `${p.metric} changed ${delta} — within neutral range`;
}

// ── Next step recommendation ──────────────────────────────

function buildNextStep(outcome: OutcomeLabel, event: string, composite: CompositeScore): string {
  const group = event.split(".")[0];

  switch (outcome) {
    case "significantly_better": return "Scale this approach — consider repeating or expanding similar actions";
    case "better":               return "Continue current direction; monitor for the next evaluation window";
    case "neutral":              return "No significant effect — investigate other levers or wait for more data";
    case "mixed":                return "Review mixed signals: address the degraded metric before scaling";
    case "worse": {
      if (group === "budget") return "Consider reverting budget change or reducing further to recover CPL";
      if (group === "creative") return "Consider reverting to the previous creative or running a new A/B test";
      if (group === "adset") return "Consider reverting audience or placement change";
      return "Review and consider reverting the action that led to this outcome";
    }
    case "significantly_worse": return "Revert or pause this change immediately; open manual review";
    case "blocked_by_learning": return "Wait for learning phase to exit before evaluating (typically 50 optimization events)";
    case "blocked_by_anomaly":  return "Investigate the detected anomaly before attributing outcome to this action";
    case "inconclusive":        return "Allow more time or increase budget/scale to reach a reliable evaluation window";
    default:                    return "Monitor and re-evaluate at the next scheduled window";
  }
}

// ── Main evaluate function ────────────────────────────────

export function evaluate(input: EvaluationInput): EvaluationResult {
  const weights   = weightsForObjective(input.objective);
  const confounders = detectConfounders(input, input.window);
  const penalty   = confounderPenalty(confounders);

  // Compute deltas for all metrics
  const deltas: MetricDelta[] = METRIC_SPECS.map(spec =>
    computeMetricDelta(spec, input.before, input.after, weights[spec.key as string] ?? spec.weight, input.context.cplThreshold)
  );

  const composite = buildCompositeScore(deltas, input.objective);
  // Apply confounder penalty to composite score
  const penalizedScore = composite.value * (1 - penalty * 0.5);

  const outcomeLabel    = labelFromScore(penalizedScore, confounders, input.before, input.after, input.window);
  const confidenceLevel = confidenceFromPenalty(penalty, penalizedScore);
  const primaryReason   = buildPrimaryReason(composite, outcomeLabel);
  const nextStep        = buildNextStep(outcomeLabel, input.event, composite);

  // Normalized delta: map composite -100→+100 to -1→+1
  const normalizedDelta = Math.round((penalizedScore / 100) * 100) / 100;

  return {
    outcomeLabel,
    confidenceLevel,
    compositeScore: { ...composite, value: Math.round(penalizedScore) },
    beforeMetrics:  input.before,
    afterMetrics:   input.after,
    normalizedDelta,
    primaryReason,
    confounders,
    recommendedNextStep: nextStep,
    evaluationWindow:   input.window,
    evaluatedAt:        new Date().toISOString(),
    company:            input.company,
    objective:          input.objective,
    decisionId:         input.decisionId,
    entityId:           input.entityId,
    entityName:         input.entityName,
  };
}
