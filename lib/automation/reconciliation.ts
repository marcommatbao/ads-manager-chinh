export interface ReconciliationInput {
  beforeBudget: number;
  proposedBudget: number;
  observedBudget: number | null;
  /** Caller must establish identical provider/account/campaign/currency/unit. */
  scopeVerified: boolean;
  readAt: string;
}
export interface ReconciliationAssessment {
  state: "matches_proposed" | "matches_before" | "different_value" | "unverified";
  observedBudget: number | null;
  readAt: string;
  executionProven: false;
  retryAllowed: false;
  undoAllowed: false;
}

/** An observed value is not proof who wrote it. Never release claims or quota. */
export function assessBudgetReconciliation(input: ReconciliationInput): ReconciliationAssessment {
  const valid = input.scopeVerified && Number.isFinite(Date.parse(input.readAt))
    && Number.isFinite(input.beforeBudget) && input.beforeBudget > 0
    && Number.isFinite(input.proposedBudget) && input.proposedBudget > 0
    && input.proposedBudget !== input.beforeBudget
    && input.observedBudget !== null && Number.isFinite(input.observedBudget) && input.observedBudget >= 0;
  const state = !valid ? "unverified"
    : input.observedBudget === input.proposedBudget ? "matches_proposed"
    : input.observedBudget === input.beforeBudget ? "matches_before" : "different_value";
  return {
    state, observedBudget: valid ? input.observedBudget : null,
    readAt: input.readAt, executionProven: false, retryAllowed: false, undoAllowed: false,
  };
}
