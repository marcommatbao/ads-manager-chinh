import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { createApproval, isApprovalUsable, type ApprovalRecord } from "./approval";
import type { BudgetDecision } from "./profit-evaluator";
import { applyApprovedBudget, type ApplyResult, type BudgetProviderAdapter } from "./provider-apply";
import { readAutomationPolicy } from "./policy";
import { resolveCurrentSnapshot } from "./snapshot-consumer";
import { reserveExecution } from "./execution-reservations";
import type { DecisionAuditRecord } from "./decision-audit";

type ExecutionOutcome = ApplyResult | { status: "needs_reconciliation"; reason: "provider_or_storage_uncertain" };
type StoredApproval = { approval: ApprovalRecord; decision: BudgetDecision; claimedAt?: string; outcome?: ExecutionOutcome };
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

/** No HTTP apply endpoint calls this yet. Requires a server-owned adapter. */
export async function executeStoredApproval(id: string, company: string, adapter: BudgetProviderAdapter, now = new Date()): Promise<ExecutionOutcome> {
  const policy = readAutomationPolicy();
  if (!policy.globalEnabled || !policy.applyEnabled) throw new Error("AUTOMATION_APPLY_DISABLED");
  // Legacy/unbound approvals cannot reach a provider adapter.
  const candidate = read().find(row => row.approval.approvalId === id && row.decision.company === company);
  const decision = candidate?.decision as DecisionAuditRecord | undefined;
  if (!decision?.binding || !decision.snapshotRegistryId || !decision.snapshotPayloadHash || !decision.expiresAt || !Number.isFinite(Date.parse(decision.expiresAt)) || Date.parse(decision.expiresAt) <= now.getTime()) throw new Error("EXECUTION_BINDING_REQUIRED");
  const { snapshot } = resolveCurrentSnapshot({ registryId: decision.snapshotRegistryId, provider: decision.binding.provider, company, campaignId: decision.campaignId }, now);
  if (!snapshot.payload.approvable || snapshot.payloadHash !== decision.snapshotPayloadHash || snapshot.binding.policyRevision !== decision.binding.policyRevision || adapter.provider !== snapshot.binding.provider || adapter.accountId !== snapshot.binding.accountId) throw new Error("EXECUTION_BINDING_MISMATCH");
  // Quotas and currency-sensitive execution remain disabled until an adapter
  // declares a verified provider/account scope and complete business evidence.
  await reserveExecution(id, snapshot.binding, `policy:${policy.version}`, policy, now);
  const claimed = await claimApproval(id, company, now);
  const persistOutcome = async (outcome: ExecutionOutcome) => withFileLock(file(), async () => {
    const rows = read();
    const row = rows.find(item => item.approval.approvalId === id);
    if (!row || row.approval.status !== "consumed") throw new Error("APPROVAL_NOT_USABLE");
    row.outcome = outcome;
    save(rows);
  });
  let outcome: ExecutionOutcome;
  try {
    const latest = readAutomationPolicy();
    if (!latest.globalEnabled || !latest.applyEnabled || latest.protectedCampaignIds.includes(claimed.decision.campaignId) || latest.version !== policy.version) {
      outcome = { status: "blocked", provider: adapter.provider, campaignId: claimed.decision.campaignId, before: null, requested: claimed.decision.proposedBudget, after: null, reason: "policy_changed_or_disabled" };
    } else {
      // Durable claim is already consumed. Only this private call receives the
      // verified pre-consumption state; never reopen the persisted approval.
      outcome = await applyApprovedBudget(claimed.decision, { ...claimed.approval, status: "approved" }, adapter, now);
    }
    await persistOutcome(outcome);
    return outcome;
  } catch {
    outcome = { status: "needs_reconciliation", reason: "provider_or_storage_uncertain" };
    // Never expose raw provider errors or automatically retry a mutation.
    try { await persistOutcome(outcome); } catch { /* consumed claim remains the durable stop */ }
    return outcome;
  }
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
