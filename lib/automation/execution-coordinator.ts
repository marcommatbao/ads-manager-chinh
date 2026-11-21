import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface CoordinationRequest {
  approvalId: string;
  decisionId: string;
  approvalSnapshotHash: string;
  currency: string;
  budgetKind: "campaign_daily_budget";
  beforeBudgetMinor: number;
  proposedBudgetMinor: number;
  company: string;
  provider: "google" | "meta";
  accountId: string;
  campaignId: string;
  runId: string;
  sourceScope: string;
  sourceHash: string;
  sourceReadAt: string;
  expiresAt: string;
  policyIdentity: string;
  limits: { maxMutationsPerDay: number; maxMutationsPerRun: number; cooldownHours: number; maxAbsoluteBudgetDeltaPerDayMinor: number; maxAbsoluteBudgetDeltaPerRunMinor: number };
}
export type CoordinationResult = { status: "claimed" | "already_claimed"; approvalId: string };
const unavailable = () => new Error("EXECUTION_COORDINATOR_UNAVAILABLE");
const codes = new Set(["AUTHORIZATION_REQUIRED", "AUTHORIZATION_NOT_APPROVED", "AUTHORITY_IDENTITY_CONFLICT", "POLICY_REVISION_STALE", "SOURCE_NOT_CURRENT", "AUTHORIZATION_NOT_REVOCABLE","EXECUTION_IDENTITY_CONFLICT", "EXECUTION_CLOCK_INVALID", "CAMPAIGN_EXECUTION_LOCKED", "DAILY_MUTATION_LIMIT", "RUN_MUTATION_LIMIT", "DAILY_BUDGET_DELTA_LIMIT", "RUN_BUDGET_DELTA_LIMIT", "EXECUTION_OUTCOME_CONFLICT", "EXECUTION_CLAIM_REQUIRED"]);
function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
}
function instant(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === value ? n : NaN;
}

/** Trusted server-only authority. Never register request bodies or import JSON approvals. */
export class ExecutionCoordinator {
  private db!: DatabaseSync;
  constructor(databasePath = path.join(process.cwd(), "data", "automation-execution.sqlite")) {
    try {
      if (!path.isAbsolute(databasePath) || databasePath === ":memory:") throw unavailable();
      mkdirSync(path.dirname(databasePath), { recursive: true });
      this.db = new DatabaseSync(databasePath);
      this.db.exec(`PRAGMA busy_timeout=1500; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS authority_policies (
          company TEXT PRIMARY KEY, revision TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS authority_policy_history (
          company TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(company, revision)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS authority_sources (
          scope TEXT PRIMARY KEY, identity TEXT NOT NULL, expires_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('current','invalidated'))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS decision_authorizations (
          approval_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE,
          identity TEXT NOT NULL, approver_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('approved','revoked','consumed')),
          changed_at INTEGER NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS immutable_authorization BEFORE UPDATE OF approval_id,decision_id,identity,approver_id,expires_at ON decision_authorizations BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS retain_authorization BEFORE DELETE ON decision_authorizations BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS terminal_authorization BEFORE UPDATE OF status ON decision_authorizations WHEN OLD.status != 'approved' OR NEW.status NOT IN ('revoked','consumed') BEGIN SELECT RAISE(ABORT, 'terminal'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_source BEFORE UPDATE OF scope,identity,expires_at ON authority_sources BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS terminal_source BEFORE UPDATE OF status ON authority_sources WHEN NEW.status != 'invalidated' BEGIN SELECT RAISE(ABORT, 'terminal'); END;
        CREATE TRIGGER IF NOT EXISTS retain_source BEFORE DELETE ON authority_sources BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        CREATE TABLE IF NOT EXISTS execution_claims (
          approval_id TEXT PRIMARY KEY, identity TEXT NOT NULL,
          company TEXT NOT NULL, provider TEXT NOT NULL, account_id TEXT NOT NULL,
          campaign_id TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL,
          claimed_at INTEGER NOT NULL CHECK(claimed_at >= 0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS execution_budget_reservations (
          approval_id TEXT PRIMARY KEY REFERENCES execution_claims(approval_id),
          currency TEXT NOT NULL, delta_minor INTEGER NOT NULL CHECK(delta_minor >= 0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS execution_outcomes (
          event_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES execution_claims(approval_id),
          identity TEXT NOT NULL, kind TEXT NOT NULL, recorded_at INTEGER NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_outcome ON execution_outcomes(approval_id) WHERE kind='provider_confirmed';
        CREATE TRIGGER IF NOT EXISTS immutable_outcome_update BEFORE UPDATE ON execution_outcomes BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_outcome_delete BEFORE DELETE ON execution_outcomes BEGIN SELECT RAISE(ABORT, 'immutable'); END;
        PRAGMA foreign_keys=ON;`);
      const check = this.db.prepare("PRAGMA quick_check").get();
      if (!check || Object.values(check)[0] !== "ok") throw unavailable();
    } catch {
      try { this.db?.close(); } catch { /* sanitize initialization failures */ }
      throw unavailable();
    }
  }

