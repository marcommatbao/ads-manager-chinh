// ============================================================
// Decision Memory — Evaluator
// Checks pending evaluation windows, assigns verdicts,
// and rolls up final outcome when enough evidence exists.
// Called by the decision_memory_eval cron job.
// ============================================================

import { readAll, updateEntry } from "./store";
import { closeOutcome } from "./recorder";
import { computeContextFingerprint } from "./signal";
import { evaluate as compositeEvaluate } from "@/lib/outcome-evaluator/evaluator";
import { recommendedWindow } from "@/lib/outcome-evaluator/windows";
import type {
  DecisionMemoryEntry,
  EvaluationWindow,
  DmMetricSnapshot,
  WindowVerdict,
  FinalVerdict,
  LearningSignal,
} from "./types";
import { signalTtlDays } from "./events";

// ── Window due check ──────────────────────────────────────

export function isDue(window: EvaluationWindow): boolean {
  return window.status === "pending" && new Date(window.dueAt) <= new Date();
}

export function getPendingWindows(): { entry: DecisionMemoryEntry; window: EvaluationWindow }[] {
  const now = new Date();
  const result: { entry: DecisionMemoryEntry; window: EvaluationWindow }[] = [];
  for (const entry of readAll()) {
    if (entry.outcome) continue; // already concluded
    for (const w of entry.evaluationWindows) {
      if (w.status === "pending" && new Date(w.dueAt) <= now) {
        result.push({ entry, window: w });
      }
    }
  }
  return result;
}

// ── Verdict calculation ───────────────────────────────────

/**
 * Deterministic verdict comparing snapshotAfter vs snapshotBefore
 * on the entry's targetMetric. 5% threshold for neutral band.
 */
export function computeVerdict(
  entry:    DecisionMemoryEntry,
  snapshot: DmMetricSnapshot,
): { verdict: WindowVerdict; note: string } {
  // Still in learning phase — verdict is too early
  if (entry.context.learningPhase) {
    return { verdict: "too_early", note: "Entity still in learning phase" };
  }

  const metric    = entry.expectedOutcome.targetMetric;
  const direction = entry.expectedOutcome.direction;
  const before    = snapshotValue(entry.snapshotBefore, metric);
  const after     = snapshotValue(snapshot, metric);

  if (before === null || after === null) {
    return { verdict: "inconclusive", note: `Metric "${metric}" not available in snapshot` };
  }
  if (before === 0) {
    return { verdict: "inconclusive", note: "Baseline metric is zero — cannot compute delta" };
  }

  const deltaPct = ((after - before) / Math.abs(before)) * 100;

  if (Math.abs(deltaPct) < 5) {
    return { verdict: "neutral", note: `${metric} changed ${deltaPct.toFixed(1)}% — within neutral band` };
  }

  // Whether the delta is an improvement depends on the metric and direction
  const isImprovement = metricImproves(metric, direction, deltaPct);

  if (isImprovement) {
    return {
      verdict: "better",
      note: `${metric} ${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}% — hypothesis supported`,
    };
  }
  return {
    verdict: "worse",
    note: `${metric} ${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}% — hypothesis not supported`,
  };
}

function snapshotValue(s: DmMetricSnapshot, metric: string): number | null {
  const map: Record<string, number | undefined> = {
    cpl:          s.cpl,
    roas:         s.roas,
    ctr:          s.ctr,
    spend:        s.spend,
    impressions:  s.impressions,
    leads:        s.leads,
    frequency:    s.frequency,
    fatigue_score: s.fatigueScore,
  };
  const v = map[metric];
  return v !== undefined ? v : null;
}

function metricImproves(metric: string, direction: string, deltaPct: number): boolean {
  // Lower-is-better metrics
  const lowerIsBetter = new Set(["cpl", "cpc", "spend", "frequency", "fatigue_score"]);
  if (direction === "reduce_spend") return deltaPct < 0;
  if (lowerIsBetter.has(metric)) return deltaPct < -5;
  return deltaPct > 5; // higher-is-better (impressions, leads, ctr, roas)
}

