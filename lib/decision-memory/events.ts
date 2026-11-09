// ============================================================
// Decision Memory — Event taxonomy helpers
// Window presets, destructive-action classification, defaults.
// ============================================================

import type { DecisionEvent, DecisionContext, EvaluationWindow, OutcomeDirection, TargetMetric } from "./types";

// ── Window preset definition ──────────────────────────────

export interface WindowPreset {
  label:           string;
  checkAfterHours: number;
}

const W = {
  quick4h:      { label: "quick_4h",      checkAfterHours: 4   },
  learning24h:  { label: "learning_24h",  checkAfterHours: 24  },
  standard48h:  { label: "standard_48h",  checkAfterHours: 48  },
  extended72h:  { label: "extended_72h",  checkAfterHours: 72  },
  week7d:       { label: "week_7d",       checkAfterHours: 168 },
  monthly30d:   { label: "monthly_30d",   checkAfterHours: 720 },
} as const satisfies Record<string, WindowPreset>;

// ── Event → base windows ──────────────────────────────────

const BASE_WINDOWS: Partial<Record<DecisionEvent, WindowPreset[]>> = {
  "budget.increase":              [W.standard48h, W.week7d],
  "budget.decrease":              [W.quick4h, W.standard48h],
  "budget.redistribute":          [W.standard48h, W.week7d],
  "budget.cap_set":               [W.week7d],
  "budget.cap_removed":           [W.standard48h, W.week7d],

  "campaign.launch":              [W.learning24h, W.week7d, W.monthly30d],
  "campaign.pause":               [W.quick4h, W.standard48h],
  "campaign.resume":              [W.quick4h, W.learning24h, W.week7d],
  "campaign.archive":             [],
  "campaign.duplicate":           [W.week7d],

  "adset.pause":                  [W.quick4h, W.standard48h],
  "adset.resume":                 [W.quick4h, W.learning24h, W.week7d],
  "adset.audience_change":        [W.learning24h, W.week7d],
  "adset.placement_change":       [W.standard48h, W.week7d],
  "adset.schedule_change":        [W.standard48h, W.week7d],
  "adset.bid_strategy_change":    [W.learning24h, W.week7d],

  "creative.refresh":             [W.standard48h, W.week7d],
  "creative.pause_fatigued":      [W.standard48h, W.week7d],
  "creative.promote_winner":      [W.week7d, W.monthly30d],

  "automation.rule_triggered":    [],
  "automation.rule_applied":      [W.standard48h],
  "automation.rule_blocked":      [],
  "automation.sim_approved":      [W.standard48h],

  "ab.test_started":              [W.monthly30d],
  "ab.winner_declared":           [W.week7d, W.monthly30d],
  "ab.variant_paused":            [W.standard48h],

  "nba.recommendation_applied":   [W.standard48h, W.week7d],
  "nba.recommendation_dismissed": [],
  "nba.recommendation_deferred":  [],

  "audit.config_changed":         [W.week7d],
  "audit.credentials_rotated":    [],
  "audit.threshold_adjusted":     [W.week7d],
};

// ── Context modifiers ─────────────────────────────────────

function unique(presets: WindowPreset[]): WindowPreset[] {
  const seen = new Set<string>();
  return presets.filter(p => {
    if (seen.has(p.label)) return false;
    seen.add(p.label);
    return true;
  });
}

/**
 * Build EvaluationWindow[] for an event given the context at decision time.
 * Applies modifiers: learning phase, high budget utilization, A/B test flag.
 */
export function windowsForEvent(
  event:     DecisionEvent,
  context:   DecisionContext,
  createdAt: string,
): EvaluationWindow[] {
  let presets: WindowPreset[] = [...(BASE_WINDOWS[event] ?? [W.standard48h])];

  // Learning phase → prepend learning_24h; extend standard_48h to extended_72h
  if (context.learningPhase) {
    presets = [W.learning24h, ...presets.filter(p => p.label !== "learning_24h")]
      .map(p => p.label === "standard_48h" ? W.extended72h : p);
  }

  // High budget utilization → add quick check for any budget event
  if (
    (context.budgetUtilizationPct ?? 0) > 85 &&
    (event.startsWith("budget.") || event.startsWith("campaign."))
  ) {
    presets = [W.quick4h, ...presets.filter(p => p.label !== "quick_4h")];
  }

  // A/B test ongoing → only long window (avoid polluting signal)
  if (context.triggeredByNba === false && event.startsWith("ab.")) {
    presets = [W.monthly30d];
  }

  const base = new Date(createdAt).getTime();
  return unique(presets).map(p => ({
    label:           p.label,
    checkAfterHours: p.checkAfterHours,
    dueAt:           new Date(base + p.checkAfterHours * 3_600_000).toISOString(),
    status:          "pending" as const,
    autoChecked:     false,
  }));
}

// ── Default expected outcome per event ───────────────────

interface OutcomeDefaults {
  direction:      OutcomeDirection;
  targetMetric:   TargetMetric;
  timeframeHours: number;
}

export const EVENT_OUTCOME_DEFAULTS: Partial<Record<DecisionEvent, OutcomeDefaults>> = {
  "budget.increase":           { direction: "improve",       targetMetric: "leads",       timeframeHours: 48 },
  "budget.decrease":           { direction: "stabilize",     targetMetric: "cpl",         timeframeHours: 48 },
  "campaign.pause":            { direction: "recover",       targetMetric: "cpl",         timeframeHours: 48 },
  "campaign.resume":           { direction: "improve",       targetMetric: "impressions", timeframeHours: 24 },
  "campaign.launch":           { direction: "improve",       targetMetric: "cpl",         timeframeHours: 168 },
  "creative.refresh":          { direction: "improve",       targetMetric: "ctr",         timeframeHours: 48 },
  "creative.pause_fatigued":   { direction: "recover",       targetMetric: "fatigue_score", timeframeHours: 48 },
  "creative.promote_winner":   { direction: "improve",       targetMetric: "roas",        timeframeHours: 168 },
  "adset.audience_change":     { direction: "improve",       targetMetric: "cpl",         timeframeHours: 168 },
  "adset.bid_strategy_change": { direction: "stabilize",     targetMetric: "cpl",         timeframeHours: 168 },
  "automation.rule_applied":   { direction: "improve",       targetMetric: "cpl",         timeframeHours: 48 },
  "nba.recommendation_applied":{ direction: "improve",       targetMetric: "cpl",         timeframeHours: 48 },
  "audit.threshold_adjusted":  { direction: "stabilize",     targetMetric: "cpl",         timeframeHours: 168 },
};

// ── Destructive event flag ────────────────────────────────

const DESTRUCTIVE_EVENTS = new Set<DecisionEvent>([
  "campaign.pause",
  "campaign.archive",
  "adset.pause",
  "creative.pause_fatigued",
  "automation.rule_blocked",
  "budget.decrease",
]);

export function isDestructiveEvent(event: DecisionEvent): boolean {
  return DESTRUCTIVE_EVENTS.has(event);
}

// ── Learning signal TTL (days) ────────────────────────────

export const LEARNING_SIGNAL_TTL_DAYS: Partial<Record<string, number>> = {
  "budget":       180,
  "creative":     90,
  "adset":        120,
  "automation":   60,
  "audit":        365,
  "nba":          90,
  "campaign":     180,
  "ab":           365,
};

export function signalTtlDays(event: DecisionEvent): number {
  const group = event.split(".")[0];
  return LEARNING_SIGNAL_TTL_DAYS[group] ?? 90;
}
