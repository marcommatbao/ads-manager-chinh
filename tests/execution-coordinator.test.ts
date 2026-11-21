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
const request = (extra: Partial<CoordinationRequest> = {}): CoordinationRequest => ({ approvalId: "a", company: "MBC", provider: "google", accountId: "account", campaignId: "campaign", runId: "run", sourceScope: "registry-id", sourceHash: "sensitive-hash", sourceReadAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), policyIdentity: "revision-1", limits: { maxMutationsPerDay: 5, maxMutationsPerRun: 5, cooldownHours: 24 }, ...extra });
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
  const r = request({ limits: { maxMutationsPerDay: kind === "daily" ? 1 : 5, maxMutationsPerRun: 1, cooldownHours: 0 } });
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
