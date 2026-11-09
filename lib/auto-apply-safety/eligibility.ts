// ============================================================
// Auto-Apply Safety — Eligibility Gate
//
// Combines ALL safety signals into a single SafetyCheckResult:
//   1. Env mode (off / dry_run / on)
//   2. Supported platform + action
//   3. Confidence threshold (per action severity)
//   4. Learning phase
//   5. Anomaly flag
//   6. Recent change cooldown
//   7. Decision memory safety (entity + pattern)
//   8. Budget cap
//   9. Rate limiting
//
// Callers: lib/nba/auto-apply.ts, lib/automation-sim/apply.ts
// ============================================================

import { checkAutoApplySafety } from "@/lib/decision-memory/query";
import { buildExplanation, buildEvaluationPlan } from "./explainer";
import type {
  SafetyCheckInput,
  SafetyCheckResult,
  BlockReason,
  BlockReasonCode,
  ActionSeverity,
  EvidenceItem,
  ExecutionDecision,
} from "./types";

// ── Action severity mapping ───────────────────────────────

const EVENT_SEVERITY: Record<string, ActionSeverity> = {
  "campaign.pause":             "critical",
  "adset.pause":                "high",
  "budget.decrease":            "high",
  "budget.increase":            "medium",
  "creative.pause_fatigued":    "medium",
  "adset.schedule_change":      "low",
  "adset.bid_strategy_change":  "low",
  "automation.rule_applied":    "medium",
  "nba.recommendation_applied": "medium",
  "nba.recommendation_dismissed": "low",
};

function actionSeverity(event: string): ActionSeverity {
  return EVENT_SEVERITY[event] ?? "medium";
}

// ── Confidence thresholds per severity ────────────────────

const CONFIDENCE_THRESHOLD: Record<ActionSeverity, number> = {
  critical: 88,
  high:     80,
  medium:   70,
  low:      60,
};

// ── Rate limiting ─────────────────────────────────────────

// In-process map: entityId → timestamps of recent auto-applies
const _recentApplies = new Map<string, number[]>();
const RATE_WINDOW_MS  = 60 * 60_000;   // 1 hour
const RATE_LIMIT      = 3;             // max 3 auto-applies per entity per hour

