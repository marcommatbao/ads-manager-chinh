// ============================================================
// Decision Memory — Type definitions
// All interfaces for the full decision memory model.
// ============================================================

// ── Source ────────────────────────────────────────────────

export type DecisionSource =
  | { type: "human_manual";    actor: string }
  | { type: "ai_suggestion";   model: string; promptRef?: string; confidence: number }
  | { type: "automation_rule"; ruleId: string; ruleName: string; platform: string }
  | { type: "nba_engine";      recommendationId: string; nbaConfidence: number }
  | { type: "cron_auto_apply"; jobId: string }
  | { type: "audit_fix";       auditDomain: string }
  | { type: "api_external";    caller: string };

// ── Event taxonomy ────────────────────────────────────────

export type DecisionEvent =
  // Budget
  | "budget.increase"
  | "budget.decrease"
  | "budget.redistribute"
  | "budget.cap_set"
  | "budget.cap_removed"
  // Campaign lifecycle
  | "campaign.launch"
  | "campaign.pause"
  | "campaign.resume"
  | "campaign.archive"
  | "campaign.duplicate"
  // Ad set / targeting
  | "adset.pause"
  | "adset.resume"
  | "adset.audience_change"
  | "adset.placement_change"
  | "adset.schedule_change"
  | "adset.bid_strategy_change"
  // Creative
  | "creative.refresh"
  | "creative.pause_fatigued"
  | "creative.promote_winner"
  // Automation
  | "automation.rule_triggered"
  | "automation.rule_applied"
  | "automation.rule_blocked"
  | "automation.sim_approved"
  // A/B testing
  | "ab.test_started"
  | "ab.winner_declared"
  | "ab.variant_paused"
  // NBA / recommendations
  | "nba.recommendation_applied"
  | "nba.recommendation_dismissed"
  | "nba.recommendation_deferred"
  // Audit / config
  | "audit.config_changed"
  | "audit.credentials_rotated"
  | "audit.threshold_adjusted";

// ── Action payload ────────────────────────────────────────

export interface ActionPayload {
  field?:        string;
  valueBefore?:  unknown;
  valueAfter?:   unknown;
  delta?:        number;
  deltaPercent?: number;
  unit?:         string;
  notes?:        string;
}

// ── Target ────────────────────────────────────────────────

export type EntityType =
  | "campaign" | "adset" | "creative" | "audience"
  | "budget"   | "rule"  | "connector" | "account";

export interface DecisionTarget {
  company:      string;
  platform:     "meta" | "google_ads" | "cross_platform" | "manual";
  entityType:   EntityType;
  entityId:     string;
  entityName:   string;
  accountId?:   string;
  parentId?:    string;
  parentName?:  string;
}

// ── Context ───────────────────────────────────────────────

export interface DecisionContext {
  objective?:                  string;
  funnelPhase?:                "awareness" | "consideration" | "conversion" | "retention";
  learningPhase?:              boolean;
  learningPhaseExitImminent?:  boolean;
  daysRunning?:                number;

  dayOfWeek?:                  number;
  hourOfDay?:                  number;
  seasonalNote?:               string;

  budgetUtilizationPct?:       number;
  budgetPacingStatus?:         "on_track" | "underpacing" | "overpacing";

  anomalyFlags?:               string[];
  qualityRanking?:             string;

  cplThresholdMbc?:            number;
  cplThresholdMbi?:            number;
  roasTarget?:                 number;
  cooldownActiveUntil?:        string;

  triggeredByAlertId?:         string;
  triggeredByBriefing?:        boolean;
  triggeredByNba?:             boolean;
}

// ── Expected outcome ──────────────────────────────────────

export type OutcomeDirection = "improve" | "stabilize" | "reduce_spend" | "test" | "recover";
export type TargetMetric = "cpl" | "roas" | "spend" | "leads" | "impressions" | "ctr" | "fatigue_score" | "frequency" | "quality_ranking";

export interface ExpectedOutcome {
  direction:       OutcomeDirection;
  targetMetric:    TargetMetric;
  targetDeltaPct?: number;
  timeframeHours:  number;
  hypothesis:      string;
}

// ── Metric snapshot ───────────────────────────────────────

export interface DmMetricSnapshot {
  impressions:     number;
  clicks:          number;
  spend:           number;
  ctr:             number;
  cpc:             number;
  cpl:             number;
  leads?:          number;
  roas?:           number;
  frequency?:      number;
  fatigueScore?:   number;
  qualityRanking?: string;
  period:          string;
  capturedAt:      string;
}

// ── Evaluation windows ────────────────────────────────────

export type WindowVerdict = "better" | "worse" | "neutral" | "inconclusive" | "too_early";

export interface EvaluationWindow {
  label:           string;
  checkAfterHours: number;
  dueAt:           string;
  status:          "pending" | "checked" | "skipped";
  autoChecked:     boolean;
  checkedAt?:      string;
  snapshotAfter?:  DmMetricSnapshot;
  verdict?:        WindowVerdict;
  verdictNote?:    string;
}

// ── Learning signal ───────────────────────────────────────

export interface LearningSignal {
  shouldRepeat:           boolean;
  contextFingerprint:     string[];
  confidenceAdjustment:   number;
  expiresAt?:             string;
}

// ── Outcome ───────────────────────────────────────────────

export type FinalVerdict = "better" | "worse" | "neutral" | "inconclusive" | "overridden";

export interface DecisionOutcome {
  finalVerdict:    FinalVerdict;
  verdictAt:       string;
  summaryNote:     string;
  learningSignal?: LearningSignal;
}

// ── Cross-system links ────────────────────────────────────

export interface DecisionLinks {
  changeTrackerId?:       string;
  automationRunId?:       string;
  nbaRecommendationId?:   string;
  jobRunId?:              string;
  parentDecisionId?:      string;
  abTestId?:              string;
  alertId?:               string;
  auditEntryId?:          string;
}

// ── Manual override ───────────────────────────────────────

export interface ManualOverride {
  by:          string;
  at:          string;
  reason:      string;
  overrodeTo:  string;
}

// ── Core entry ────────────────────────────────────────────

export interface DecisionMemoryEntry {
  id:                 string;
  createdAt:          string;
  updatedAt:          string;

  source:             DecisionSource;
  event:              DecisionEvent;
  action:             ActionPayload;
  target:             DecisionTarget;
  context:            DecisionContext;

  rationale:          string;
  confidence?:        number;
  expectedOutcome:    ExpectedOutcome;
  snapshotBefore:     DmMetricSnapshot;
  evaluationWindows:  EvaluationWindow[];

  outcome?:           DecisionOutcome;
  links:              DecisionLinks;

  reviewedBy?:        string;
  reviewedAt?:        string;
  manualOverride?:    ManualOverride;

  /** Đợt 23 (3c): đã hoàn tác từ trang "Đã làm & kết quả" (POST /api/writes/undo). */
  undoneAt?:          string;
  undoneBy?:          string;
}

// ── File shape ────────────────────────────────────────────

export interface DecisionMemoryFile {
  updatedAt: string;
  entries:   DecisionMemoryEntry[];
}
