// ============================================================
// Decision Memory — Learning signal helpers
// Context fingerprinting, signal lookup, confidence adjustment.
// ============================================================

import { readByCompany } from "./store";
import type { DecisionContext, DecisionEvent, LearningSignal } from "./types";

// ── Context fingerprinting ────────────────────────────────

/**
 * Produce a stable, human-inspectable array of context condition strings.
 * Two entries with the same fingerprint set share the same context cluster.
 */
export function computeContextFingerprint(ctx: DecisionContext): string[] {
  const fp: string[] = [];

  if (ctx.learningPhase)           fp.push("learningPhase=true");
  if (ctx.funnelPhase)             fp.push(`funnelPhase=${ctx.funnelPhase}`);
  if (ctx.objective)               fp.push(`objective=${ctx.objective}`);

  if (ctx.budgetPacingStatus)      fp.push(`pacing=${ctx.budgetPacingStatus}`);
  if ((ctx.budgetUtilizationPct ?? 0) > 80) fp.push("budgetUtil=high");

  if (ctx.anomalyFlags?.length) {
    for (const f of ctx.anomalyFlags) fp.push(`anomaly=${f}`);
  }

  if (ctx.dayOfWeek !== undefined && ctx.dayOfWeek !== null) {
    const weekend = ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6;
    fp.push(`dayType=${weekend ? "weekend" : "weekday"}`);
  }

  const h = ctx.hourOfDay;
  if (h !== undefined) {
    if (h >= 8 && h < 12)       fp.push("hour=morning");
    else if (h >= 12 && h < 18) fp.push("hour=afternoon");
    else if (h >= 18 && h < 22) fp.push("hour=evening");
    else                         fp.push("hour=offpeak");
  }

  if ((ctx.daysRunning ?? 0) < 7)  fp.push("ageRange=new");
  else if ((ctx.daysRunning ?? 0) < 30) fp.push("ageRange=recent");
  else                              fp.push("ageRange=mature");

  return fp.sort();
}

/** How many fingerprint conditions overlap between two entries (0–1 ratio). */
function fingerprintOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const common = b.filter(x => setA.has(x)).length;
  return common / Math.max(a.length, b.length);
}

// ── Signal lookup ─────────────────────────────────────────

export interface ActiveSignal {
  event:                DecisionEvent;
  contextFingerprint:   string[];
  confidenceAdjustment: number;
  shouldRepeat:         boolean;
  expiresAt?:           string;
  entryId:              string;
}

/**
 * Retrieve non-expired learning signals for a given event type and context,
 * filtered to a specific company silo. Returns signals with >50% context overlap.
 */
export function getActiveSignalsForPattern(
  event:   DecisionEvent,
  context: DecisionContext,
  company: string,
): ActiveSignal[] {
  const fp  = computeContextFingerprint(context);
  const now = Date.now();
  const group = event.split(".")[0];

  return readByCompany(company)
    .filter(e => {
      if (!e.outcome?.learningSignal) return false;
      const sig = e.outcome.learningSignal;
      if (sig.expiresAt && Date.parse(sig.expiresAt) < now) return false;
      if (!e.event.startsWith(group)) return false;
      return fingerprintOverlap(fp, sig.contextFingerprint) >= 0.5;
    })
    .map(e => ({
      event:                e.event,
      contextFingerprint:   e.outcome!.learningSignal!.contextFingerprint,
      confidenceAdjustment: e.outcome!.learningSignal!.confidenceAdjustment,
      shouldRepeat:         e.outcome!.learningSignal!.shouldRepeat,
      expiresAt:            e.outcome!.learningSignal?.expiresAt,
      entryId:              e.id,
    }));
}

// ── Confidence adjustment ─────────────────────────────────

/**
 * Given a base confidence score (0–1) and a list of active signals,
 * compute an adjusted confidence. Net adjustment is bounded:
 *   - Never drops below 0.10 (suppress, not silence)
 *   - Capped at +0.30 increase above base
 */
export function adjustNbaConfidence(
  baseConfidence: number,
  signals:        ActiveSignal[],
): number {
  if (signals.length === 0) return baseConfidence;

  const netAdj = signals.reduce((sum, s) => sum + s.confidenceAdjustment, 0);
  const clamped = Math.max(-baseConfidence + 0.10, Math.min(0.30, netAdj));
  return Math.round(Math.min(1, Math.max(0.10, baseConfidence + clamped)) * 100) / 100;
}

// ── Extract learning signal from closed entry ─────────────

export function extractLearningSignal(
  verdict:      string,
  context:      DecisionContext,
  event:        DecisionEvent,
  ttlDays:      number,
): LearningSignal | undefined {
  if (verdict === "neutral" || verdict === "inconclusive" || verdict === "overridden") {
    return undefined;
  }
  const shouldRepeat    = verdict === "better";
  const confAdj         = verdict === "better" ? 0.1 : -0.15;
  const expiresAt       = new Date(Date.now() + ttlDays * 86_400_000).toISOString();

  return {
    shouldRepeat,
    contextFingerprint:   computeContextFingerprint(context),
    confidenceAdjustment: confAdj,
    expiresAt,
  };
}