// ── Evaluate a single window ──────────────────────────────

export function evaluateWindow(
  window:   EvaluationWindow,
  snapshot: DmMetricSnapshot,
  entry:    DecisionMemoryEntry,
): EvaluationWindow {
  // Use composite evaluator when both snapshots have sufficient data
  if (entry.snapshotBefore.impressions > 0 || entry.snapshotBefore.spend > 0) {
    try {
      const winCfg = recommendedWindow(entry.event);
      const result = compositeEvaluate({
        entityId:   entry.target.entityId,
        entityName: entry.target.entityName,
        company:    entry.target.company,
        event:      entry.event,
        objective:  entry.context.objective,
        before:     entry.snapshotBefore as never,
        after:      snapshot as never,
        window:     winCfg,
        context: {
          learningPhase:    entry.context.learningPhase,
          anomalyDetected:  !!entry.context.anomalyFlags?.length,
          cplThreshold:     entry.target.company === "MBC" ? entry.context.cplThresholdMbc : entry.context.cplThresholdMbi,
          budgetCapHit:     entry.context.budgetPacingStatus === "overpacing",
        },
        decisionId: entry.id,
      });

      const dmVerdict: WindowVerdict =
        result.outcomeLabel === "significantly_better" || result.outcomeLabel === "better"       ? "better"
        : result.outcomeLabel === "significantly_worse" || result.outcomeLabel === "worse"       ? "worse"
        : result.outcomeLabel === "blocked_by_learning" || result.outcomeLabel === "blocked_by_anomaly" ? "too_early"
        : result.outcomeLabel === "inconclusive"                                                 ? "inconclusive"
        : "neutral";

      return {
        ...window,
        status:       "checked",
        autoChecked:  true,
        checkedAt:    new Date().toISOString(),
        snapshotAfter: snapshot,
        verdict:      dmVerdict,
        verdictNote:  `[${result.confidenceLevel}] ${result.primaryReason}`,
      };
    } catch { /* fall through to simple evaluator */ }
  }

  const { verdict, note } = computeVerdict(entry, snapshot);
  return {
    ...window,
    status:       "checked",
    autoChecked:  true,
    checkedAt:    new Date().toISOString(),
    snapshotAfter: snapshot,
    verdict,
    verdictNote:  note,
  };
}

// ── Roll-up final outcome ─────────────────────────────────

/**
 * When all windows are checked (or skipped), compute the final verdict.
 * Majority logic: worse wins if any post-learning-phase window is worse.
 */
export function rollUpOutcome(entry: DecisionMemoryEntry): {
  verdict: FinalVerdict;
  note: string;
  learningSignal: LearningSignal | undefined;
} | null {
  const windows = entry.evaluationWindows;
  if (windows.length === 0) return null;

  const closed = windows.filter(w => w.status === "checked" || w.status === "skipped");
  if (closed.length < windows.length) return null; // not all windows closed yet

  const verdicts = windows
    .filter(w => w.status === "checked" && w.verdict && w.verdict !== "too_early")
    .map(w => w.verdict as WindowVerdict);

  if (verdicts.length === 0) {
    return { verdict: "inconclusive", note: "No evaluable windows", learningSignal: undefined };
  }

  const worseCount   = verdicts.filter(v => v === "worse").length;
  const betterCount  = verdicts.filter(v => v === "better").length;
  const neutralCount = verdicts.filter(v => v === "neutral").length;
  const totalChecked = verdicts.length;

  let finalVerdict: FinalVerdict;
  let note: string;

  if (worseCount > 0) {
    finalVerdict = "worse";
    note = `${worseCount}/${totalChecked} windows showed degradation`;
  } else if (betterCount > totalChecked / 2) {
    finalVerdict = "better";
    note = `${betterCount}/${totalChecked} windows confirmed improvement`;
  } else if (neutralCount >= totalChecked) {
    finalVerdict = "neutral";
    note = "No significant metric change across evaluation windows";
  } else {
    finalVerdict = "inconclusive";
    note = "Mixed signals — inconclusive outcome";
  }

  // Build learning signal
  const shouldRepeat    = finalVerdict === "better";
  const fingerprint     = computeContextFingerprint(entry.context);
  const ttlDays         = signalTtlDays(entry.event);
  const expiresAt       = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const confAdj         = finalVerdict === "better" ? 0.1 : finalVerdict === "worse" ? -0.15 : 0;

  const learningSignal: LearningSignal | undefined = confAdj !== 0 ? {
    shouldRepeat,
    contextFingerprint:   fingerprint,
    confidenceAdjustment: confAdj,
    expiresAt,
  } : undefined;

  return { verdict: finalVerdict, note, learningSignal };
}

