import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { afterEach, expect, it } from "vitest";
import { ExecutionCoordinator, type CoordinationRequest } from "../lib/automation/execution-coordinator";
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "coordinator-")); dirs.push(dir);
  const db = path.join(dir, "claims.sqlite");
  const modulePath = path.join(dir, "coordinator.mjs");
  writeFileSync(modulePath, ts.transpileModule(readFileSync("lib/automation/execution-coordinator.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return { db, module: modulePath };
}
const request = (extra: Partial<CoordinationRequest> = {}): CoordinationRequest => ({ approvalId: "a", decisionId: "decision", approvalSnapshotHash: "approval-hash", currency: "USD", budgetKind: "campaign_daily_budget", beforeBudgetMinor: 100, proposedBudgetMinor: 110, company: "MBC", provider: "google", accountId: "account", campaignId: "campaign", runId: "run", sourceScope: "registry-id", sourceHash: "sensitive-hash", sourceReadAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), policyIdentity: "revision-1", limits: { maxMutationsPerDay: 5, maxMutationsPerRun: 5, cooldownHours: 24, maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 100 }, ...extra });
function child(f: ReturnType<typeof fixture>, r: CoordinationRequest) {
  return new Promise<string>((resolve, reject) => {
    const code = `import {ExecutionCoordinator} from ${JSON.stringify(f.module)}; try { const c=new ExecutionCoordinator(${JSON.stringify(f.db)}); console.log(c.reserveAndClaim(${JSON.stringify(r)}).status); c.close(); } catch(e) { console.log(e.message); }`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; p.stdout.on("data", b => output += b); p.on("error", reject); p.on("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`child exit ${code}`)));
  });
}
it("process death during an uncommitted write rolls back and leaves no phantom quota", async () => {
  const f = fixture(); const coordinator = new ExecutionCoordinator(f.db); coordinator.close();
  const code = `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(f.db)}); db.exec("BEGIN IMMEDIATE; INSERT INTO execution_claims VALUES ('crashed','identity','MBC','google','account','campaign','run','2000-01-01',1)"); process.kill(process.pid,'SIGKILL');`;
  await new Promise<void>((resolve, reject) => {
    const processChild = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" });
    processChild.on("error", reject);
    processChild.on("exit", (_code, signal) => signal === "SIGKILL" ? resolve() : reject(new Error("Crash fixture did not reach SIGKILL")));
  });
  const db = new DatabaseSync(f.db);
  expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
  db.close();
  expect(await child(f, request())).toBe("claimed");
});

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("competing OS processes: distinct approvals on same campaign have exactly one winner", async () => {
  const f = fixture(); const c = new ExecutionCoordinator(f.db); c.close();
  const r = request(); const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "b" })]);
  expect(results.sort()).toEqual(["CAMPAIGN_EXECUTION_LOCKED", "claimed"].sort());
});
it.each(["daily", "run"])("competing OS processes enforce company %s cap across campaigns", async kind => {
  const f = fixture(); const c = new ExecutionCoordinator(f.db); c.close();
  const r = request({ limits: { maxMutationsPerDay: kind === "daily" ? 1 : 5, maxMutationsPerRun: 1, cooldownHours: 0, maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 100 } });
  const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "b", campaignId: "other", runId: kind === "daily" ? "other" : "run" })]);
  expect(results.filter(x => x === "claimed")).toHaveLength(1);
  expect(results).toContain(kind === "daily" ? "DAILY_MUTATION_LIMIT" : "RUN_MUTATION_LIMIT");
});
it("restart preserves replay and rejects changed identity without exposing hash", async () => {
  const f = fixture(), r = request();
  expect(await child(f, r)).toBe("claimed");
  expect(await child(f, r)).toBe("already_claimed");
  expect(await child(f, { ...r, sourceHash: "changed" })).toBe("EXECUTION_IDENTITY_CONFLICT");
});
it("company/provider/account scopes differ while company quotas span providers", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request();
  try {
    c.reserveAndClaim(r);
    for (const extra of [{ company: "MBI" }, { provider: "meta" as const }, { accountId: "other" }]) expect(c.reserveAndClaim({ ...r, ...extra, approvalId: JSON.stringify(extra) }).status).toBe("claimed");
    expect(() => c.reserveAndClaim({ ...r, approvalId: "cap", provider: "meta", campaignId: "other", limits: { ...r.limits, maxMutationsPerDay: 3, maxMutationsPerRun: 3 } })).toThrow("DAILY_MUTATION_LIMIT");
  } finally { c.close(); }
});
it("failed insert rolls back quota and claim atomically", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), admin = new DatabaseSync(f.db), r = request();
  admin.exec("CREATE TRIGGER fail BEFORE INSERT ON execution_claims BEGIN SELECT RAISE(ABORT, 'private failure'); END");
  expect(() => c.reserveAndClaim(r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
  expect(admin.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
  admin.exec("DROP TRIGGER fail");
  expect(c.reserveAndClaim(r).status).toBe("claimed"); admin.close(); c.close();
});
it("fails closed for invalid dates, future source clocks and malformed limits", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request();
  for (const patch of [{ sourceReadAt: "2026-02-30T00:00:00.000Z" }, { sourceReadAt: new Date(Date.now() + 60000).toISOString() }, { expiresAt: "invalid" }, { sourceScope: "" }, { policyIdentity: "" }, ...[NaN, Infinity, -1, 0.5, 10001].map(n => ({ limits: { ...r.limits, maxMutationsPerDay: n } }))]) expect(() => c.reserveAndClaim({ ...r, ...patch })).toThrow("INVALID_EXECUTION_COORDINATION");
  c.close();
});
it("future persisted claims, corruption and bounded busy locks fail closed", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request(), admin = new DatabaseSync(f.db);
  c.reserveAndClaim(r); admin.prepare("UPDATE execution_claims SET claimed_at=?").run(Date.now() + 60000);
  expect(() => c.reserveAndClaim(r)).toThrow("EXECUTION_CLOCK_INVALID");
  admin.exec("BEGIN IMMEDIATE"); const start = Date.now();
  expect(() => c.reserveAndClaim(r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
  expect(Date.now() - start).toBeLessThan(4000); admin.exec("ROLLBACK"); admin.close(); c.close();
  writeFileSync(f.db, "private corrupt contents");
  expect(() => new ExecutionCoordinator(f.db)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
});
it("cooldown survives day rollover and uncertain claims never become replayable execution", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request(), admin = new DatabaseSync(f.db);
  try {
    c.reserveAndClaim(r);
    admin.prepare("UPDATE execution_claims SET day=?, claimed_at=?").run("2000-01-01", Date.now() - 3600000);
    expect(() => c.reserveAndClaim({ ...r, approvalId: "b" })).toThrow("CAMPAIGN_EXECUTION_LOCKED");
    admin.prepare("UPDATE execution_claims SET claimed_at=?").run(Date.now() - 48 * 3600000);
    expect(c.reserveAndClaim(r).status).toBe("already_claimed");
    expect(c.reserveAndClaim({ ...r, approvalId: "b" }).status).toBe("claimed");
  } finally { admin.close(); c.close(); }
});

it.each(["daily", "run"])("OS processes reserve absolute delta under %s cap", async kind => {
  const f = fixture(); const c = new ExecutionCoordinator(f.db); c.close();
  const r = request();
  r.limits = { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: kind === "daily" ? 15 : 100, maxAbsoluteBudgetDeltaPerRunMinor: 15 };
  const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "decrease", campaignId: "other", proposedBudgetMinor: 90, runId: kind === "daily" ? "other" : r.runId })]);
  expect(results.filter(x => x === "claimed")).toHaveLength(1);
  expect(results).toContain(kind === "daily" ? "DAILY_BUDGET_DELTA_LIMIT" : "RUN_BUDGET_DELTA_LIMIT");
});
it("binds all provenance and monetary identities on replay", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request();
  try {
    c.reserveAndClaim(r);
    for (const patch of [{ decisionId: "other" }, { approvalSnapshotHash: "other" }, { sourceScope: "other" }, { sourceHash: "other" }, { policyIdentity: "other" }, { currency: "EUR" }, { beforeBudgetMinor: 99 }, { proposedBudgetMinor: 109 }, { limits: { ...r.limits, maxAbsoluteBudgetDeltaPerRunMinor: 50 } }]) {
      expect(() => c.reserveAndClaim({ ...r, ...patch })).toThrow("EXECUTION_IDENTITY_CONFLICT");
    }
  } finally { c.close(); }
});
it("requires explicit safe monetary units and limits", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request();
  try {
    for (const patch of [{ currency: "usd" }, { currency: "XYZ" }, { budgetKind: "shared_budget" }, ...[0, -1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1].flatMap(n => [{ beforeBudgetMinor: n }, { proposedBudgetMinor: n }]), ...[undefined, NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1].map(n => ({ limits: { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: n } }))]) {
      expect(() => c.reserveAndClaim({ ...r, ...patch } as CoordinationRequest)).toThrow("INVALID_EXECUTION_COORDINATION");
    }
  } finally { c.close(); }
});
it("currency ledgers stay separate and exact integer totals do not overflow", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request();
  const cap = Number.MAX_SAFE_INTEGER;
  r.beforeBudgetMinor = 1; r.proposedBudgetMinor = cap;
  r.limits = { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: cap, maxAbsoluteBudgetDeltaPerRunMinor: cap };
  try {
    c.reserveAndClaim(r);
    expect(c.reserveAndClaim({ ...r, approvalId: "eur", campaignId: "eur", currency: "EUR" }).status).toBe("claimed");
    expect(() => c.reserveAndClaim({ ...r, approvalId: "overflow", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
  } finally { c.close(); }
});
it("budget insert rollback leaves neither claim nor quota", () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), db = new DatabaseSync(f.db), r = request();
  try {
    db.exec("CREATE TRIGGER fail_budget BEFORE INSERT ON execution_budget_reservations BEGIN SELECT RAISE(ABORT, 'private'); END");
    expect(() => c.reserveAndClaim(r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
    db.exec("DROP TRIGGER fail_budget");
    expect(c.reserveAndClaim(r).status).toBe("claimed");
  } finally { db.close(); c.close(); }
});
it("uncertain outcomes persist across restart without releasing claim or quota", () => {
  const f = fixture(), r = request(); r.limits.maxAbsoluteBudgetDeltaPerDayMinor = 10; r.limits.maxAbsoluteBudgetDeltaPerRunMinor = 10;
  let c = new ExecutionCoordinator(f.db);
  c.reserveAndClaim(r);
  expect(c.reconciliationStatus(r.approvalId)).toBe("needs_reconciliation");
  expect(c.recordOutcome({ eventId: "timeout", approvalId: r.approvalId, kind: "timeout" })).toBe("recorded");
  c.close(); c = new ExecutionCoordinator(f.db);
  try {
    expect(c.reconciliationStatus(r.approvalId)).toBe("needs_reconciliation");
    expect(c.recordOutcome({ eventId: "timeout", approvalId: r.approvalId, kind: "timeout" })).toBe("already_recorded");
    expect(c.reserveAndClaim(r).status).toBe("already_claimed");
    expect(() => c.reserveAndClaim({ ...r, approvalId: "new", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
    expect(() => c.recordOutcome({ eventId: "equality", approvalId: r.approvalId, kind: "provider_confirmed" })).toThrow("INVALID_EXECUTION_OUTCOME");
    c.recordOutcome({ eventId: "receipt", approvalId: r.approvalId, kind: "provider_confirmed", providerReceiptId: "trusted-receipt" });
    expect(c.reconciliationStatus(r.approvalId)).toBe("provider_confirmed");
    expect(() => c.reserveAndClaim({ ...r, approvalId: "new", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
    const db = new DatabaseSync(f.db);
    expect(() => db.exec("DELETE FROM execution_outcomes")).toThrow();
    expect(() => db.exec("UPDATE execution_outcomes SET kind='unknown'")).toThrow();
    expect(db.prepare("SELECT count(*) n FROM execution_outcomes").get()?.n).toBe(2);
    db.close();
  } finally { c.close(); }
});
it("concurrent OS outcome writers cannot overwrite or disagree on final receipt", async () => {
  const f = fixture(), c = new ExecutionCoordinator(f.db), r = request(); c.reserveAndClaim(r); c.close();
  const outcomeChild = (receipt: string) => new Promise<string>((resolve, reject) => {
    const code = `import {ExecutionCoordinator} from ${JSON.stringify(f.module)}; const c=new ExecutionCoordinator(${JSON.stringify(f.db)}); try {console.log(c.recordOutcome({eventId:"event",approvalId:"a",kind:"provider_confirmed",providerReceiptId:${JSON.stringify(receipt)}}))} catch(e) {console.log(e.message)} finally {c.close()}`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "ignore"] });
    let output = ""; p.stdout.on("data", b => output += b); p.on("error", reject); p.on("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error("child failed")));
  });
  expect((await Promise.all([outcomeChild("one"), outcomeChild("two")])).sort()).toEqual(["recorded", "EXECUTION_OUTCOME_CONFLICT"].sort());
});
