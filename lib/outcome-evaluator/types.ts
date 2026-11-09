// ============================================================
// Outcome Evaluator — Shared types
// Multi-metric, confounder-aware evaluation of ad optimization decisions.
// ============================================================

// ── Outcome labels ────────────────────────────────────────

export type OutcomeLabel =
  | "significantly_better"    // clear improvement across multiple metrics
  | "better"                  // primary metric improved, no regressions
  | "mixed"                   // some metrics better, some worse
  | "neutral"                 // no meaningful change
  | "worse"                   // primary metric degraded
  | "significantly_worse"     // clear degradation across multiple metrics
  | "inconclusive"            // insufficient data or too noisy to judge
  | "blocked_by_learning"     // entity still in learning phase — verdict deferred
  | "blocked_by_anomaly";     // external anomaly detected — result is confounded

// ── Confidence level ─────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

// ── Confounder types ─────────────────────────────────────

export type ConfounderType =
  | "learning_phase"          // entity re-entered learning after action
  | "concurrent_change"       // another change happened on same entity during window
  | "anomaly_detected"        // anomaly flag set during evaluation window
  | "low_spend"               // spend too low for statistical confidence
  | "low_impressions"         // impression volume below threshold
  | "seasonality"             // detected day-of-week or seasonal pattern
  | "budget_capped"           // budget cap hit during evaluation window (limits scale)
  | "platform_outage"         // known platform data gap
  | "short_window";           // evaluation window shorter than recommended for action type

export interface Confounder {
  type:    ConfounderType;
  detail:  string;
  impact:  "mild" | "moderate" | "severe";  // how much this degrades confidence
}

// ── Per-metric delta ──────────────────────────────────────

export interface MetricDelta {
  metric:       string;
  before:       number;
  after:        number;
  absoluteDelta: number;
  pctDelta:     number;             // signed; negative means decreased
  direction:    "improved" | "worsened" | "neutral" | "unavailable";
  weight:       number;             // 0–1; contribution to composite score
  threshold?:   number;             // business threshold for this metric
  aboveThreshold?: boolean;         // whether after-value breaches threshold
}

// ── Composite score ───────────────────────────────────────

export interface CompositeScore {
  value:       number;   // -100 to +100; positive = improvement
  components:  MetricDelta[];
  primaryMetric: string;           // metric with highest weight
  primaryDelta:  MetricDelta;
}

// ── Evaluation result ─────────────────────────────────────

export interface EvaluationResult {
  // Primary verdict
  outcomeLabel:       OutcomeLabel;
  confidenceLevel:    ConfidenceLevel;
  compositeScore:     CompositeScore;

  // Raw data
  beforeMetrics:      MetricSnapshot;
  afterMetrics:       MetricSnapshot;

  // Summary
  normalizedDelta:    number;    // -1 to +1 summary; positive = better
  primaryReason:      string;    // plain-language main driver
  confounders:        Confounder[];
  recommendedNextStep: string;   // what to do given this outcome

  // Context
  evaluationWindow:   EvaluationWindowConfig;
  evaluatedAt:        string;    // ISO8601
  company:            string;
  objective?:         string;

  // For storage and retrieval
  decisionId?:        string;    // links back to decision-memory entry
  entityId:           string;
  entityName:         string;
}

// ── Metric snapshot ───────────────────────────────────────

export interface MetricSnapshot {
  impressions:    number;
  clicks:         number;
  spend:          number;
  ctr:            number;
  cpc:            number;
  cpl:            number;
  leads?:         number;
  roas?:          number;
  frequency?:     number;
  fatigueScore?:  number;
  healthScore?:   number;
  period:         string;
  capturedAt:     string;
}

// ── Evaluation window config ──────────────────────────────

export interface EvaluationWindowConfig {
  label:        string;       // "1d" | "3d" | "7d" | custom
  hours:        number;
  minSpend:     number;       // VND threshold for confidence
  minImpressions: number;
  description:  string;
}

// ── Evaluation input ──────────────────────────────────────

export interface EvaluationInput {
  entityId:       string;
  entityName:     string;
  company:        string;
  event:          string;          // decision event type e.g. "budget.increase"
  objective?:     string;
  before:         MetricSnapshot;
  after:          MetricSnapshot;
  window:         EvaluationWindowConfig;
  context: {
    learningPhase?:     boolean;
    anomalyDetected?:   boolean;
    concurrentChanges?: number;    // count of other changes during window
    budgetCapHit?:      boolean;
    cplThreshold?:      number;
    roasTarget?:        number;
    daysSinceAction?:   number;
  };
  decisionId?:    string;
}
