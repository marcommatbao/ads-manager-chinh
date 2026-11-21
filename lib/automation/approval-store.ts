import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { createApproval, isApprovalUsable, type ApprovalRecord } from "./approval";
import type { BudgetDecision } from "./profit-evaluator";
import type { ApplyResult, BudgetProviderAdapter } from "./provider-apply";
import { resolveCurrentSnapshot } from "./snapshot-consumer";
import type { DecisionAuditRecord } from "./decision-audit";
import { assessBudgetReconciliation, type ReconciliationAssessment } from "./reconciliation";

type ExecutionOutcome = ApplyResult | { status: "needs_reconciliation"; reason: "provider_or_storage_uncertain" };
type Observation = { registryId: string; payloadHash: string; actorId: string; recordedAt: string; assessment: ReconciliationAssessment };
type StoredApproval = { approval: ApprovalRecord; decision: BudgetDecision; claimedAt?: string; outcome?: ExecutionOutcome; observations?: Observation[] };
const file = () => path.join(process.cwd(), "data", "automation-approvals.json");
function read(): StoredApproval[] {
  try {
    const rows: unknown = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (!Array.isArray(rows) || rows.some(row => !row?.approval?.approvalId || !row?.decision?.campaignId)) throw new Error("Corrupt approval store");
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("APPROVAL_STORE_UNAVAILABLE");
  }
}
function save(rows: StoredApproval[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  writeFileAtomicSync(file(), JSON.stringify(rows, null, 2));
}

/** Caller must resolve this decision from a trusted server-side decision record. */
export async function persistApproval(decision: BudgetDecision, actorId: string, now = new Date()): Promise<ApprovalRecord> {
  if (!["increase_budget", "decrease_budget"].includes(decision.action) || decision.confidence !== "high" || !decision.requiresApproval || !Number.isFinite(decision.proposedBudget) || decision.proposedBudget === null || decision.proposedBudget <= 0) throw new Error("DECISION_NOT_APPROVABLE");
  return withFileLock(file(), async () => {
    const rows = read();
    const existing = rows.find(row => row.approval.decisionIdempotencyKey === decision.idempotencyKey);
    if (existing) throw new Error("DECISION_ALREADY_APPROVED");
    const approval = createApproval(decision, actorId, now);
    save([...rows, { approval, decision }]);
    return approval;
  });
}

/** Consume durably BEFORE provider execution. Never auto-release after timeout. */
export async function claimApproval(id: string, company: string, now = new Date()): Promise<StoredApproval> {
  return withFileLock(file(), async () => {
    const rows = read();
    const row = rows.find(item => item.approval.approvalId === id && item.decision.company === company);
    if (!row || !isApprovalUsable(row.approval, row.decision, now)) throw new Error("APPROVAL_NOT_USABLE");
    row.approval.status = "consumed";
    row.claimedAt = now.toISOString();
    save(rows);
    return structuredClone(row);
  });
}

/**
 * Execution is unavailable until a shared transactional coordinator can atomically
 * enforce reservation and claim across executors. Local file locks do not verify
 * single-process ownership. Policy, HTTP input and environment cannot unlock this.
 * Restore binding/policy validation with that coordinator before enabling apply.
 */
// Preserve the caller signature while execution is deliberately unavailable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function executeStoredApproval(_id: string, _company: string, _adapter: BudgetProviderAdapter, _now?: Date): Promise<ExecutionOutcome> {
  throw new Error("EXECUTION_COORDINATION_UNVERIFIED");
}

/** Expiry is computed on read; never relabel consumed/uncertain work as retryable. */
export function listApprovalSummaries(companies: string[], now = new Date()) {
  return read().filter(row => companies.includes(row.decision.company)).slice(-100).reverse().map(row => {
    const expired = !Number.isFinite(Date.parse(row.approval.expiresAt)) || Date.parse(row.approval.expiresAt) <= now.getTime();
    return {
      approvalId: row.approval.approvalId,
      company: row.decision.company, campaignId: row.decision.campaignId,
      status: row.approval.status === "approved" && expired ? "expired" : row.approval.status,
      createdAt: row.approval.createdAt, expiresAt: row.approval.expiresAt,
      revokedAt: row.approval.revokedAt ?? null,
      outcome: row.outcome?.status ?? (row.claimedAt ? "needs_reconciliation" : null),
      canRevoke: row.approval.status === "approved" && !expired,
      lastObservation: row.observations?.length ? row.observations[row.observations.length - 1].assessment : null,
    };
  });
}

