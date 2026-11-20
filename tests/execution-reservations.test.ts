import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOMATION_POLICY } from "@/lib/automation/policy";
import { reserveExecution } from "@/lib/automation/execution-reservations";
const binding = { provider: "google" as const, company: "MBC", accountId: "111", campaignId: "123", policyRevision: "p1" };
const now = new Date("2026-11-20T10:00:00Z");
let dir: string;
afterEach(() => { vi.restoreAllMocks(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() { dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-fixture-")); vi.spyOn(process, "cwd").mockReturnValue(dir); }
describe("durable campaign and quota reservations", () => {
 it("serializes competing approvals for the same campaign", async () => {
  setup();
  const results = await Promise.allSettled([reserveExecution("a", binding, "run", DEFAULT_AUTOMATION_POLICY, now), reserveExecution("b", binding, "run", DEFAULT_AUTOMATION_POLICY, now)]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
 });
 it("enforces daily and run caps across different campaigns", async () => {
  setup(); const policy = { ...DEFAULT_AUTOMATION_POLICY, maxMutationsPerRun: 1, maxMutationsPerDay: 2 };
  await reserveExecution("a", binding, "run", policy, now);
  await expect(reserveExecution("b", { ...binding, campaignId: "456" }, "run", policy, now)).rejects.toThrow("RUN_MUTATION_LIMIT");
  await reserveExecution("c", { ...binding, campaignId: "456" }, "run2", policy, now);
  await expect(reserveExecution("d", { ...binding, campaignId: "789" }, "run3", policy, now)).rejects.toThrow("DAILY_MUTATION_LIMIT");
 });
 it("rejects replay and corrupt ledger", async () => {
  setup(); await reserveExecution("a", binding, "run", DEFAULT_AUTOMATION_POLICY, now);
  await expect(reserveExecution("a", binding, "run", DEFAULT_AUTOMATION_POLICY, now)).rejects.toThrow("EXECUTION_ALREADY_RESERVED");
  fs.writeFileSync(path.join(dir, "data/automation-execution-reservations.json"), "invalid");
  await expect(reserveExecution("b", binding, "run", DEFAULT_AUTOMATION_POLICY, now)).rejects.toThrow("EXECUTION_LEDGER_UNAVAILABLE");
 });
});