function isRateLimited(entityId: string): boolean {
  const now = Date.now();
  const times = (_recentApplies.get(entityId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  _recentApplies.set(entityId, times);
  return times.length >= RATE_LIMIT;
}

function recordApply(entityId: string): void {
  const now = Date.now();
  const times = (_recentApplies.get(entityId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  times.push(now);
  _recentApplies.set(entityId, times);
}

// ── Supported actions ─────────────────────────────────────

// Currently only FB budget operations can be auto-executed.
// Other events can be staged (dry_run / suggest_only).
const FULLY_SUPPORTED = new Set(["budget.increase", "budget.decrease"]);

// ── Confidence label ──────────────────────────────────────

function confLabel(score: number): SafetyCheckResult["confidenceLevel"] {
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  if (score >= 50) return "low";
  return "insufficient";
}

// ── Main function ─────────────────────────────────────────

/**
 * Run all safety checks for a proposed auto-apply action.
 * Returns a structured SafetyCheckResult — callers must honour
 * `executionDecision` before touching any ad account.
 *
 * Side-effect: if decision is "proceed", records the apply in the
 * in-process rate-limit tracker (call `recordApply()` explicitly if
 * you want to defer recording until after successful execution).
 */
export function checkSafety(input: SafetyCheckInput): SafetyCheckResult {
  const blocks:   BlockReason[]  = [];
  const evidence: EvidenceItem[] = [];
  const severity  = actionSeverity(input.event);
  const threshold = CONFIDENCE_THRESHOLD[severity];

  // ── 1. Env mode ──────────────────────────────────────────
  const envMode = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  if (envMode === "off") {
    blocks.push({
      code: "env_mode_off", severity: "low",
      message: "NBA_AUTO_APPLY=off — auto-apply disabled globally",
      overridable: false,
    });
    evidence.push({ source: "env_config", metric: "NBA_AUTO_APPLY", value: "off",
      interpretation: "Auto-apply is administratively disabled" });
  } else if (envMode !== "on") {
    // dry_run (default)
    blocks.push({
      code: "env_mode_dry_run", severity: "low",
      message: "NBA_AUTO_APPLY=dry_run — simulation mode only",
      overridable: false,
    });
    evidence.push({ source: "env_config", metric: "NBA_AUTO_APPLY", value: "dry_run",
      interpretation: "System is in simulation mode; all actions are logged only" });
  }

  // ── 2. Supported action ──────────────────────────────────
  if (envMode === "on" && !FULLY_SUPPORTED.has(input.event)) {
    blocks.push({
      code: "unsupported_action", severity: "medium",
      message: `Event "${input.event}" is not yet supported by the live executor`,
      overridable: false,
    });
  }

  // ── 3. Confidence threshold ──────────────────────────────
  if (input.confidenceScore < threshold) {
    blocks.push({
      code: "low_confidence", severity: severity === "critical" ? "high" : "medium",
      message: `Confidence ${input.confidenceScore} < threshold ${threshold} for "${severity}" action`,
      overridable: severity === "low",
    });
    evidence.push({ source: "campaign_health", metric: "confidence_score",
      value: input.confidenceScore,
      interpretation: `Needs ≥${threshold} for "${severity}"-severity action` });
  }

  // ── 4. Learning phase ────────────────────────────────────
  if (input.context?.learningPhase) {
    blocks.push({
      code: "learning_phase", severity: "high",
      message: "Campaign is in FB learning phase — metric signals are unreliable",
      overridable: false,
    });
    evidence.push({ source: "campaign_health", metric: "learning_phase", value: "active",
      interpretation: "FB learning phase: optimization events not yet sufficient" });
  }

  // ── 5. Anomaly ───────────────────────────────────────────
  if (input.context?.anomalyActive) {
    blocks.push({
      code: "anomaly_active", severity: "high",
      message: "Active anomaly detected on this entity — changes may be confounded",
      overridable: true,
    });
    evidence.push({ source: "anomaly_detection", metric: "anomaly_flag", value: "active",
      interpretation: "Anomaly detected; outcome attribution would be unreliable" });
  }

  // ── 6. Cooldown (recent change) ───────────────────────────
  if (input.context?.recentlyChanged) {
    blocks.push({
      code: "cooldown_recent_change", severity: "medium",
      message: "Entity was modified in the last 24 h — cooldown period active",
      overridable: true,
    });
    evidence.push({ source: "campaign_health", metric: "recent_change", value: "true",
      interpretation: "Recent change: evaluation window needs to reset before new action" });
  }

  // ── 7. Budget cap ────────────────────────────────────────
  if (input.context?.budgetCapHit && input.event.includes("increase")) {
    blocks.push({
      code: "budget_cap_hit", severity: "medium",
      message: "Daily budget cap already reached — increase would have no effect",
      overridable: false,
    });
    evidence.push({ source: "campaign_health", metric: "budget_cap", value: "hit",
      interpretation: "Spend cap reached; no room to increase further today" });
  }

  // ── 8. Decision memory safety ─────────────────────────────
  try {
    const memorySafety = checkAutoApplySafety(input.event, input.entityId, input.entityType, input.company);
    if (memorySafety.blocked) {
      const code: BlockReasonCode = memorySafety.reason?.includes("pattern")
        ? "memory_worse_pattern"
        : "memory_worse_entity";
      blocks.push({
        code, severity: "high",
        message: memorySafety.reason ?? "Decision memory safety block",
        overridable: true,
      });
      evidence.push({ source: "decision_memory", metric: "outcome_history",
        value: code === "memory_worse_pattern" ? "pattern_worse" : "entity_worse",
        interpretation: memorySafety.reason ?? "" });
    } else if (memorySafety.warnOnly && memorySafety.warnNote) {
      evidence.push({ source: "decision_memory", metric: "outcome_history",
        value: "warn",
        interpretation: memorySafety.warnNote });
    }
  } catch {
    // Memory check failure is non-blocking — log as evidence gap
    evidence.push({ source: "decision_memory", metric: "outcome_history",
      value: "unavailable",
      interpretation: "Decision memory service unavailable — proceeding without historical context" });
  }

  // ── 9. Rate limiting ─────────────────────────────────────
  if (envMode === "on" && isRateLimited(input.entityId)) {
    blocks.push({
      code: "rate_limited", severity: "medium",
      message: `Entity "${input.entityId}" exceeded ${RATE_LIMIT} auto-applies in the last hour`,
      overridable: false,
    });
    evidence.push({ source: "rate_limit", metric: "applies_per_hour",
      value: RATE_LIMIT,
      interpretation: "Rate limit prevents over-automation on the same entity" });
  }

  // ── Derive decision ───────────────────────────────────────
  const hardBlocks = blocks.filter(b =>
    b.code !== "env_mode_dry_run" &&
    (b.severity === "critical" || b.severity === "high")
  );

  let executionDecision: ExecutionDecision;
  if (blocks.some(b => b.code === "env_mode_off")) {
    executionDecision = "blocked";
  } else if (blocks.some(b => b.code === "env_mode_dry_run")) {
    executionDecision = "dry_run";
  } else if (hardBlocks.length > 0) {
    executionDecision = "blocked";
  } else if (blocks.some(b => b.code === "unsupported_action")) {
    executionDecision = "suggest_only";
  } else if (blocks.length > 0) {
    executionDecision = "suggest_only";
  } else {
    executionDecision = "proceed";
  }

  const eligible = executionDecision === "proceed" || executionDecision === "dry_run";

  // Record rate-limit token only on real proceed
  if (executionDecision === "proceed") {
    recordApply(input.entityId);
  }

  const explanation = buildExplanation(executionDecision, blocks, input);
  const plan        = buildEvaluationPlan(input, executionDecision === "blocked");

  return {
    eligible,
    executionDecision,
    blockReasons:             blocks,
    confidenceLevel:          confLabel(input.confidenceScore),
    severity,
    supportingEvidence:       evidence,
    explanation,
    postActionEvaluationPlan: plan,
    checkedAt:                new Date().toISOString(),
  };
}

export { recordApply };
export type { SafetyCheckInput, SafetyCheckResult };
