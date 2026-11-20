import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";
const binding = { provider: "meta" as const, company: "MBC", accountId: "111", campaignId: "c1", policyRevision: "1.0" };
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: () => ({ snapshot: { binding, payloadHash: "fixture-hash", payload: { approvable: true } } }) }));
const decision: BudgetDecision & { binding: typeof binding; snapshotRegistryId: string; snapshotPayloadHash: string; expiresAt: string } = { binding, snapshotRegistryId: "fixture", snapshotPayloadHash: "fixture-hash", expiresAt: "2099-01-01T00:00:00Z", idempotencyKey: "test-c1", action: "increase_budget", confidence: "high", reasonCode: "test", reason: "test", company: "MBC", campaignId: "c1", campaignName: "fixture", currentBudget: 100, proposedBudget: 110, delta: 10, sourceRefs: ["fixture"], requiresApproval: true };
let dir: string | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });
async function setup() { dir = fs.mkdtempSync(path.join(os.tmpdir(), "approval-fixture-")); vi.spyOn(process, "cwd").mockReturnValue(dir); return import("@/lib/automation/approval-store"); }
describe("server-owned approval store", () => {
 it("revokes durably before claim and records the server actor", async () => {
  const store = await setup(); const approval = await store.persistApproval(decision, "actor");
  await store.revokeApproval(approval.approvalId, "MBC", "trusted-admin");
  await expect(store.claimApproval(approval.approvalId, "MBC")).rejects.toThrow("APPROVAL_NOT_USABLE");
  const summary = store.listApprovalSummaries(["MBC"]);
  expect(summary[0]).toMatchObject({ status: "revoked", canRevoke: false });
  expect(store.listApprovalSummaries(["MBI"])).toHaveLength(0);
  expect(JSON.parse(fs.readFileSync(path.join(dir!, "data/automation-approvals.json"), "utf8"))[0].approval.revokedBy).toBe("trusted-admin");
 });
 it("does not revoke consumed work or make expired approval usable", async () => {
  const store = await setup(); const a = await store.persistApproval(decision, "actor");
  await store.claimApproval(a.approvalId, "MBC");
  await expect(store.revokeApproval(a.approvalId, "MBC", "admin")).rejects.toThrow("APPROVAL_NOT_REVOCABLE");
  expect(store.listApprovalSummaries(["MBC"])[0]).toMatchObject({ status: "consumed", outcome: "needs_reconciliation", canRevoke: false });
 });
 it("claim and revoke are serialized with exactly one winner", async () => {
  const store = await setup(); const a = await store.persistApproval(decision, "actor");
  const results = await Promise.allSettled([store.revokeApproval(a.approvalId, "MBC", "admin"), store.claimApproval(a.approvalId, "MBC")]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(x => x.status === "rejected")).toHaveLength(1);
 });
 it("executes only once and persists read-back outcome", async () => {
  const store = await setup();
  const { DEFAULT_AUTOMATION_POLICY } = await import("@/lib/automation/policy");
  const a = await store.persistApproval(decision, "actor");
  fs.writeFileSync(path.join(dir!, "data/automation-policy.json"), JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "fixture", globalEnabled: true, applyEnabled: true }));
  let budget = 100;
  const setBudget = vi.fn(async (_id: string, value: number) => { budget = value; return { accepted: true, requestHash: "fixture" }; });
  const adapter = { provider: "meta" as const, accountId: "111", readBudget: async () => budget, setBudget };
  expect((await store.executeStoredApproval(a.approvalId, "MBC", adapter)).status).toBe("applied");
  await expect(store.executeStoredApproval(a.approvalId, "MBC", adapter)).rejects.toThrow("EXECUTION_ALREADY_RESERVED");
  expect(setBudget).toHaveBeenCalledTimes(1);
  const rows = JSON.parse(fs.readFileSync(path.join(dir!, "data/automation-approvals.json"), "utf8"));
  expect(rows[0].outcome.status).toBe("applied");
 });
 it("blocks disabled apply and does not retry an uncertain provider write", async () => {
  const store = await setup(); const a = await store.persistApproval(decision, "actor");
  const setBudget = vi.fn(async () => { throw new Error("secret-provider-timeout"); });
  const adapter = { provider: "meta" as const, accountId: "111", readBudget: async () => 100, setBudget };
  await expect(store.executeStoredApproval(a.approvalId, "MBC", adapter)).rejects.toThrow("AUTOMATION_APPLY_DISABLED");
  expect(setBudget).not.toHaveBeenCalled();
  const { DEFAULT_AUTOMATION_POLICY } = await import("@/lib/automation/policy");
  fs.writeFileSync(path.join(dir!, "data/automation-policy.json"), JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "fixture", globalEnabled: true, applyEnabled: true }));
  expect((await store.executeStoredApproval(a.approvalId, "MBC", adapter)).status).toBe("needs_reconciliation");
  await expect(store.executeStoredApproval(a.approvalId, "MBC", adapter)).rejects.toThrow("EXECUTION_ALREADY_RESERVED");
  expect(setBudget).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(path.join(dir!, "data/automation-approvals.json"), "utf8")).not.toContain("secret-provider-timeout");
 });
 it("persists approval and allows exactly one concurrent claim", async () => {
  const store = await setup(); const approval = await store.persistApproval(decision, "actor");
  const outcomes = await Promise.allSettled([store.claimApproval(approval.approvalId, "MBC"), store.claimApproval(approval.approvalId, "MBC")]);
  expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(x => x.status === "rejected")).toHaveLength(1);
  await expect(store.persistApproval(decision, "actor")).rejects.toThrow("DECISION_ALREADY_APPROVED");
  const rows = JSON.parse(fs.readFileSync(path.join(dir!, "data/automation-approvals.json"), "utf8"));
  expect(rows[0].approval.status).toBe("consumed");
 });
 it("rejects wrong company, expiry and corrupted storage", async () => {
  const store = await setup(); const approval = await store.persistApproval(decision, "actor", new Date("2020-01-01T00:00:00Z"));
  await expect(store.claimApproval(approval.approvalId, "MBI")).rejects.toThrow("APPROVAL_NOT_USABLE");
  await expect(store.claimApproval(approval.approvalId, "MBC")).rejects.toThrow("APPROVAL_NOT_USABLE");
  fs.writeFileSync(path.join(dir!, "data/automation-approvals.json"), "corrupt");
  await expect(store.persistApproval(decision, "actor")).rejects.toThrow("APPROVAL_STORE_UNAVAILABLE");
 });
});
