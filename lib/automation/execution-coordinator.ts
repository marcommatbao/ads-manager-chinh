import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface CoordinationRequest {
  approvalId: string;
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
  limits: { maxMutationsPerDay: number; maxMutationsPerRun: number; cooldownHours: number };
}
export type CoordinationResult = { status: "claimed" | "already_claimed"; approvalId: string };
const unavailable = () => new Error("EXECUTION_COORDINATOR_UNAVAILABLE");
const codes = new Set(["EXECUTION_IDENTITY_CONFLICT", "EXECUTION_CLOCK_INVALID", "CAMPAIGN_EXECUTION_LOCKED", "DAILY_MUTATION_LIMIT", "RUN_MUTATION_LIMIT"]);
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
        ) STRICT;`);
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
      if (![r.approvalId, r.company, r.accountId, r.campaignId, r.runId, r.sourceScope, r.sourceHash, r.policyIdentity].every(validText) || !["google", "meta"].includes(r.provider)) throw 0;
      const l = r.limits;
      if (!l || !Number.isSafeInteger(l.maxMutationsPerDay) || l.maxMutationsPerDay < 0 || l.maxMutationsPerDay > 10000 || !Number.isSafeInteger(l.maxMutationsPerRun) || l.maxMutationsPerRun < 0 || l.maxMutationsPerRun > 1000 || l.maxMutationsPerRun > l.maxMutationsPerDay || !Number.isFinite(l.cooldownHours) || l.cooldownHours < 0 || l.cooldownHours > 8760) throw 0;
      const readAt = instant(r.sourceReadAt), expires = instant(r.expiresAt);
      if (!Number.isFinite(readAt) || !Number.isFinite(expires) || readAt > now || expires <= now || readAt >= expires) throw 0;
      // Explicit projection: never persist extra properties/raw source payloads.
      identity = JSON.stringify([r.company, r.provider, r.accountId, r.campaignId, r.runId, r.sourceScope, r.sourceHash, r.sourceReadAt, r.expiresAt, r.policyIdentity, l.maxMutationsPerDay, l.maxMutationsPerRun, l.cooldownHours]);
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
      this.db.prepare("INSERT INTO execution_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(request.approvalId, identity, request.company, request.provider, request.accountId, request.campaignId, request.runId, day, now);
      this.db.exec("COMMIT"); transaction = false;
      return { status: "claimed", approvalId: request.approvalId };
    } catch (error) {
      if (transaction) { try { this.db.exec("ROLLBACK"); } catch { /* fail closed */ } }
      if (error instanceof Error && codes.has(error.message)) throw new Error(error.message);
      throw unavailable();
    }
  }
  close(): void { this.db.close(); }
}
