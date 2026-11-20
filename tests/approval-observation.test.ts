import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: m.resolve }));
let dir: string | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });
async function setup() {
 dir = fs.mkdtempSync(path.join(os.tmpdir(), "observation-fixture-")); vi.spyOn(process, "cwd").mockReturnValue(dir);
 const binding = { provider: "google", company: "MBC", accountId: "111", campaignId: "123", policyRevision: "p1" };
 const row = { approval: { approvalId: "a", status: "consumed" }, decision: { company: "MBC", campaignId: "123", binding, currentBudget: 100, proposedBudget: 110, currency: "VND", budgetKind: "campaign_daily_budget" }, claimedAt: "2026-11-20T10:00:00Z", outcome: { status: "needs_reconciliation" } };
 fs.mkdirSync(path.join(dir, "data")); fs.writeFileSync(path.join(dir, "data/automation-approvals.json"), JSON.stringify([row]));
 m.resolve.mockReturnValue({ snapshot: { binding, payloadHash: "hash", payload: { currency: "VND", budgetKind: "campaign_daily_budget", dailyBudget: 110, readAt: "2026-11-20T10:01:00Z" } } });
 return import("@/lib/automation/approval-store");
}
describe("registry backed reconciliation observation", () => {
 it("rejects duplicate, future and older observations without overwriting newest", async () => {
  const store = await setup(); const now = new Date("2026-11-20T10:05:00Z");
  await store.recordApprovalObservation("a", "MBC", "r1", "u", now);
  await expect(store.recordApprovalObservation("a", "MBC", "r1", "u", now)).rejects.toThrow("OBSERVATION_ALREADY_RECORDED");
  const value = m.resolve();
  m.resolve.mockReturnValue({ snapshot: { ...value.snapshot, payload: { ...value.snapshot.payload, readAt: "2026-11-20T10:00:30Z" } } });
  await expect(store.recordApprovalObservation("a", "MBC", "r2", "u", now)).rejects.toThrow("OBSERVATION_NOT_NEWER");
  m.resolve.mockReturnValue({ snapshot: { ...value.snapshot, payload: { ...value.snapshot.payload, readAt: "2099-01-01T00:00:00Z" } } });
  await expect(store.recordApprovalObservation("a", "MBC", "r3", "u", now)).rejects.toThrow("OBSERVATION_TIME_INVALID");
  expect(store.listApprovalSummaries(["MBC"])[0].lastObservation?.readAt).toBe("2026-11-20T10:01:00Z");
 });
 it("persists observation without changing consumed state or uncertain outcome", async () => {
  const store = await setup(); const a = await store.recordApprovalObservation("a", "MBC", "r", "trusted", new Date("2026-11-20T10:02:00Z"));
  expect(a).toMatchObject({ state: "matches_proposed", retryAllowed: false, undoAllowed: false, executionProven: false });
  const row = JSON.parse(fs.readFileSync(path.join(dir!, "data/automation-approvals.json"), "utf8"))[0];
  expect(row.approval.status).toBe("consumed"); expect(row.outcome.status).toBe("needs_reconciliation"); expect(row.observations[0].actorId).toBe("trusted");
 });
 it("rejects pre-claim observations and mismatched units", async () => {
  const store = await setup(); const value = m.resolve();
  m.resolve.mockReturnValue({ snapshot: { ...value.snapshot, payload: { ...value.snapshot.payload, readAt: "2026-11-20T09:59:00Z" } } });
  await expect(store.recordApprovalObservation("a", "MBC", "r", "u")).rejects.toThrow("OBSERVATION_PREDATES_CLAIM");
  m.resolve.mockReturnValue({ snapshot: { ...value.snapshot, payload: { ...value.snapshot.payload, currency: "USD" } } });
  await expect(store.recordApprovalObservation("a", "MBC", "r", "u")).rejects.toThrow("OBSERVATION_UNIT_UNVERIFIED");
  await expect(store.recordApprovalObservation("a", "MBI", "r", "u")).rejects.toThrow("APPROVAL_NOT_FOUND");
 });
});
