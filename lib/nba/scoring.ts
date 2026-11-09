// ============================================================
// NBA — Weighted scoring model (v2, 6 dimensions)
// priority = Σ weight·dimension. Trọng số cấu hình ở SCORE_WEIGHTS.
// Xem docs §4.
// ============================================================

import type { NbaSignal, NbaScores, NbaSeverity } from "./types";
import { REASON_CODES } from "./reason-codes";

export const SCORE_WEIGHTS = {
  impact: 0.30,
  urgency: 0.25,
  confidence: 0.18,
  safety: 0.10,
  dataCompleteness: 0.09,
  persistence: 0.08,
} as const;

export const AUTO_APPLY_CONFIDENCE_FLOOR = 75;
export const LOW_DATA_FLOOR = 40; // dataCompleteness < ngưỡng → LOW_DATA

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Log-normalize tiền (₫/tháng) → 0-100. ~10K→0, ×10 +30. */
function scoreImpact(vnd: number | undefined): number {
  if (!vnd || vnd <= 0) return 10;
  return clamp((Math.log10(vnd) - 4) * 30);
}

function scoreUrgency(severity: NbaSeverity): number {
  return severity === "critical" ? 90 : severity === "warning" ? 55 : 25;
}

/** Confidence: severity + đồng thuận engine; prior ∈ [-1,1] (ai-memory). */
function scoreConfidence(severity: NbaSeverity, prior = 0): number {
  const base = severity === "critical" ? 70 : severity === "warning" ? 55 : 40;
  return clamp(base + prior * 20);
}

/** Data completeness: thuần theo sample size (clicks/conv). */
export function scoreDataCompleteness(sampleSize: number | undefined): number {
  const n = sampleSize ?? 0;
  if (n >= 200) return 100;
  if (n >= 50) return 80;
  if (n >= 20) return 55;
  if (n >= 5) return 35;
  return 15;
}

function scoreSafety(destructive: boolean): number {
  return destructive ? 45 : 85;
}

/** Persistence: tái xuất hiện càng nhiều → càng đáng xử lý. */
function scorePersistence(occurrenceCount: number): number {
  if (occurrenceCount >= 4) return 95;
  if (occurrenceCount === 3) return 80;
  if (occurrenceCount === 2) return 60;
  return 40; // lần đầu
}

export interface ScoreOpts {
  prior?: number;          // -1..1 từ ai-memory
  occurrenceCount?: number; // số lần đã xuất hiện (>=1)
}

export function scoreSignal(signal: NbaSignal, opts: ScoreOpts = {}): NbaScores {
  const meta = REASON_CODES[signal.reasonCode];
  const impact = scoreImpact(
    signal.impactEstimate?.estMonthlySavingsVnd ?? signal.impactEstimate?.estMonthlyLiftVnd
  );
  const urgency = scoreUrgency(signal.severity);
  const confidence = scoreConfidence(signal.severity, opts.prior ?? 0);
  const safety = scoreSafety(meta.destructive);
  const dataCompleteness = scoreDataCompleteness(signal.sampleSize);
  const persistence = scorePersistence(Math.max(1, opts.occurrenceCount ?? 1));

  const priority = clamp(
    SCORE_WEIGHTS.impact * impact +
    SCORE_WEIGHTS.urgency * urgency +
    SCORE_WEIGHTS.confidence * confidence +
    SCORE_WEIGHTS.safety * safety +
    SCORE_WEIGHTS.dataCompleteness * dataCompleteness +
    SCORE_WEIGHTS.persistence * persistence
  );

  return { impact, urgency, confidence, safety, dataCompleteness, persistence, priority };
}

export function priorityBand(priority: number): "HIGH" | "MEDIUM" | "LOW" {
  if (priority >= 70) return "HIGH";
  if (priority >= 45) return "MEDIUM";
  return "LOW";
}
