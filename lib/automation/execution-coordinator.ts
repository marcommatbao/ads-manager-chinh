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
const codes = new Set(["EXECUTION_IDENTITY_CONFLICT", "EXECUTION_CLOCK_INVALID", "CAMPAIGN_EXECUTION_LOCKED", "DAILY_MUTATION_LIMIT", "RUN_MUTATION_LIMIT", "DAILY_BUDGET_DELTA_LIMIT", "RUN_BUDGET_DELTA_LIMIT", "EXECUTION_OUTCOME_CONFLICT", "EXECUTION_CLAIM_REQUIRED"]);
function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
}
function instant(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === value ? n : NaN;
}

/** Internal server-only foundation. No authorization, approval import or provider execution. */
export class ExecutionCoordinator {
  private db!: DatabaseSync;
  constructor(databasePath = path.join(process.cwd(), "data", "automation-execution.sqlite")) {
    try {
      if (!path.isAbsolute(databasePath) || databasePath === ":memory:") throw unavailable();
      mkdirSync(path.dirname(databasePath), { recursive: true });
      this.db = new DatabaseSync(databasePath);
      this.db.exec(`PRAGMA busy_timeout=1500; PRAGMA synchronous=FULL;
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

  /** Reservation and permanent uncertain claim are the SAME atomic row. Replay never authorizes retry. */
  reserveAndClaim(request: CoordinationRequest): CoordinationResult {
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
    let transaction = false;
    try {
      this.db.exec("BEGIN IMMEDIATE"); transaction = true;
      if (this.db.prepare("SELECT 1 FROM execution_claims WHERE claimed_at > ? LIMIT 1").get(now)) throw new Error("EXECUTION_CLOCK_INVALID");
      const previous = this.db.prepare("SELECT identity FROM execution_claims WHERE approval_id = ?").get(request.approvalId);
      if (previous) {
        if (previous.identity !== identity) throw new Error("EXECUTION_IDENTITY_CONFLICT");
        this.db.exec("COMMIT"); transaction = false;
        return { status: "already_claimed", approvalId: request.approvalId };
      }
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
