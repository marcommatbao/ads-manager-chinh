// ============================================================
// Narrative Layer — Card + Briefing Builder
//
// Converts NBA recommendations, evaluation results, and decision
// memory signals into NarrativeCards and a NarrativeBriefing.
//
// Integration points:
//   - GET /api/narrative/briefing?company= (morning briefing)
//   - NBA ranked view (enriched with narrative cards)
//   - Decision memory detail view (outcome explanation card)
// ============================================================

import { randomUUID } from "crypto";
import { queryFor } from "@/lib/nba/store";
import { queryDecisions, getWorseOutcomes } from "@/lib/decision-memory/query";
import type { NbaRecommendation } from "@/lib/nba/types";
import type { DecisionMemoryEntry } from "@/lib/decision-memory/types";
import type { EvaluationResult } from "@/lib/outcome-evaluator/types";
import type { SafetyCheckResult } from "@/lib/auto-apply-safety/types";
import type {
  NarrativeCard,
  NarrativeBriefing,
  MetricLine,
  BriefingSummary,
  NarrativeTone,
} from "./types";
import {
  recTitle, recInsight,
  outcomeTitle, outcomeInsight,
  blockTitle, blockInsight,
  signalInsight,
  confidenceCaveat,
  briefingHeadline,
  toneForOutcome,
  toneForConfidence,
} from "./templates";

// ── Helpers ───────────────────────────────────────────────

