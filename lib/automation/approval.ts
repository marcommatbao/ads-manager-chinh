import crypto from "node:crypto";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";
import type { DecisionAuditRecord } from "./decision-audit";

export interface ApprovalRecord {
  approvalId: string;
  decisionIdempotencyKey: string;
  snapshotHash: string;
  approverId: string;
  status: "approved" | "expired" | "consumed" | "revoked";
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
  expiresAt: string;
}

export function snapshotHash(decision: BudgetDecision): string {
  const provenance = decision as DecisionAuditRecord;
  const canonical = JSON.stringify({
    decisionId: provenance.decisionId,
    snapshotRegistryId: provenance.snapshotRegistryId,
    snapshotPayloadHash: provenance.snapshotPayloadHash,
    expiresAt: provenance.expiresAt,
    currency: provenance.currency,
    budgetKind: provenance.budgetKind,
    binding: provenance.binding ? {
      provider: provenance.binding.provider, accountId: provenance.binding.accountId,
      company: provenance.binding.company, campaignId: provenance.binding.campaignId,
      policyRevision: provenance.binding.policyRevision,
    } : undefined,
    company: decision.company,
    campaignId: decision.campaignId,
    currentBudget: decision.currentBudget,
    proposedBudget: decision.proposedBudget,
    action: decision.action,
    sourceRefs: decision.sourceRefs,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function createApproval(decision: BudgetDecision, approverId: string, now = new Date(), ttlMinutes = 30): ApprovalRecord {
  const createdAt = now.toISOString();
  return {
    approvalId: `approval_${now.getTime()}_${crypto.randomBytes(5).toString("hex")}`,
    decisionIdempotencyKey: decision.idempotencyKey,
    snapshotHash: snapshotHash(decision),
    approverId,
    status: "approved",
    createdAt,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
}

export function isApprovalUsable(approval: ApprovalRecord, decision: BudgetDecision, now = new Date()): boolean {
  return approval.status === "approved" && Date.parse(approval.expiresAt) > now.getTime() && approval.decisionIdempotencyKey === decision.idempotencyKey && approval.snapshotHash === snapshotHash(decision);
}
