// ============================================================
// Decision Memory — Query layer
// All reads go through this layer to enforce MBC/MBI silo.
// Company filter is REQUIRED for all public query functions.
// ============================================================

import { readAll, readByCompany } from "./store";
import type { DecisionMemoryEntry, DecisionEvent, FinalVerdict } from "./types";

// ── Filter interface ──────────────────────────────────────

export interface QueryFilter {
  company:      string;
  entityId?:    string;
  entityType?:  string;
  event?:       DecisionEvent | DecisionEvent[];
  platform?:    string;
  sinceHours?:  number;
  sinceDate?:   string;
  verdict?:     FinalVerdict;
  hasOutcome?:  boolean;
  limit?:       number;
}

// ── Core query ────────────────────────────────────────────

export function queryDecisions(filter: QueryFilter): DecisionMemoryEntry[] {
  let entries = readByCompany(filter.company);

  if (filter.entityId) {
    entries = entries.filter(e => e.target.entityId === filter.entityId);
  }
  if (filter.entityType) {
    entries = entries.filter(e => e.target.entityType === filter.entityType);
  }
  if (filter.event) {
    const events = Array.isArray(filter.event) ? filter.event : [filter.event];
    entries = entries.filter(e => events.includes(e.event));
  }
  if (filter.platform) {
    entries = entries.filter(e => e.target.platform === filter.platform);
  }
  if (filter.sinceHours) {
    const cutoff = Date.now() - filter.sinceHours * 3_600_000;
    entries = entries.filter(e => Date.parse(e.createdAt) >= cutoff);
  }
  if (filter.sinceDate) {
    const cutoff = Date.parse(filter.sinceDate);
    entries = entries.filter(e => Date.parse(e.createdAt) >= cutoff);
  }
  if (filter.verdict) {
    entries = entries.filter(e => e.outcome?.finalVerdict === filter.verdict);
  }
  if (filter.hasOutcome !== undefined) {
    entries = entries.filter(e => filter.hasOutcome ? !!e.outcome : !e.outcome);
  }

  const limit = filter.limit ?? 100;
  return entries.slice(0, limit);
}

// ── Specific views ────────────────────────────────────────

/** Recent decisions for a specific entity. */
export function getRecentByEntity(
  entityId: string,
  company:  string,
  limit = 20,
): DecisionMemoryEntry[] {
  return queryDecisions({ company, entityId, limit });
}

/** Decisions with "worse" final verdict in the last N days. */
export function getWorseOutcomes(
  company:    string,
  sinceHours = 168, // default 7d
  events?:    DecisionEvent[],
): DecisionMemoryEntry[] {
  return queryDecisions({ company, verdict: "worse", sinceHours, event: events, limit: 50 });
}

/** Entries with at least one pending evaluation window due now or overdue. */
export function getPendingEvaluations(company: string): DecisionMemoryEntry[] {
  const now = new Date();
  return readByCompany(company).filter(e =>
    !e.outcome &&
    e.evaluationWindows.some(w => w.status === "pending" && new Date(w.dueAt) <= now)
  );
}

/** Open entries (no outcome yet) across both companies. Called by cron evaluator. */
export function getAllPendingEntries(): DecisionMemoryEntry[] {
  return readAll().filter(e => !e.outcome);
}

/**
 * Find similar past decisions to inform NBA safety gate or recommendation confidence.
 *
 * "Similar" = same event group (e.g. "budget") + same entityType + same company.
 * The caller can further filter by contextFingerprint overlap in signal.ts.
 */
export function getSimilarDecisions(
  event:      DecisionEvent,
  entityType: string,
  company:    string,
  sinceHours = 720, // 30d default
  limit = 20,
): DecisionMemoryEntry[] {
  const group   = event.split(".")[0];
  const cutoff  = Date.now() - sinceHours * 3_600_000;
  return readByCompany(company)
    .filter(e => Date.parse(e.createdAt) >= cutoff && e.target.entityType === entityType && e.event.startsWith(group))
    .slice(0, limit);
}

/**
 * Safe-gate check for auto-apply:
 * Returns true if the action should be BLOCKED based on prior "worse" outcomes.
 *
 * Block conditions:
 *  1. Same entity had a "worse" verdict in last 14d
 *  2. Same event type on same entityType in same company → >50% worse in last 30d (min 3 samples)
 */
export interface AutoApplySafetyCheck {
  blocked:    boolean;
  reason?:    string;
  warnOnly?:  boolean;
  warnNote?:  string;
}

export function checkAutoApplySafety(
  event:      DecisionEvent,
  entityId:   string,
  entityType: string,
  company:    string,
): AutoApplySafetyCheck {
  const now = Date.now();

  // Condition 1: same entity, worse outcome in last 14d
  const entityRecent = queryDecisions({
    company, entityId, verdict: "worse", sinceHours: 14 * 24, limit: 5,
  });
  if (entityRecent.length > 0) {
    return {
      blocked: true,
      reason: `Entity had a "worse" outcome decision in the last 14 days (${entityRecent[0].event})`,
    };
  }

  // Condition 2: pattern-level >50% worse in last 30d (min 3 samples)
  const group = event.split(".")[0];
  const patternSample = readByCompany(company).filter(e =>
    e.target.entityType === entityType &&
    e.event.startsWith(group) &&
    e.outcome &&
    Date.parse(e.createdAt) >= now - 30 * 24 * 3_600_000
  );
  if (patternSample.length >= 3) {
    const worseCount = patternSample.filter(e => e.outcome?.finalVerdict === "worse").length;
    if (worseCount / patternSample.length > 0.5) {
      return {
        blocked: true,
        reason: `Pattern block: ${worseCount}/${patternSample.length} similar ${group} actions on ${entityType} resulted in "worse" outcomes in the last 30d`,
      };
    }
  }

  // Warn-only: same event type had worse outcome on different entity in last 30d
  const patternWorse = readByCompany(company).filter(e =>
    e.target.entityType === entityType &&
    e.event.startsWith(group) &&
    e.outcome?.finalVerdict === "worse" &&
    e.target.entityId !== entityId &&
    Date.parse(e.createdAt) >= now - 30 * 24 * 3_600_000
  );
  if (patternWorse.length > 0) {
    return {
      blocked:  false,
      warnOnly: true,
      warnNote: `Similar ${group} action on other ${entityType} entities resulted in worse outcomes recently`,
    };
  }

  return { blocked: false };
}