function fmtVND(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return n >= 1_000_000
    ? `₫${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `₫${Math.round(n / 1_000).toLocaleString("vi-VN")}k`
    : `₫${Math.round(n).toLocaleString("vi-VN")}`;
}

function fmtPct(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Recommendation → NarrativeCard ───────────────────────

export function cardFromRecommendation(
  rec:     NbaRecommendation,
  company: string,
): NarrativeCard {
  const isPositive = ["SCALE_WINNER", "DAYPART_OPPORTUNITY"].includes(rec.reasonCode);
  const tone: NarrativeTone = toneForConfidence(rec.scores.confidence, isPositive);

  const metrics: MetricLine[] = rec.evidence.slice(0, 3).map(e => {
    const delta = e.baseline && e.baseline !== 0
      ? ((e.current - e.baseline) / Math.abs(e.baseline)) * 100
      : undefined;
    return {
      label:  e.metric ?? "metric",
      before: e.baseline !== undefined ? fmtVND(e.baseline) : "—",
      after:  fmtVND(e.current),
      delta:  delta !== undefined ? fmtPct(delta) : "—",
      trend:  delta !== undefined ? (delta > 0 ? "up" : delta < 0 ? "down" : "flat") : "flat",
      good:   isPositive,
    };
  });

  const caveat = confidenceCaveat(
    rec.scores.confidence >= 80 ? "high"
    : rec.scores.confidence >= 65 ? "medium"
    : rec.scores.confidence >= 50 ? "low"
    : "insufficient"
  );

  return {
    id:          randomUUID(),
    type:        "recommendation",
    tone,
    title:       recTitle(rec.reasonCode, rec.entityName),
    insight:     recInsight(rec.reasonCode, rec.scores.confidence, rec.entityName),
    metrics,
    confidenceCaveat: caveat,
    actionHint:  rec.suggestedAction?.type ?? undefined,
    entityId:    rec.entityId,
    entityName:  rec.entityName,
    entityType:  rec.entityType,
    platform:    rec.platform,
    company,
    generatedAt: new Date().toISOString(),
    sourceId:    rec.id,
  };
}

// ── EvaluationResult → NarrativeCard ─────────────────────

export function cardFromEvaluation(
  result:  EvaluationResult,
  company: string,
): NarrativeCard {
  const tone: NarrativeTone = toneForOutcome(result.outcomeLabel);

  const before = result.beforeMetrics;
  const after  = result.afterMetrics;

  const metrics: MetricLine[] = [];
  if (before.cpl !== undefined && after.cpl !== undefined) {
    const delta = before.cpl ? ((after.cpl - before.cpl) / before.cpl) * 100 : 0;
    metrics.push({
      label: "CPL", before: fmtVND(before.cpl), after: fmtVND(after.cpl),
      delta: fmtPct(delta), trend: delta < 0 ? "down" : delta > 0 ? "up" : "flat",
      good: delta < 0,
    });
  }
  if (before.leads !== undefined && after.leads !== undefined) {
    const delta = before.leads ? ((after.leads - before.leads) / before.leads) * 100 : 0;
    metrics.push({
      label: "Leads", before: String(before.leads), after: String(after.leads),
      delta: fmtPct(delta), trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      good: delta > 0,
    });
  }
  if (before.roas !== undefined && after.roas !== undefined) {
    const delta = before.roas ? ((after.roas - before.roas) / before.roas) * 100 : 0;
    metrics.push({
      label: "ROAS", before: before.roas.toFixed(2), after: after.roas.toFixed(2),
      delta: fmtPct(delta), trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      good: delta > 0,
    });
  }

  const caveat = confidenceCaveat(result.confidenceLevel);

  return {
    id:          randomUUID(),
    type:        "outcome",
    tone,
    title:       outcomeTitle(result.outcomeLabel, result.entityName),
    insight:     outcomeInsight(result.outcomeLabel, result.primaryReason, result.entityName, result.recommendedNextStep),
    metrics,
    confidenceCaveat: caveat,
    actionHint:  result.recommendedNextStep,
    entityId:    result.entityId,
    entityName:  result.entityName,
    company,
    generatedAt: new Date().toISOString(),
    sourceId:    result.decisionId,
  };
}

// ── Safety block → NarrativeCard ─────────────────────────

export function cardFromSafetyBlock(
  safety:     SafetyCheckResult,
  entityId:   string,
  entityName: string,
  company:    string,
): NarrativeCard {
  return {
    id:          randomUUID(),
    type:        "safety_block",
    tone:        "blocked",
    title:       blockTitle(entityName),
    insight:     blockInsight(safety.explanation, entityName),
    metrics:     [],
    actionHint:  safety.blockReasons.some(r => r.overridable)
      ? "Liên hệ admin nếu muốn ghi đè kiểm tra an toàn này"
      : "Chờ điều kiện được giải quyết trước khi thử lại",
    entityId,
    entityName,
    company,
    generatedAt: new Date().toISOString(),
  };
}

// ── DecisionMemoryEntry → memory signal card ──────────────

export function cardFromMemoryEntry(
  entry:   DecisionMemoryEntry,
  company: string,
): NarrativeCard | null {
  if (!entry.outcome) return null;

  const verdict = entry.outcome.finalVerdict;
  const tone: NarrativeTone =
    verdict === "better" ? "confident"
    : verdict === "worse" ? "urgent"
    : "neutral";

  return {
    id:          randomUUID(),
    type:        "memory_signal",
    tone,
    title:       `Tín hiệu học: ${entry.target.entityName}`,
    insight:     signalInsight(entry.event, verdict, entry.target.entityName),
    metrics:     [],
    entityId:    entry.target.entityId,
    entityName:  entry.target.entityName,
    entityType:  entry.target.entityType,
    platform:    entry.target.platform,
    company,
    generatedAt: new Date().toISOString(),
    sourceId:    entry.id,
  };
}

// ── Build daily briefing ──────────────────────────────────

export function buildBriefing(company: string): NarrativeBriefing {
  const cards: NarrativeCard[] = [];

  // 1. Top NBA recommendations (max 10)
  const recs: NbaRecommendation[] = queryFor([company]).slice(0, 10);
  for (const rec of recs) {
    cards.push(cardFromRecommendation(rec, company));
  }

  // 2. Recent "worse" outcomes as urgent cards (last 7 days)
  const worseEntries = getWorseOutcomes(company, 168, undefined).slice(0, 5);
  for (const entry of worseEntries) {
    const card = cardFromMemoryEntry(entry, company);
    if (card) cards.push(card);
  }

  // 3. Recent "better" outcomes as positive reinforcement (last 7 days)
  const betterEntries = queryDecisions({ company, verdict: "better", sinceHours: 168, limit: 3 });
  for (const entry of betterEntries) {
    const card = cardFromMemoryEntry(entry, company);
    if (card) cards.push(card);
  }

  // Summary stats
  const urgentCount   = cards.filter(c => c.tone === "urgent" || c.tone === "blocked").length;
  const positiveCount = cards.filter(c => c.tone === "confident").length;
  const blockedCount  = cards.filter(c => c.type === "safety_block").length;

  const topOpportunity = cards.find(c => c.tone === "confident")?.title;
  const topRisk        = cards.find(c => c.tone === "urgent")?.title;

  const summary: BriefingSummary = {
    totalCards:       cards.length,
    urgentCount,
    positiveCount,
    blockedAutoApply: blockedCount,
    topOpportunity,
    topRisk,
  };

  return {
    company,
    date:        today(),
    headline:    briefingHeadline(company, urgentCount, positiveCount, cards.length),
    summary,
    cards,
    generatedAt: new Date().toISOString(),
  };
}
