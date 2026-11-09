// ============================================================
// Closed-Loop Auto-Apply Safety Layer — Types
//
// SafetyCheckResult is the single contract every executor must
// receive before touching a real ad account.  All fields are
// deterministic and serialisable so they can be stored in
// decision memory for audit.
// ============================================================

import type { DecisionEvent } from "@/lib/decision-memory/types";

// ── Severity / Decision ───────────────────────────────────

export type ActionSeverity = "critical" | "high" | "medium" | "low";

/** What the safety gate allows the caller to do */
export type ExecutionDecision =
  | "proceed"       // all checks passed, execute live
  | "dry_run"       // simulate only — env gate or low confidence
  | "suggest_only"  // present to human, don't execute
  | "blocked";      // hard block, not actionable without override

// ── Block reasons ─────────────────────────────────────────

export type BlockReasonCode =
  | "env_mode_off"           // NBA_AUTO_APPLY=off
  | "env_mode_dry_run"       // NBA_AUTO_APPLY=dry_run
  | "learning_phase"         // campaign still in FB learning
  | "anomaly_active"         // anomaly flag on entity
  | "cooldown_recent_change" // entity changed recently (<24 h)
  | "low_confidence"         // confidence below threshold for this action
  | "memory_worse_entity"    // same entity had "worse" outcome in 14 d
  | "memory_worse_pattern"   // >50% pattern worse in 30 d
  | "insufficient_data"      // not enough spend/impressions to act
  | "rate_limited"           // too many auto-applies on this entity recently
  | "unsupported_action"     // executor does not support this action type
  | "budget_cap_hit";        // budget is already capped

export interface BlockReason {
  code:        BlockReasonCode;
  message:     string;
  severity:    ActionSeverity;
  /** can super_admin explicitly override this block? */
  overridable: boolean;
}

// ── Evidence ─────────────────────────────────────────────

export interface EvidenceItem {
  source:          "decision_memory" | "campaign_health" | "anomaly_detection" | "env_config" | "rate_limit";
  metric?:         string;
  value?:          number | string;
  interpretation:  string;
}

// ── Post-action evaluation plan ───────────────────────────

export interface PostEvalWindow {
  label:          string;  // "24h" | "72h" | "7d" | "14d"
  dueAt:          string;  // ISO
  primaryMetric:  string;
  target:         "improve" | "maintain" | "neutral";
}

export interface RollbackThreshold {
  metric:     string;
  threshold:  number;
  /** fire if metric goes above/below threshold */
  direction:  "above" | "below";
  actionType: "alert" | "pause" | "revert";
}

export interface PostActionEvaluationPlan {
  evaluationWindows:  PostEvalWindow[];
  primaryWindow:      string;
  rollbackThresholds: RollbackThreshold[];
  reviewRequired:     boolean;
  reviewNote?:        string;
}

// ── Safety check input / output ───────────────────────────

export interface SafetyCheckInput {
  event:            DecisionEvent;
  entityId:         string;
  entityName:       string;
  entityType:       "campaign" | "adset" | "creative" | "account";
  company:          string;
  platform:         "facebook" | "google" | "tiktok";
  confidenceScore:  number;   // 0–100
  reasonCode:       string;   // NBA reason code
  estimatedImpact?: {
    metric:    string;
    pctChange: number;
    direction: "increase" | "decrease";
  };
  context?: {
    learningPhase?:   boolean;
    anomalyActive?:   boolean;
    recentlyChanged?: boolean;
    currentBudget?:   number;
    budgetCapHit?:    boolean;
  };
}

export interface SafetyCheckResult {
  eligible:                 boolean;
  executionDecision:        ExecutionDecision;
  blockReasons:             BlockReason[];
  confidenceLevel:          "high" | "medium" | "low" | "insufficient";
  severity:                 ActionSeverity;
  supportingEvidence:       EvidenceItem[];
  /** Human-readable summary in Vietnamese business tone */
  explanation:              string;
  postActionEvaluationPlan: PostActionEvaluationPlan;
  checkedAt:                string;
}
