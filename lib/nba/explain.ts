// ============================================================
// NBA — explanation & normalization helpers
// Sinh recommendedAction / expectedOutcome / summary /
// supportingMetrics và map executionMode. Tách khỏi engine cho dễ test.
// ============================================================

import { REASON_CODES } from "./reason-codes";
import type {
  NbaSignal,
  NbaActionMode,
  NbaExecutionMode,
  NbaEvidence,
} from "./types";

/** Tóm tắt ngắn (1 dòng) cho UI/list. */
export function buildSummary(signal: NbaSignal): string {
  const base = signal.explanation.trim();
  if (base.length <= 120) return base;
  return `${base.slice(0, 117)}…`;
}

/** Hành động khuyến nghị, có chèn tham số nếu rõ ràng. */
export function buildRecommendedAction(signal: NbaSignal): string {
  const meta = REASON_CODES[signal.reasonCode];
  const pct = (signal.suggestedAction?.params as { pct?: number } | undefined)?.pct;
  if (pct && signal.suggestedAction?.type === "INCREASE_BUDGET") {
    return `Tăng ngân sách +${pct}%. ${meta.outcomeText}`;
  }
  if (pct && signal.suggestedAction?.type === "DECREASE_BUDGET") {
    return `Giảm ngân sách −${pct}% sau khi rà soát. ${meta.actionText}`;
  }
  return meta.actionText;
}

export function buildExpectedOutcome(signal: NbaSignal): string {
  return REASON_CODES[signal.reasonCode].outcomeText;
}

/** Map evidence[] → bảng supportingMetrics phẳng. */
export function buildSupportingMetrics(evidence: NbaEvidence[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const e of evidence) {
    out[e.metric] = e.unit ? `${e.current}${e.unit === "%" || e.unit === "x" ? e.unit : " " + e.unit}` : e.current;
  }
  return out;
}

/** actionMode (slice-1) → executionMode (spec v2). */
export function toExecutionMode(actionMode: NbaActionMode): NbaExecutionMode {
  switch (actionMode) {
    case "advisory_only":       return "advisory_only";
    case "manual":              return "manual_action";
    case "auto_apply_eligible": return "auto_apply_candidate";
  }
}
