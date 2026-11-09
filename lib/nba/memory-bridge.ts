// ============================================================
// NBA — Decision Memory Bridge
//
// Connects the NBA engine to decision memory learning signals.
// Adjusts recommendation confidence based on prior outcomes for
// the same action type in the same context and company silo.
//
// Also provides the `supportingMemories` field for UI display.
// ============================================================

import type { NbaRecommendation, NbaCompany } from "./types";
import { getActiveSignalsForPattern, adjustNbaConfidence } from "@/lib/decision-memory/signal";
import { getWorseOutcomes, getSimilarDecisions } from "@/lib/decision-memory/query";
import type { DecisionEvent } from "@/lib/decision-memory/types";

// ── Supporting memory summary ─────────────────────────────

export interface SupportingMemory {
  decisionId:    string;
  event:         string;
  entityName:    string;
  verdict:       string;
  summaryNote:   string;
  decidedAt:     string;
  confidence?:   number;
}

// ── Map NBA reasonCode → decision event ───────────────────

const REASON_TO_EVENT: Record<string, DecisionEvent> = {
  CPL_CRITICAL:             "budget.decrease",
  CPL_WARNING:              "budget.decrease",
  ZERO_CONV_SPEND:          "campaign.pause",
  CREATIVE_FATIGUE:         "creative.pause_fatigued",
  SCALE_WINNER:             "budget.increase",
  LOW_ROAS_REVIEW:          "budget.decrease",
  PAUSE_FB_AD_LOW_CTR:      "adset.pause",
  DAYPART_OPPORTUNITY:      "adset.schedule_change",
  FIX_LOW_QS_KEYWORD:       "adset.bid_strategy_change",
  NEGATIVE_KEYWORD_WASTE:   "budget.decrease",
  IMPROVEMENT_OTHER:        "automation.rule_applied",
};

function eventForReason(reasonCode: string): DecisionEvent {
  return REASON_TO_EVENT[reasonCode] ?? "automation.rule_applied";
}

// ── Fetch supporting memories ─────────────────────────────

export function getSupportingMemories(
  rec:     NbaRecommendation,
  company: NbaCompany,
  limit  = 3,
): SupportingMemory[] {
  const event = eventForReason(rec.reasonCode);
  const similar = getSimilarDecisions(event, rec.entityType, company, 720, limit * 3);

  return similar
    .filter(e => e.outcome)
    .slice(0, limit)
    .map(e => ({
      decisionId: e.id,
      event:      e.event,
      entityName: e.target.entityName,
      verdict:    e.outcome!.finalVerdict,
      summaryNote: e.outcome!.summaryNote,
      decidedAt:  e.createdAt,
      confidence: e.confidence,
    }));
}

// ── Confidence adjustment from memory ────────────────────

export interface MemoryAdjustment {
  adjustedConfidence: number;
  originalConfidence: number;
  adjustment:         number;
  supportingMemories: SupportingMemory[];
  warnBlockedPattern: boolean;
  blockNote?:         string;
}

export function applyMemoryAdjustment(
  rec:     NbaRecommendation,
  company: NbaCompany,
): MemoryAdjustment {
  const event    = eventForReason(rec.reasonCode);
  const baseConf = rec.scores.confidence / 100; // 0–1

  // Build context from rec for signal lookup
  const context = {
    funnelPhase:    undefined,
    anomalyFlags:   rec.evidence.map(e => e.metric).filter(Boolean),
    budgetPacingStatus: undefined,
  };

  const signals = getActiveSignalsForPattern(event, context as never, company);
  const adjusted = adjustNbaConfidence(baseConf, signals);
  const adjustment = adjusted - baseConf;

  const memories = getSupportingMemories(rec, company);

  // Pattern block check: >50% worse outcomes in recent similar decisions
  const recentWorse = getWorseOutcomes(company, 720, [event]);
  const sameEntityType = recentWorse.filter(e => e.target.entityType === rec.entityType);
  const sameEntity = sameEntityType.filter(e => e.target.entityId === rec.entityId);

  let warnBlockedPattern = false;
  let blockNote: string | undefined;

  if (sameEntity.length > 0) {
    warnBlockedPattern = true;
    blockNote = `This entity had a "worse" outcome for a similar action in the last 30 days`;
  } else if (sameEntityType.length >= 3) {
    const total = getSimilarDecisions(event, rec.entityType, company, 720).filter(e => e.outcome).length;
    if (total > 0 && sameEntityType.length / total > 0.5) {
      warnBlockedPattern = true;
      blockNote = `${sameEntityType.length}/${total} similar ${rec.entityType} actions resulted in worse outcomes recently`;
    }
  }

  return {
    adjustedConfidence: Math.round(adjusted * 100),
    originalConfidence: Math.round(baseConf * 100),
    adjustment:         Math.round(adjustment * 100),
    supportingMemories: memories,
    warnBlockedPattern,
    blockNote,
  };
}

// ── Batch enrich recommendations ─────────────────────────

export interface EnrichedRecommendation extends NbaRecommendation {
  supportingMemories:  SupportingMemory[];
  memoryConfidence?:   number;   // memory-adjusted confidence score (0–100)
  memoryAdjustment?:  number;   // how much memory changed confidence
  memoryBlockNote?:   string;   // warning if similar actions failed recently
}

export function enrichWithMemory(
  recs:    NbaRecommendation[],
  company: NbaCompany,
): EnrichedRecommendation[] {
  return recs.map(rec => {
    try {
      const adj = applyMemoryAdjustment(rec, company);
      return {
        ...rec,
        supportingMemories: adj.supportingMemories,
        memoryConfidence:   adj.adjustedConfidence,
        memoryAdjustment:   adj.adjustment,
        memoryBlockNote:    adj.blockNote,
        // Apply adjusted confidence back to scores for ranking
        scores: {
          ...rec.scores,
          confidence: adj.adjustedConfidence,
          priority:   Math.round(
            rec.scores.priority * (adj.adjustedConfidence / Math.max(1, rec.scores.confidence))
          ),
        },
        confidenceScore: adj.adjustedConfidence,
        priorityScore:   Math.round(
          rec.scores.priority * (adj.adjustedConfidence / Math.max(1, rec.scores.confidence))
        ),
      };
    } catch {
      // Memory enrichment is non-blocking
      return { ...rec, supportingMemories: [] };
    }
  });
}