  private canonical(request: CoordinationRequest): string {
    const now = Date.now();
    let identity: string;
    try {
      const r = request;
      if (![r.approvalId, r.decisionId, r.approvalSnapshotHash, r.company, r.accountId, r.campaignId, r.runId, r.sourceScope, r.sourceHash, r.policyIdentity].every(validText) || !["google", "meta"].includes(r.provider)) throw 0;
      if (!new Set(Intl.supportedValuesOf("currency")).has(r.currency) || r.budgetKind !== "campaign_daily_budget" ||
        ![r.beforeBudgetMinor, r.proposedBudgetMinor].every(n => Number.isSafeInteger(n) && n > 0)) throw 0;
      const l = r.limits;
      if (!l || ![l.maxAbsoluteBudgetDeltaPerDayMinor, l.maxAbsoluteBudgetDeltaPerRunMinor].every(n => Number.isSafeInteger(n) && n >= 0) ||
        l.maxAbsoluteBudgetDeltaPerRunMinor > l.maxAbsoluteBudgetDeltaPerDayMinor) throw 0;
      if (!l || !Number.isSafeInteger(l.maxMutationsPerDay) || l.maxMutationsPerDay < 0 || l.maxMutationsPerDay > 10000 || !Number.isSafeInteger(l.maxMutationsPerRun) || l.maxMutationsPerRun < 0 || l.maxMutationsPerRun > 1000 || l.maxMutationsPerRun > l.maxMutationsPerDay || !Number.isFinite(l.cooldownHours) || l.cooldownHours < 0 || l.cooldownHours > 8760) throw 0;
      const readAt = instant(r.sourceReadAt), expires = instant(r.expiresAt);
      if (!Number.isFinite(readAt) || !Number.isFinite(expires) || readAt > now || expires <= now || readAt >= expires) throw 0;
      // Explicit projection: never persist extra properties/raw source payloads.
      identity = JSON.stringify([r.decisionId, r.approvalSnapshotHash, r.currency, r.budgetKind, r.beforeBudgetMinor, r.proposedBudgetMinor, l.maxAbsoluteBudgetDeltaPerDayMinor, l.maxAbsoluteBudgetDeltaPerRunMinor, r.company, r.provider, r.accountId, r.campaignId, r.runId, r.sourceScope, r.sourceHash, r.sourceReadAt, r.expiresAt, r.policyIdentity, l.maxMutationsPerDay, l.maxMutationsPerRun, l.cooldownHours]);
    } catch { throw new Error("INVALID_EXECUTION_COORDINATION"); }
    return identity;
  }

  private atomic<T>(operation: () => T): T {
    let begun = false;
    try {
      this.db.exec("BEGIN IMMEDIATE"); begun = true;
      const result = operation();
      this.db.exec("COMMIT"); begun = false;
      return result;
    } catch (error) {
      if (begun) { try { this.db.exec("ROLLBACK"); } catch { /* fail closed */ } }
      if (error instanceof Error && codes.has(error.message)) throw new Error(error.message);
      throw unavailable();
    }
  }

