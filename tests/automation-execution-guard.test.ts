import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { persistApproval, executeStoredApproval } from "@/lib/automation/approval-store";
import { DEFAULT_AUTOMATION_POLICY, readAutomationPolicy } from "@/lib/automation/policy";
import { reserveExecution } from "@/lib/automation/execution-reservations";
import { resolveCurrentSnapshot } from "@/lib/automation/snapshot-consumer";
import * as locks from "@/lib/file-lock";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

vi.mock("@/lib/automation/policy", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/automation/policy")>();
  return { ...original, readAutomationPolicy: vi.fn(() => ({
    ...original.DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "fixture",
    globalEnabled: true, applyEnabled: true,
  })) };
});
vi.mock("@/lib/automation/execution-reservations", () => ({ reserveExecution: vi.fn() }));
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: vi.fn() }));

let dir: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

it("hard-blocks enabled, bound approvals before any reservation, claim or provider access", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "execution-guard-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  const now = new Date("2026-11-21T00:00:00Z");
  const binding = { provider: "meta" as const, company: "MBC", accountId: "111", campaignId: "c1", policyRevision: "1.0" };
  const decision: BudgetDecision & { binding: typeof binding; snapshotRegistryId: string; snapshotPayloadHash: string; expiresAt: string } = {
    binding, snapshotRegistryId: "fixture", snapshotPayloadHash: "fixture-hash", expiresAt: "2099-01-01T00:00:00Z",
    idempotencyKey: "guard-c1", action: "increase_budget", confidence: "high", reasonCode: "test", reason: "test",
    company: "MBC", campaignId: "c1", campaignName: "fixture", currentBudget: 100, proposedBudget: 110,
    delta: 10, sourceRefs: ["fixture"], requiresApproval: true,
  };
  const approval = await persistApproval(decision, "fixture-actor", now);
  const dataDir = path.join(dir, "data");
  fs.writeFileSync(path.join(dataDir, "automation-policy.json"), JSON.stringify({
    ...DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "fixture", globalEnabled: true, applyEnabled: true,
  }));
  const original = fs.readFileSync(path.join(dataDir, "automation-approvals.json"), "utf8");
  const files = fs.readdirSync(dataDir).sort();
  // A claim must acquire this lock. Watch the actual internal claim boundary;
  // spying on the exported claimApproval would miss same-module calls.
  const lock = vi.spyOn(locks, "withFileLock");
  const adapter = {
    provider: "meta" as const, accountId: "111",
    readBudget: vi.fn(async () => 100),
    setBudget: vi.fn(async () => ({ accepted: true, requestHash: "fixture" })),
  };
  const attempts = await Promise.allSettled([
    executeStoredApproval(approval.approvalId, "MBC", adapter, now),
    executeStoredApproval(approval.approvalId, "MBC", adapter, now),
  ]);
  for (const attempt of attempts) {
    expect(attempt.status).toBe("rejected");
    if (attempt.status === "rejected") expect(attempt.reason).toEqual(new Error("EXECUTION_COORDINATION_UNVERIFIED"));
  }
  expect(readAutomationPolicy).not.toHaveBeenCalled();
  expect(resolveCurrentSnapshot).not.toHaveBeenCalled();
  expect(reserveExecution).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
  expect(adapter.readBudget).not.toHaveBeenCalled();
  expect(adapter.setBudget).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(dataDir, "automation-approvals.json"), "utf8")).toBe(original);
  expect(fs.readdirSync(dataDir).sort()).toEqual(files);
  expect(JSON.parse(original)[0]).toMatchObject({ approval: { status: "approved" } });
});
