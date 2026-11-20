import crypto from "node:crypto";
import { isApprovalUsable, type ApprovalRecord } from "@/lib/automation/approval";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

export interface BudgetProviderAdapter {
  provider: "meta" | "google";
  accountId?: string;
  readBudget(campaignId: string): Promise<number>;
  setBudget(campaignId: string, budget: number, idempotencyKey: string): Promise<{ accepted: boolean; requestHash: string }>;
}

export interface ApplyResult {
  status: "applied" | "blocked" | "readback_mismatch" | "failed";
  provider: BudgetProviderAdapter["provider"];
  campaignId: string;
  before: number | null;
  requested: number | null;
  after: number | null;
  requestHash?: string;
  reason?: string;
}

export async function applyApprovedBudget(
  decision: BudgetDecision,
  approval: ApprovalRecord,
  adapter: BudgetProviderAdapter,
  now = new Date(),
): Promise<ApplyResult> {
  if (approval.status !== "approved" || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now.getTime()) {
    return { status: "blocked", provider: adapter.provider, campaignId: decision.campaignId, before: null, requested: decision.proposedBudget, after: null, reason: "approval_expired" };
  }
  if (approval.decisionIdempotencyKey !== decision.idempotencyKey) {
    return { status: "blocked", provider: adapter.provider, campaignId: decision.campaignId, before: null, requested: decision.proposedBudget, after: null, reason: "approval_mismatch" };
  }
  if (!isApprovalUsable(approval, decision, now)) {
    return { status: "blocked", provider: adapter.provider, campaignId: decision.campaignId, before: null, requested: decision.proposedBudget, after: null, reason: "approval_mismatch" };
  }
  if (decision.proposedBudget === null || !Number.isFinite(decision.proposedBudget) || decision.proposedBudget <= 0 || !Number.isFinite(decision.currentBudget) || decision.currentBudget <= 0 || !decision.requiresApproval || !["increase_budget", "decrease_budget"].includes(decision.action)) {
    return { status: "blocked", provider: adapter.provider, campaignId: decision.campaignId, before: null, requested: decision.proposedBudget, after: null, reason: "decision_not_mutation" };
  }
  const before = await adapter.readBudget(decision.campaignId);
  if (before !== decision.currentBudget) {
    return { status: "blocked", provider: adapter.provider, campaignId: decision.campaignId, before, requested: decision.proposedBudget, after: before, reason: "current_budget_changed" };
  }
  const idempotencyKey = `${decision.idempotencyKey}:${approval.approvalId}`;
  const applied = await adapter.setBudget(decision.campaignId, decision.proposedBudget, idempotencyKey);
  if (!applied.accepted) return { status: "failed", provider: adapter.provider, campaignId: decision.campaignId, before, requested: decision.proposedBudget, after: null, requestHash: applied.requestHash, reason: "provider_rejected" };
  const after = await adapter.readBudget(decision.campaignId);
  return {
    status: after === decision.proposedBudget ? "applied" : "readback_mismatch",
    provider: adapter.provider, campaignId: decision.campaignId, before, requested: decision.proposedBudget, after,
    requestHash: applied.requestHash,
    reason: after === decision.proposedBudget ? undefined : "provider_readback_mismatch",
  };
}

export const hashRequest = (payload: unknown): string => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