// ── Batch check (called by cron) ──────────────────────────

/**
 * For entries with due windows, attempt to fetch metric snapshots and evaluate.
 * Returns how many entries were updated.
 *
 * NOTE: This function checks without live API calls — it marks windows as
 * "inconclusive" since fetching live metrics belongs to the cron orchestrator.
 * Call evaluateEntryWithSnapshot() from cron for live-metric evaluation.
 */
export async function checkAllPendingWindows(): Promise<{ checked: number; updated: number }> {
  const due = getPendingWindows();
  if (due.length === 0) return { checked: 0, updated: 0 };

  let updated = 0;

  // Group by entry to batch updates
  const byEntry = new Map<string, { entry: DecisionMemoryEntry; windows: EvaluationWindow[] }>();
  for (const { entry, window } of due) {
    if (!byEntry.has(entry.id)) byEntry.set(entry.id, { entry, windows: [] });
    byEntry.get(entry.id)!.windows.push(window);
  }

  for (const [, { entry, windows }] of byEntry) {
    // Without a live snapshot, mark as inconclusive (overdue but no data)
    const updatedWindows = entry.evaluationWindows.map(w => {
      if (!windows.some(dw => dw.label === w.label)) return w;
      return {
        ...w,
        status:      "checked" as const,
        autoChecked: true,
        checkedAt:   new Date().toISOString(),
        verdict:     "inconclusive" as WindowVerdict,
        verdictNote: "Auto-checked by cron: no live snapshot available",
      };
    });

    const patch: Partial<DecisionMemoryEntry> = { evaluationWindows: updatedWindows };

    // Attempt roll-up
    const patchedEntry = { ...entry, evaluationWindows: updatedWindows };
    const rollup = rollUpOutcome(patchedEntry);
    if (rollup && !entry.outcome) {
      await closeOutcome(entry.id, rollup.verdict, rollup.note, rollup.learningSignal);
    } else {
      await updateEntry(entry.id, patch);
    }
    updated++;
  }

  return { checked: due.length, updated };
}

/**
 * Evaluate an entry's next pending window with a provided live snapshot.
 * Called from cron when metric data is available.
 */
export async function evaluateEntryWithSnapshot(
  entryId:  string,
  snapshot: DmMetricSnapshot,
): Promise<void> {
  const { getById } = await import("./store");
  const entry = getById(entryId);
  if (!entry || entry.outcome) return;

  const now = new Date();
  const updatedWindows = entry.evaluationWindows.map(w => {
    if (w.status !== "pending" || new Date(w.dueAt) > now) return w;
    return evaluateWindow(w, snapshot, entry);
  });

  const patchedEntry = { ...entry, evaluationWindows: updatedWindows };
  const rollup = rollUpOutcome(patchedEntry);

  if (rollup) {
    await updateEntry(entryId, { evaluationWindows: updatedWindows });
    await closeOutcome(entryId, rollup.verdict, rollup.note, rollup.learningSignal);
  } else {
    await updateEntry(entryId, { evaluationWindows: updatedWindows });
  }
}
