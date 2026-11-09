// ============================================================
// Automation Simulation + Safe Auto-Apply Layer — Types
// Mô phỏng rule trước khi chạy: match → action → risk → blockers
// → phân loại 4 nhóm. CORE thuần (không gọi API ngoài).
// Xem docs/AUTOMATION_SIM_DESIGN.md
// ============================================================

import type { ActionType, AutomationRule } from "@/lib/automation-shared";

export type SimCompany = string;

export type SimulationStatus =
  | "simulate_only"
  | "manual_review_required"
  | "safe_for_auto_apply"
  | "blocked";

export type SimReasonCode =
  | "LEARNING_PHASE"
  | "COOLDOWN_ACTIVE"
  | "RECENT_CHANGE"
  | "LOW_DATA"
  | "MISSING_METRICS"
  | "ROLE_RESTRICTION"
  | "NOT_REVERSIBLE"
  | "CAP_EXCEEDED"
  | "BUDGET_GUARD"
  | "LOW_CONFIDENCE"
  | "LARGE_MAGNITUDE"
  | "CONFLICTING_RECOMMENDATION"
  | "POLICY_OFF"
  | "POLICY_DRY_RUN";

export type SimRiskBand = "low" | "medium" | "high";

export interface SimConditionTrace {
  metric: string;
  operator: string;
  threshold: number;
  actual: number;
  passed: boolean;
}

export interface SimRisk {
  impact: number;
  urgency: number;
  confidence: number;
  dataCompleteness: number;
  reversibility: number;
  destructiveness: number;
  riskScore: number;   // 0-100 rủi ro khi auto-apply
  safetyScore: number; // 0-100 (ngược risk, có tính reversibility)
  band: SimRiskBand;
}

export interface SimProposedAction {
  type: ActionType;
  label: string;
  params?: Record<string, number | string>;
  mutating: boolean;
  destructive: boolean;
  reversible: boolean;
}

/** Thay đổi giá trị cụ thể (budget…) — nếu có. */
export interface ProposedValueChange {
  field: string;     // "daily_budget"
  fromValue: number;
  toValue: number;
  deltaPct: number;
}

/** Thay đổi gần đây liên quan (từ change-tracker). */
export interface RecentRelatedChange {
  id: string;
  actionLabel: string;
  appliedAt: string;
  status: string;
  verdict?: string;
}

export interface SimulationItem {
  // định danh
  ruleId: string;
  ruleName: string;
  company: SimCompany | null;
  platform: "facebook" | "google";
  entityType: "campaign";
  entityId: string;
  entityName: string;

  // match + action
  matchedConditions: SimConditionTrace[];
  proposedAction: SimProposedAction;
  proposedValueChange: ProposedValueChange | null;

  // phân loại + điểm
  simulationStatus: SimulationStatus;
  riskScore: number;
  confidenceScore: number;
  safetyScore: number;
  risk: SimRisk;

  // giải thích
  impactSummary: string;
  estMonthlySavingsVnd: number;
  blockedBy: SimReasonCode[];
  warnings: string[];
  reasonCodes: SimReasonCode[];
  explanation: string;
  supportingMetrics: Record<string, number>;
  recentRelatedChanges: RecentRelatedChange[];

  executor: "automation-engine" | "actionExecutor" | "manual-link";
  downgraded: boolean;
  generatedAt: string;
}

export interface SimulationResult {
  ruleId: string;
  ruleName: string;
  scope: { company: AutomationRule["company"]; platform: AutomationRule["platform"] };
  simulatedAt: string;
  generatedAt: string;
  dateWindow: { from: string; to: string };
  policy: "off" | "dry_run" | "on";
  counts: {
    evaluated: number;
    matched: number;
    byStatus: Record<SimulationStatus, number>;
  };
  estTotalImpactVnd: number;
  items: SimulationItem[];
}

/** Typed inputs — core nhận sẵn, KHÔNG tự gọi API. */
export interface SimContext {
  companies: SimCompany[];
  canApply: boolean;
  policy: "off" | "dry_run" | "on";
  /** entityId → các thay đổi gần đây (change-tracker). */
  recentChanges?: Record<string, RecentRelatedChange[]>;
  now?: number;
}
