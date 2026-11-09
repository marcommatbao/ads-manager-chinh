// ============================================================
// Decision Memory — Recorder
// Public API for creating and updating decision entries.
// ============================================================

import { append, updateEntry, generateId } from "./store";
import { windowsForEvent, EVENT_OUTCOME_DEFAULTS, isDestructiveEvent } from "./events";
import type {
  DecisionMemoryEntry,
  DecisionSource,
  DecisionEvent,
  ActionPayload,
  DecisionTarget,
  DecisionContext,
  ExpectedOutcome,
  DmMetricSnapshot,
  DecisionLinks,
  DecisionOutcome,
  FinalVerdict,
} from "./types";

// ── Record params ─────────────────────────────────────────

export interface RecordDecisionParams {
  source:           DecisionSource;
  event:            DecisionEvent;
  action:           ActionPayload;
  target:           DecisionTarget;
  context?:         DecisionContext;
  rationale:        string;
  confidence?:      number;
  expectedOutcome?: Partial<ExpectedOutcome>;
  snapshotBefore?:  Partial<DmMetricSnapshot>;
  links?:           DecisionLinks;
}

function emptySnapshot(period: string): DmMetricSnapshot {
  return { impressions: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpl: 0, period, capturedAt: new Date().toISOString() };
}

/** Build a complete ExpectedOutcome, filling defaults from event taxonomy. */
function buildExpectedOutcome(event: DecisionEvent, partial?: Partial<ExpectedOutcome>): ExpectedOutcome {
  const defaults = EVENT_OUTCOME_DEFAULTS[event];
  return {
    direction:       partial?.direction      ?? defaults?.direction       ?? "improve",
    targetMetric:    partial?.targetMetric   ?? defaults?.targetMetric    ?? "cpl",
    timeframeHours:  partial?.timeframeHours ?? defaults?.timeframeHours  ?? 48,
    hypothesis:      partial?.hypothesis     ?? buildHypothesis(event, partial?.direction ?? defaults?.direction ?? "improve"),
    targetDeltaPct:  partial?.targetDeltaPct,
  };
}

function buildHypothesis(event: DecisionEvent, direction: string): string {
  const map: Partial<Record<DecisionEvent, string>> = {
    "budget.increase":           "Scaling budget on performing campaign — expect more conversions within 48h",
    "budget.decrease":           "Reducing budget to limit overspend or CPL spike — expect spend to stabilize",
    "campaign.pause":            "Pausing campaign to stop CPL deterioration — expect recovery on resume",
    "campaign.resume":           "Resuming paused campaign — expect impressions and conversions to recover",
    "creative.refresh":          "Replacing fatigued creative — expect CTR and CPL improvement within 48h",
    "creative.pause_fatigued":   "Pausing high-frequency creative — expect audience fatigue to reduce",
    "adset.audience_change":     "Broadening or refining audience targeting — expect CPL change within learning window",
    "automation.rule_applied":   "Automation rule acted on signal — expect metric improvement per rule logic",
    "nba.recommendation_applied":"Applying NBA recommendation — expect improvement on targeted metric",
  };
  return map[event] ?? `Decision expected to ${direction} key metric`;
}

// ── Main recorder ─────────────────────────────────────────

export async function recordDecision(params: RecordDecisionParams): Promise<DecisionMemoryEntry> {
  const now = new Date().toISOString();
  const ctx = params.context ?? {};

  if (isDestructiveEvent(params.event) && !params.rationale) {
    throw new Error(`Destructive event "${params.event}" requires a non-empty rationale`);
  }

  const entry: DecisionMemoryEntry = {
    id:          generateId(),
    createdAt:   now,
    updatedAt:   now,
    source:      params.source,
    event:       params.event,
    action:      params.action,
    target:      params.target,
    context:     ctx,
    rationale:   params.rationale,
    confidence:  params.confidence,
    expectedOutcome: buildExpectedOutcome(params.event, params.expectedOutcome),
    snapshotBefore:  { ...emptySnapshot("at_decision"), ...(params.snapshotBefore ?? {}), capturedAt: now },
    evaluationWindows: windowsForEvent(params.event, ctx, now),
    links:       params.links ?? {},
  };

  await append(entry);
  return entry;
}

// ── Outcome ───────────────────────────────────────────────

export async function closeOutcome(
  id:          string,
  verdict:     FinalVerdict,
  summaryNote: string,
  learningSignal?: DecisionOutcome["learningSignal"],
): Promise<void> {
  const outcome: DecisionOutcome = {
    finalVerdict: verdict,
    verdictAt:    new Date().toISOString(),
    summaryNote,
    learningSignal,
  };
  await updateEntry(id, { outcome });
}

// ── Manual override ───────────────────────────────────────

export async function addManualOverride(
  id:         string,
  by:         string,
  reason:     string,
  overrodeTo: string,
): Promise<void> {
  await updateEntry(id, {
    manualOverride: { by, at: new Date().toISOString(), reason, overrodeTo },
    outcome: {
      finalVerdict: "overridden",
      verdictAt:    new Date().toISOString(),
      summaryNote:  `Manually overridden by ${by}: ${reason}`,
    },
  });
}

// ── Link helpers ──────────────────────────────────────────

export async function linkChangeTracker(decisionId: string, changeTrackerId: string): Promise<void> {
  const entry = (await import("./store")).getById(decisionId);
  if (!entry) return;
  await updateEntry(decisionId, {
    links: { ...entry.links, changeTrackerId },
  });
}

export async function markReviewed(id: string, reviewedBy: string): Promise<void> {
  await updateEntry(id, { reviewedBy, reviewedAt: new Date().toISOString() });
}

// ── Skip all pending windows (e.g. campaign.archive) ─────

export async function skipAllWindows(id: string): Promise<void> {
  const entry = (await import("./store")).getById(id);
  if (!entry) return;
  const windows = entry.evaluationWindows.map(w =>
    w.status === "pending" ? { ...w, status: "skipped" as const, verdictNote: "Entity archived" } : w
  );
  await updateEntry(id, { evaluationWindows: windows });
}