export async function revokeApproval(id: string, company: string, actorId: string, now = new Date()) {
  return withFileLock(file(), async () => {
    const rows = read();
    const row = rows.find(item => item.approval.approvalId === id && item.decision.company === company);
    if (!row) throw new Error("APPROVAL_NOT_FOUND");
    if (row.approval.status !== "approved" || !Number.isFinite(Date.parse(row.approval.expiresAt)) || Date.parse(row.approval.expiresAt) <= now.getTime()) throw new Error("APPROVAL_NOT_REVOCABLE");
    row.approval.status = "revoked";
    row.approval.revokedAt = now.toISOString();
    row.approval.revokedBy = actorId;
    save(rows);
    return { approvalId: id, status: "revoked" as const, revokedAt: row.approval.revokedAt };
  });
}

/** Persist an observation only. Never change outcome, claim, quota or provider. */
export async function recordApprovalObservation(id: string, company: string, registryId: string, actorId: string, now = new Date()) {
  return withFileLock(file(), async () => {
    const rows = read();
    const row = rows.find(item => item.approval.approvalId === id && item.decision.company === company);
    if (!row) throw new Error("APPROVAL_NOT_FOUND");
    if (row.approval.status !== "consumed" || !row.claimedAt || !Number.isFinite(Date.parse(row.claimedAt))) throw new Error("APPROVAL_NOT_RECONCILABLE");
    const d = row.decision as DecisionAuditRecord;
    if (!d.binding || d.binding.provider !== "google" || d.proposedBudget === null) throw new Error("OBSERVATION_UNIT_UNVERIFIED");
    const { snapshot } = resolveCurrentSnapshot({ registryId, provider: d.binding.provider, company, campaignId: d.campaignId }, now);
    if (snapshot.binding.accountId !== d.binding.accountId || snapshot.binding.policyRevision !== d.binding.policyRevision) throw new Error("OBSERVATION_SCOPE_MISMATCH");
    const payload = snapshot.payload as typeof snapshot.payload & { currency?: string; budgetKind?: string; dailyBudget?: number };
    // Original currency/budget kind must be recorded explicitly; no inference
    // from campaign names, numeric magnitude or platform defaults.
    const original = d as DecisionAuditRecord & { currency?: string; budgetKind?: string };
    if (!original.currency || payload.currency !== original.currency || original.budgetKind !== "campaign_daily_budget" || payload.budgetKind !== original.budgetKind || typeof payload.dailyBudget !== "number") throw new Error("OBSERVATION_UNIT_UNVERIFIED");
    if (Date.parse(payload.readAt) < Date.parse(row.claimedAt)) throw new Error("OBSERVATION_PREDATES_CLAIM");
    const observedAt = Date.parse(payload.readAt);
    if (!Number.isFinite(observedAt) || observedAt > now.getTime()) throw new Error("OBSERVATION_TIME_INVALID");
    const previous = row.observations ?? [];
    if (previous.some(item => item.registryId === registryId)) throw new Error("OBSERVATION_ALREADY_RECORDED");
    if (previous.some(item => Date.parse(item.assessment.readAt) >= observedAt)) throw new Error("OBSERVATION_NOT_NEWER");
    const assessment = assessBudgetReconciliation({ beforeBudget: d.currentBudget, proposedBudget: d.proposedBudget, observedBudget: payload.dailyBudget, scopeVerified: true, readAt: payload.readAt });
    if (assessment.state === "unverified") throw new Error("OBSERVATION_UNIT_UNVERIFIED");
    row.observations = [...(row.observations ?? []), { registryId, payloadHash: snapshot.payloadHash, actorId, recordedAt: now.toISOString(), assessment }].slice(-100);
    save(rows);
    return assessment;
  });
}
