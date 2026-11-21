import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutionCoordinator, type CoordinationRequest } from "../lib/automation/execution-coordinator";
const dirs: string[] = [];
const fixturePaths = new WeakMap<ExecutionCoordinator, string>();
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "coordinator-")); dirs.push(dir);
  const db = path.join(dir, "claims.sqlite");
  const modulePath = path.join(dir, "coordinator.mjs");
  writeFileSync(modulePath, ts.transpileModule(readFileSync("lib/automation/execution-coordinator.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return { db, module: modulePath };
}
const request = (extra: Partial<CoordinationRequest> = {}): CoordinationRequest => ({ approvalId: "a", decisionId: "decision", approvalSnapshotHash: "approval-hash", currency: "USD", budgetKind: "campaign_daily_budget", beforeBudgetMinor: 100, proposedBudgetMinor: 110, company: "MBC", provider: "google", accountId: "account", campaignId: "campaign", runId: "run", sourceScope: "registry-id", sourceHash: "sensitive-hash", sourceReadAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), policyIdentity: "revision-1", limits: { maxMutationsPerDay: 5, maxMutationsPerRun: 5, cooldownHours: 24, maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 100 }, ...extra });
function authorize(c: ExecutionCoordinator, r: CoordinationRequest) {
  c.registerCurrentPolicy(r.company, r.policyIdentity);
  c.registerSource(r, r.expiresAt);
  c.registerAuthorization(r, "trusted-approver");
}
function registeredFixtureClaim(c: ExecutionCoordinator, r: CoordinationRequest) {
  // Fixture ingestion is explicit and separate from the production claim API.
  const db = new DatabaseSync(fixturePaths.get(c)!);
  const exists = db.prepare("SELECT 1 FROM decision_authorizations WHERE approval_id=?").get(r.approvalId);
  db.close();
  if (!exists) authorize(c, r);
  return c.reserveAndClaim(r);
}
function coordinator(db: string) {
  const c = new ExecutionCoordinator(db);
  fixturePaths.set(c, db);
  return c;
}
function child(f: ReturnType<typeof fixture>, r: CoordinationRequest) {
  const c = coordinator(f.db);
  const db = new DatabaseSync(f.db);
  const exists = db.prepare("SELECT 1 FROM decision_authorizations WHERE approval_id=?").get(r.approvalId); db.close();
  if (!exists) authorize(c, r);
  c.close();
  return new Promise<string>((resolve, reject) => {
    const code = `import {ExecutionCoordinator} from ${JSON.stringify(f.module)}; try { const c=new ExecutionCoordinator(${JSON.stringify(f.db)}); console.log(c.reserveAndClaim(${JSON.stringify(r)}).status); c.close(); } catch(e) { console.log(e.message); }`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; p.stdout.on("data", b => output += b); p.on("error", reject); p.on("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`child exit ${code}`)));
  });
}
it("process death during an uncommitted write rolls back and leaves no phantom quota", async () => {
  const f = fixture(); const c = coordinator(f.db); c.close();
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
  const f = fixture(); const c = coordinator(f.db); c.close();
  const r = request(); const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "b", decisionId: "decision-b", sourceScope: "source-b" })]);
  expect(results.sort()).toEqual(["CAMPAIGN_EXECUTION_LOCKED", "claimed"].sort());
});
it.each(["daily", "run"])("competing OS processes enforce company %s cap across campaigns", async kind => {
  const f = fixture(); const c = coordinator(f.db); c.close();
  const r = request({ limits: { maxMutationsPerDay: kind === "daily" ? 1 : 5, maxMutationsPerRun: 1, cooldownHours: 0, maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 100 } });
  const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "b", decisionId: "decision-b", sourceScope: "source-b", campaignId: "other", runId: kind === "daily" ? "other" : "run" })]);
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
  const f = fixture(), c = coordinator(f.db), r = request();
  try {
    registeredFixtureClaim(c, r);
    for (const extra of [{ company: "MBI" }, { provider: "meta" as const }, { accountId: "other" }]) expect(registeredFixtureClaim(c, { ...r, ...extra, approvalId: JSON.stringify(extra), decisionId: JSON.stringify(extra), sourceScope: JSON.stringify(extra) }).status).toBe("claimed");
    expect(() => registeredFixtureClaim(c, { ...r, approvalId: "cap", decisionId: "decision-cap", sourceScope: "source-cap", provider: "meta", campaignId: "other", limits: { ...r.limits, maxMutationsPerDay: 3, maxMutationsPerRun: 3 } })).toThrow("DAILY_MUTATION_LIMIT");
  } finally { c.close(); }
});
it("failed insert rolls back quota and claim atomically", () => {
  const f = fixture(), c = coordinator(f.db), admin = new DatabaseSync(f.db), r = request();
  admin.exec("CREATE TRIGGER fail BEFORE INSERT ON execution_claims BEGIN SELECT RAISE(ABORT, 'private failure'); END");
  expect(() => registeredFixtureClaim(c, r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
  expect(admin.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
  admin.exec("DROP TRIGGER fail");
  expect(registeredFixtureClaim(c, r).status).toBe("claimed"); admin.close(); c.close();
});
it("fails closed for invalid dates, future source clocks and malformed limits", () => {
  const f = fixture(), c = coordinator(f.db), r = request();
  for (const patch of [{ sourceReadAt: "2026-02-30T00:00:00.000Z" }, { sourceReadAt: new Date(Date.now() + 60000).toISOString() }, { expiresAt: "invalid" }, { sourceScope: "" }, { policyIdentity: "" }, ...[NaN, Infinity, -1, 0.5, 10001].map(n => ({ limits: { ...r.limits, maxMutationsPerDay: n } }))]) expect(() => c.reserveAndClaim({ ...r, ...patch })).toThrow("INVALID_EXECUTION_COORDINATION");
  c.close();
});
it("future persisted claims, corruption and bounded busy locks fail closed", () => {
  const f = fixture(), c = coordinator(f.db), r = request(), admin = new DatabaseSync(f.db);
  registeredFixtureClaim(c, r); admin.prepare("UPDATE execution_claims SET claimed_at=?").run(Date.now() + 60000);
  expect(() => registeredFixtureClaim(c, r)).toThrow("EXECUTION_CLOCK_INVALID");
  admin.exec("BEGIN IMMEDIATE"); const start = Date.now();
  expect(() => registeredFixtureClaim(c, r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
  expect(Date.now() - start).toBeLessThan(4000); admin.exec("ROLLBACK"); admin.close(); c.close();
  writeFileSync(f.db, "private corrupt contents");
  expect(() => coordinator(f.db)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
});
it("cooldown survives day rollover and uncertain claims never become replayable execution", () => {
  const f = fixture(), c = coordinator(f.db), r = request(), admin = new DatabaseSync(f.db);
  try {
    registeredFixtureClaim(c, r);
    admin.prepare("UPDATE execution_claims SET day=?, claimed_at=?").run("2000-01-01", Date.now() - 3600000);
    expect(() => registeredFixtureClaim(c, { ...r, approvalId: "b", decisionId: "decision-b", sourceScope: "source-b" })).toThrow("CAMPAIGN_EXECUTION_LOCKED");
    admin.prepare("UPDATE execution_claims SET claimed_at=?").run(Date.now() - 48 * 3600000);
    expect(registeredFixtureClaim(c, r).status).toBe("already_claimed");
    expect(registeredFixtureClaim(c, { ...r, approvalId: "b", decisionId: "decision-b", sourceScope: "source-b" }).status).toBe("claimed");
  } finally { admin.close(); c.close(); }
});

it.each(["daily", "run"])("OS processes reserve absolute delta under %s cap", async kind => {
  const f = fixture(); const c = coordinator(f.db); c.close();
  const r = request();
  r.limits = { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: kind === "daily" ? 15 : 100, maxAbsoluteBudgetDeltaPerRunMinor: 15 };
  const results = await Promise.all([child(f, r), child(f, { ...r, approvalId: "decrease", decisionId: "decision-decrease", sourceScope: "source-decrease", campaignId: "other", proposedBudgetMinor: 90, runId: kind === "daily" ? "other" : r.runId })]);
  expect(results.filter(x => x === "claimed")).toHaveLength(1);
  expect(results).toContain(kind === "daily" ? "DAILY_BUDGET_DELTA_LIMIT" : "RUN_BUDGET_DELTA_LIMIT");
});
it("binds all provenance and monetary identities on replay", () => {
  const f = fixture(), c = coordinator(f.db), r = request();
  try {
    registeredFixtureClaim(c, r);
    for (const patch of [{ decisionId: "other" }, { approvalSnapshotHash: "other" }, { sourceScope: "other" }, { sourceHash: "other" }, { policyIdentity: "other" }, { currency: "EUR" }, { beforeBudgetMinor: 99 }, { proposedBudgetMinor: 109 }, { limits: { ...r.limits, maxAbsoluteBudgetDeltaPerRunMinor: 50 } }]) {
      expect(() => c.reserveAndClaim({ ...r, ...patch })).toThrow("EXECUTION_IDENTITY_CONFLICT");
    }
  } finally { c.close(); }
});
it("requires explicit safe monetary units and limits", () => {
  const f = fixture(), c = coordinator(f.db), r = request();
  try {
    for (const patch of [{ currency: "usd" }, { currency: "XYZ" }, { budgetKind: "shared_budget" }, ...[0, -1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1].flatMap(n => [{ beforeBudgetMinor: n }, { proposedBudgetMinor: n }]), ...[undefined, NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1].map(n => ({ limits: { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: n } }))]) {
      expect(() => c.reserveAndClaim({ ...r, ...patch } as CoordinationRequest)).toThrow("INVALID_EXECUTION_COORDINATION");
    }
  } finally { c.close(); }
});
it("currency ledgers stay separate and exact integer totals do not overflow", () => {
  const f = fixture(), c = coordinator(f.db), r = request();
  const cap = Number.MAX_SAFE_INTEGER;
  r.beforeBudgetMinor = 1; r.proposedBudgetMinor = cap;
  r.limits = { ...r.limits, maxAbsoluteBudgetDeltaPerDayMinor: cap, maxAbsoluteBudgetDeltaPerRunMinor: cap };
  try {
    registeredFixtureClaim(c, r);
    expect(registeredFixtureClaim(c, { ...r, approvalId: "eur", decisionId: "decision-eur", sourceScope: "source-eur", campaignId: "eur", currency: "EUR" }).status).toBe("claimed");
    expect(() => registeredFixtureClaim(c, { ...r, approvalId: "overflow", decisionId: "decision-overflow", sourceScope: "source-overflow", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
  } finally { c.close(); }
});
it("budget insert rollback leaves neither claim nor quota", () => {
  const f = fixture(), c = coordinator(f.db), db = new DatabaseSync(f.db), r = request();
  try {
    db.exec("CREATE TRIGGER fail_budget BEFORE INSERT ON execution_budget_reservations BEGIN SELECT RAISE(ABORT, 'private'); END");
    expect(() => registeredFixtureClaim(c, r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
    db.exec("DROP TRIGGER fail_budget");
    expect(registeredFixtureClaim(c, r).status).toBe("claimed");
  } finally { db.close(); c.close(); }
});
it("uncertain outcomes persist across restart without releasing claim or quota", () => {
  const f = fixture(), r = request(); r.limits.maxAbsoluteBudgetDeltaPerDayMinor = 10; r.limits.maxAbsoluteBudgetDeltaPerRunMinor = 10;
  let c = coordinator(f.db);
  registeredFixtureClaim(c, r);
  expect(c.reconciliationStatus(r.approvalId)).toBe("needs_reconciliation");
  expect(c.recordOutcome({ eventId: "timeout", approvalId: r.approvalId, kind: "timeout" })).toBe("recorded");
  c.close(); c = coordinator(f.db);
  try {
    expect(c.reconciliationStatus(r.approvalId)).toBe("needs_reconciliation");
    expect(c.recordOutcome({ eventId: "timeout", approvalId: r.approvalId, kind: "timeout" })).toBe("already_recorded");
    expect(registeredFixtureClaim(c, r).status).toBe("already_claimed");
    expect(() => registeredFixtureClaim(c, { ...r, approvalId: "new", decisionId: "decision-new", sourceScope: "source-new", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
    expect(() => c.recordOutcome({ eventId: "equality", approvalId: r.approvalId, kind: "provider_confirmed" })).toThrow("INVALID_EXECUTION_OUTCOME");
    c.recordOutcome({ eventId: "receipt", approvalId: r.approvalId, kind: "provider_confirmed", providerReceiptId: "trusted-receipt" });
    expect(c.reconciliationStatus(r.approvalId)).toBe("provider_confirmed");
    expect(() => registeredFixtureClaim(c, { ...r, approvalId: "new", decisionId: "decision-new", sourceScope: "source-new", campaignId: "other" })).toThrow("DAILY_BUDGET_DELTA_LIMIT");
    const db = new DatabaseSync(f.db);
    expect(() => db.exec("DELETE FROM execution_outcomes")).toThrow();
    expect(() => db.exec("UPDATE execution_outcomes SET kind='unknown'")).toThrow();
    expect(db.prepare("SELECT count(*) n FROM execution_outcomes").get()?.n).toBe(2);
    db.close();
  } finally { c.close(); }
});
it("concurrent OS outcome writers cannot overwrite or disagree on final receipt", async () => {
  const f = fixture(), c = coordinator(f.db), r = request(); registeredFixtureClaim(c, r); c.close();
  const outcomeChild = (receipt: string) => new Promise<string>((resolve, reject) => {
    const code = `import {ExecutionCoordinator} from ${JSON.stringify(f.module)}; const c=new ExecutionCoordinator(${JSON.stringify(f.db)}); try {console.log(c.recordOutcome({eventId:"event",approvalId:"a",kind:"provider_confirmed",providerReceiptId:${JSON.stringify(receipt)}}))} catch(e) {console.log(e.message)} finally {c.close()}`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "ignore"] });
    let output = ""; p.stdout.on("data", b => output += b); p.on("error", reject); p.on("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error("child failed")));
  });
  expect((await Promise.all([outcomeChild("one"), outcomeChild("two")])).sort()).toEqual(["recorded", "EXECUTION_OUTCOME_CONFLICT"].sort());
});

it("requires registered authority; rejected identity and quota leave authorization approved", () => {
  const f = fixture(), c = coordinator(f.db), r = request();
  const db = new DatabaseSync(f.db);
  try {
    expect(() => c.reserveAndClaim(r)).toThrow("AUTHORIZATION_REQUIRED");
    authorize(c, r);
    expect(() => c.reserveAndClaim({ ...r, proposedBudgetMinor: 120 })).toThrow("EXECUTION_IDENTITY_CONFLICT");
    const denied = request({ approvalId: "zero", decisionId: "zero", sourceScope: "zero", limits: { ...r.limits, maxMutationsPerDay: 0, maxMutationsPerRun: 0 } });
    authorize(c, denied);
    expect(() => c.reserveAndClaim(denied)).toThrow("DAILY_MUTATION_LIMIT");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM execution_budget_reservations").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM decision_authorizations WHERE status='approved'").get()?.n).toBe(2);
    expect(c.reserveAndClaim(r).status).toBe("claimed");
  } finally { db.close(); c.close(); }
});

it.each(["policy", "source", "source_expiry", "approval_expiry", "revocation"])("transactionally rejects %s invalidation without consuming authority", kind => {
  const f = fixture(), c = coordinator(f.db), r = request();
  const db = new DatabaseSync(f.db);
  try {
    c.registerCurrentPolicy(r.company, r.policyIdentity);
    c.registerSource(r, new Date(Date.now() + 1000).toISOString());
    c.registerAuthorization(r, "approver");
    if (kind === "policy") c.registerCurrentPolicy(r.company, "revision-2");
    if (kind === "source") c.invalidateSource(r.sourceScope);
    if (kind === "revocation") c.revokeAuthorization(r.approvalId);
    if (kind === "source_expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    if (kind === "approval_expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200000);
    expect(() => c.reserveAndClaim(r)).toThrow(kind === "policy" ? "POLICY_REVISION_STALE" : kind === "source" || kind === "source_expiry" ? "SOURCE_NOT_CURRENT" : kind === "approval_expiry" ? "INVALID_EXECUTION_COORDINATION" : "AUTHORIZATION_NOT_APPROVED");
    expect(db.prepare("SELECT status FROM decision_authorizations").get()?.status).toBe(kind === "revocation" ? "revoked" : "approved");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM execution_budget_reservations").get()?.n).toBe(0);
  } finally { vi.restoreAllMocks(); db.close(); c.close(); }
});

it("immutable registration rejects approval/decision replay and cannot restore terminal state", () => {
  const f = fixture(), c = coordinator(f.db), r = request(), db = new DatabaseSync(f.db);
  try {
    authorize(c, r);
    expect(c.registerAuthorization(r, "trusted-approver")).toBe("already_registered");
    expect(() => c.registerAuthorization({ ...r, proposedBudgetMinor: 120 }, "trusted-approver")).toThrow("AUTHORITY_IDENTITY_CONFLICT");
    expect(() => c.registerAuthorization({ ...r, approvalId: "other" }, "trusted-approver")).toThrow("AUTHORITY_IDENTITY_CONFLICT");
    expect(() => c.registerAuthorization(r, "other-approver")).toThrow("AUTHORITY_IDENTITY_CONFLICT");
    expect(() => c.registerSource({ ...r, sourceHash: "different" }, r.expiresAt)).toThrow("AUTHORITY_IDENTITY_CONFLICT");
    c.revokeAuthorization(r.approvalId);
    expect(c.registerAuthorization(r, "trusted-approver")).toBe("already_registered");
    expect(() => c.reserveAndClaim(r)).toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(() => db.exec("UPDATE decision_authorizations SET status='approved'")).toThrow();
    expect(() => db.exec("UPDATE decision_authorizations SET identity='changed'")).toThrow();
    expect(() => db.exec("DELETE FROM decision_authorizations")).toThrow();
    c.registerCurrentPolicy(r.company, "revision-2");
    expect(() => c.registerCurrentPolicy(r.company, r.policyIdentity)).toThrow("POLICY_REVISION_STALE");
  } finally { db.close(); c.close(); }
});

it("failed authorization and reservation inserts roll back registration and consumption", () => {
  const f = fixture(), c = coordinator(f.db), r = request(), db = new DatabaseSync(f.db);
  try {
    c.registerCurrentPolicy(r.company, r.policyIdentity); c.registerSource(r, r.expiresAt);
    db.exec("CREATE TRIGGER fail_auth BEFORE INSERT ON decision_authorizations BEGIN SELECT RAISE(ABORT,'private'); END");
    expect(() => c.registerAuthorization(r, "approver")).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
    expect(db.prepare("SELECT count(*) n FROM decision_authorizations").get()?.n).toBe(0);
    db.exec("DROP TRIGGER fail_auth"); c.registerAuthorization(r, "approver");
    db.exec("CREATE TRIGGER fail_reservation BEFORE INSERT ON execution_budget_reservations BEGIN SELECT RAISE(ABORT,'private'); END");
    expect(() => c.reserveAndClaim(r)).toThrow("EXECUTION_COORDINATOR_UNAVAILABLE");
    expect(db.prepare("SELECT status FROM decision_authorizations").get()?.status).toBe("approved");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(0);
    db.exec("DROP TRIGGER fail_reservation");
    expect(c.reserveAndClaim(r).status).toBe("claimed");
    expect(() => c.revokeAuthorization(r.approvalId)).toThrow("AUTHORIZATION_NOT_REVOCABLE");
  } finally { db.close(); c.close(); }
});

it("actual competing OS processes serialize revoke versus claim with exactly one winner", async () => {
  for (let i = 0; i < 8; i++) {
    const f = fixture(), c = coordinator(f.db), r = request(); authorize(c, r); c.close();
    const run = (operation: string) => new Promise<string>((resolve, reject) => {
      const code = `import {ExecutionCoordinator} from ${JSON.stringify(f.module)}; const c=new ExecutionCoordinator(${JSON.stringify(f.db)}); try {console.log(${operation})} catch(e) {console.log(e.message)} finally {c.close()}`;
      const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "ignore"] });
      let output = ""; p.stdout.on("data", b => output += b); p.on("error", reject); p.on("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error("race child failed")));
    });
    const results = await Promise.all([run(`c.reserveAndClaim(${JSON.stringify(r)}).status`), run('c.revokeAuthorization("a")')]);
    expect([["claimed", "AUTHORIZATION_NOT_REVOCABLE"], ["AUTHORIZATION_NOT_APPROVED", "revoked"]]).toContainEqual(results);
    const db = new DatabaseSync(f.db);
    const consumed = results[0] === "claimed";
    expect(db.prepare("SELECT status FROM decision_authorizations").get()?.status).toBe(consumed ? "consumed" : "revoked");
    expect(db.prepare("SELECT count(*) n FROM execution_claims").get()?.n).toBe(consumed ? 1 : 0);
    expect(db.prepare("SELECT count(*) n FROM execution_budget_reservations").get()?.n).toBe(consumed ? 1 : 0);
    db.close();
  }
});