  /** Internal trusted ingestion only. A superseded revision cannot be reactivated. */
  registerCurrentPolicy(company: string, revision: string): void {
    if (![company, revision].every(validText)) throw new Error("INVALID_EXECUTION_COORDINATION");
    this.atomic(() => {
      const current = this.db.prepare("SELECT revision FROM authority_policies WHERE company=?").get(company);
      if (current?.revision === revision) return;
      if (this.db.prepare("SELECT 1 FROM authority_policy_history WHERE company=? AND revision=?").get(company, revision)) throw new Error("POLICY_REVISION_STALE");
      this.db.prepare("INSERT INTO authority_policy_history VALUES (?,?)").run(company, revision);
      this.db.prepare("INSERT INTO authority_policies VALUES (?,?) ON CONFLICT(company) DO UPDATE SET revision=excluded.revision").run(company, revision);
    });
  }

  private sourceIdentity(r: CoordinationRequest): string {
    return JSON.stringify([r.company, r.provider, r.accountId, r.campaignId, r.policyIdentity, r.sourceHash, r.sourceReadAt]);
  }

  /** Collector-owned immutable binding and independent freshness deadline; no verified flag. */
  registerSource(request: CoordinationRequest, sourceExpiresAt: string): void {
    this.canonical(request);
    const expiry = instant(sourceExpiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry <= instant(request.sourceReadAt)) throw new Error("INVALID_EXECUTION_COORDINATION");
    this.atomic(() => {
      const identity = this.sourceIdentity(request);
      const row = this.db.prepare("SELECT * FROM authority_sources WHERE scope=?").get(request.sourceScope);
      if (row) {
        if (row.identity !== identity || row.expires_at !== expiry) throw new Error("AUTHORITY_IDENTITY_CONFLICT");
        if (row.status !== "current") throw new Error("SOURCE_NOT_CURRENT");
        return;
      }
      this.db.prepare("INSERT INTO authority_sources VALUES (?,?,?,'current')").run(request.sourceScope, identity, expiry);
    });
  }

  invalidateSource(scope: string): void {
    if (!validText(scope)) throw new Error("INVALID_EXECUTION_COORDINATION");
    this.atomic(() => {
      if (!this.db.prepare("SELECT 1 FROM authority_sources WHERE scope=?").get(scope)) throw new Error("SOURCE_NOT_CURRENT");
      this.db.prepare("UPDATE authority_sources SET status='invalidated' WHERE scope=?").run(scope);
    });
  }

  private checkCurrent(r: CoordinationRequest, now: number): void {
    if (this.db.prepare("SELECT revision FROM authority_policies WHERE company=?").get(r.company)?.revision !== r.policyIdentity) throw new Error("POLICY_REVISION_STALE");
    const source = this.db.prepare("SELECT * FROM authority_sources WHERE scope=?").get(r.sourceScope);
    if (!source || source.status !== "current" || source.identity !== this.sourceIdentity(r) || Number(source.expires_at) <= now) throw new Error("SOURCE_NOT_CURRENT");
  }

  /** Trusted approval service must establish approver rights and decision provenance first. */
  registerAuthorization(request: CoordinationRequest, approverId: string): "registered" | "already_registered" {
    const identity = this.canonical(request);
    if (!validText(approverId)) throw new Error("INVALID_EXECUTION_COORDINATION");
    return this.atomic(() => {
      const now = Date.now();
      this.checkCurrent(request, now);
      const row = this.db.prepare("SELECT * FROM decision_authorizations WHERE approval_id=? OR decision_id=?").get(request.approvalId, request.decisionId);
      if (row) {
        if (row.approval_id !== request.approvalId || row.identity !== identity || row.approver_id !== approverId) throw new Error("AUTHORITY_IDENTITY_CONFLICT");
        return "already_registered";
      }
      if (instant(request.expiresAt) <= now) throw new Error("AUTHORIZATION_NOT_APPROVED");
      this.db.prepare("INSERT INTO decision_authorizations VALUES (?,?,?,?,?,'approved',?)").run(request.approvalId, request.decisionId, identity, approverId, instant(request.expiresAt), now);
      return "registered";
    });
  }

  revokeAuthorization(approvalId: string): "revoked" {
    if (!validText(approvalId)) throw new Error("INVALID_EXECUTION_COORDINATION");
    return this.atomic(() => {
      const now = Date.now();
      const result = this.db.prepare("UPDATE decision_authorizations SET status='revoked',changed_at=? WHERE approval_id=? AND status='approved' AND expires_at>?").run(now, approvalId, now);
      if (result.changes !== 1) throw new Error("AUTHORIZATION_NOT_REVOCABLE");
      return "revoked";
    });
  }

  /** Authorization consumption, reservation and permanent claim share one transaction. */
  reserveAndClaim(request: CoordinationRequest): CoordinationResult {
    const identity = this.canonical(request);
    let now: number;
    let transaction = false;
    try {
      this.db.exec("BEGIN IMMEDIATE"); transaction = true;
      now = Date.now();
      if (instant(request.expiresAt) <= now) throw new Error("AUTHORIZATION_NOT_APPROVED");
      if (this.db.prepare("SELECT 1 FROM execution_claims WHERE claimed_at > ? LIMIT 1").get(now)) throw new Error("EXECUTION_CLOCK_INVALID");
      const authorization = this.db.prepare("SELECT * FROM decision_authorizations WHERE approval_id=?").get(request.approvalId);
      const previous = this.db.prepare("SELECT identity FROM execution_claims WHERE approval_id = ?").get(request.approvalId);
      if (previous) {
        if (previous.identity !== identity) throw new Error("EXECUTION_IDENTITY_CONFLICT");
        if (!authorization) throw new Error("AUTHORIZATION_REQUIRED");
        if (authorization.identity !== identity || authorization.status !== "consumed") throw new Error("AUTHORIZATION_NOT_APPROVED");
        this.checkCurrent(request, now);
        this.db.exec("COMMIT"); transaction = false;
        return { status: "already_claimed", approvalId: request.approvalId };
      }
      if (!authorization) throw new Error("AUTHORIZATION_REQUIRED");
      if (authorization.identity !== identity) throw new Error("EXECUTION_IDENTITY_CONFLICT");
      if (authorization.status !== "approved" || Number(authorization.expires_at) <= now) throw new Error("AUTHORIZATION_NOT_APPROVED");
      this.checkCurrent(request, now);
      this.db.prepare("UPDATE decision_authorizations SET status='consumed',changed_at=? WHERE approval_id=?").run(now, request.approvalId);
      const day = new Date(now).toISOString().slice(0, 10);
      if (this.db.prepare(`SELECT 1 FROM execution_claims WHERE company=? AND provider=? AND account_id=? AND campaign_id=? AND (day=? OR claimed_at > ?) LIMIT 1`).get(request.company, request.provider, request.accountId, request.campaignId, day, now - request.limits.cooldownHours * 3600000)) throw new Error("CAMPAIGN_EXECUTION_LOCKED");
      const daily = this.db.prepare("SELECT count(*) AS n FROM execution_claims WHERE company=? AND day=?").get(request.company, day)!;
      if (Number(daily.n) >= request.limits.maxMutationsPerDay) throw new Error("DAILY_MUTATION_LIMIT");
      const run = this.db.prepare("SELECT count(*) AS n FROM execution_claims WHERE company=? AND run_id=? AND day=?").get(request.company, request.runId, day)!;
      if (Number(run.n) >= request.limits.maxMutationsPerRun) throw new Error("RUN_MUTATION_LIMIT");
      // Unknown legacy reservations cannot be treated as zero budget usage.
      if (this.db.prepare("SELECT 1 FROM execution_claims c LEFT JOIN execution_budget_reservations b USING(approval_id) WHERE c.company=? AND c.day=? AND b.approval_id IS NULL LIMIT 1").get(request.company, day)) throw unavailable();
      const delta = Math.abs(request.proposedBudgetMinor - request.beforeBudgetMinor);
      const reservations = this.db.prepare("SELECT c.run_id, b.delta_minor FROM execution_claims c JOIN execution_budget_reservations b USING(approval_id) WHERE c.company=? AND c.day=? AND b.currency=?").all(request.company, day, request.currency);
      let dailyDelta = BigInt(0), runDelta = BigInt(0);
      for (const row of reservations) {
        dailyDelta += BigInt(row.delta_minor as number);
        if (row.run_id === request.runId) runDelta += BigInt(row.delta_minor as number);
      }
      if (dailyDelta + BigInt(delta) > BigInt(request.limits.maxAbsoluteBudgetDeltaPerDayMinor)) throw new Error("DAILY_BUDGET_DELTA_LIMIT");
      if (runDelta + BigInt(delta) > BigInt(request.limits.maxAbsoluteBudgetDeltaPerRunMinor)) throw new Error("RUN_BUDGET_DELTA_LIMIT");
      this.db.prepare("INSERT INTO execution_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(request.approvalId, identity, request.company, request.provider, request.accountId, request.campaignId, request.runId, day, now);
      this.db.prepare("INSERT INTO execution_budget_reservations VALUES (?, ?, ?)").run(request.approvalId, request.currency, delta);
      this.db.exec("COMMIT"); transaction = false;
      return { status: "claimed", approvalId: request.approvalId };
    } catch (error) {
      if (transaction) { try { this.db.exec("ROLLBACK"); } catch { /* fail closed */ } }
      if (error instanceof Error && codes.has(error.message)) throw new Error(error.message);
      throw unavailable();
    }
  }
  /**
   * Trusted bookkeeping only: receipt verification belongs to future authorization.
   * Budget equality is never accepted as execution evidence. No outcome frees quota.
   */
  recordOutcome(input: { eventId: string; approvalId: string; kind: "unknown" | "timeout" | "provider_confirmed"; providerReceiptId?: string }): "recorded" | "already_recorded" {
    if (!input || ![input.eventId, input.approvalId].every(validText) ||
      !["unknown", "timeout", "provider_confirmed"].includes(input.kind) ||
      (input.kind === "provider_confirmed" ? !validText(input.providerReceiptId) : input.providerReceiptId !== undefined)) throw new Error("INVALID_EXECUTION_OUTCOME");
    const identity = JSON.stringify([input.approvalId, input.kind, input.providerReceiptId ?? null]);
    let transaction = false;
    try {
      this.db.exec("BEGIN IMMEDIATE"); transaction = true;
      if (!this.db.prepare("SELECT 1 FROM execution_claims WHERE approval_id=?").get(input.approvalId)) throw new Error("EXECUTION_CLAIM_REQUIRED");
      const existing = this.db.prepare("SELECT identity FROM execution_outcomes WHERE event_id=?").get(input.eventId);
      if (existing) {
        if (existing.identity !== identity) throw new Error("EXECUTION_OUTCOME_CONFLICT");
        this.db.exec("COMMIT"); transaction = false;
        return "already_recorded";
      }
      if (this.db.prepare("SELECT 1 FROM execution_outcomes WHERE approval_id=? AND kind='provider_confirmed'").get(input.approvalId)) throw new Error("EXECUTION_OUTCOME_CONFLICT");
      this.db.prepare("INSERT INTO execution_outcomes VALUES (?, ?, ?, ?, ?)").run(input.eventId, input.approvalId, identity, input.kind, Date.now());
      this.db.exec("COMMIT"); transaction = false;
      return "recorded";
    } catch (error) {
      if (transaction) { try { this.db.exec("ROLLBACK"); } catch { /* fail closed */ } }
      if (error instanceof Error && codes.has(error.message)) throw new Error(error.message);
      throw unavailable();
    }
  }

  reconciliationStatus(approvalId: string): "needs_reconciliation" | "provider_confirmed" {
    if (!validText(approvalId)) throw new Error("INVALID_EXECUTION_OUTCOME");
    try {
      if (!this.db.prepare("SELECT 1 FROM execution_claims WHERE approval_id=?").get(approvalId)) throw new Error("EXECUTION_CLAIM_REQUIRED");
      return this.db.prepare("SELECT 1 FROM execution_outcomes WHERE approval_id=? AND kind='provider_confirmed'").get(approvalId) ? "provider_confirmed" : "needs_reconciliation";
    } catch (error) {
      if (error instanceof Error && codes.has(error.message)) throw error;
      throw unavailable();
    }
  }
  close(): void { this.db.close(); }
}
