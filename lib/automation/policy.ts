import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

export interface AbsoluteBudgetDeltaCaps {
  maxAbsoluteBudgetDeltaPerDayMinor: number;
  maxAbsoluteBudgetDeltaPerRunMinor: number;
}

export interface AutomationPolicy {
  version: string;
  status: "draft" | "approved";
  owner: string | null;
  globalEnabled: boolean;
  applyEnabled: boolean;
  minObservedDays: number;
  minAttributionCoverage: number;
  maxIncreasePct: number;
  maxDecreasePct: number;
  minBudget: number;
  maxBudget: number;
  cooldownHours: number;
  maxMutationsPerRun: number;
  maxMutationsPerDay: number;
  protectedCampaignIds: string[];
  absoluteBudgetDeltaCapsByCurrency: Record<string, AbsoluteBudgetDeltaCaps>;
}

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  version: "1.0",
  status: "draft",
  owner: null,
  globalEnabled: false,
  applyEnabled: false,
  minObservedDays: 7,
  minAttributionCoverage: 0.8,
  maxIncreasePct: 10,
  maxDecreasePct: 15,
  minBudget: 100_000,
  maxBudget: 100_000_000,
  cooldownHours: 24,
  maxMutationsPerRun: 5,
  maxMutationsPerDay: 5,
  protectedCampaignIds: [],
  absoluteBudgetDeltaCapsByCurrency: {},
};

const POLICY_FILE = path.join(process.cwd(), "data", "automation-policy.json");

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

function plainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateDeltaCaps(value: unknown): Record<string, AbsoluteBudgetDeltaCaps> {
  if (!plainRecord(value)) throw new Error("Invalid currency delta caps");
  const result: Record<string, AbsoluteBudgetDeltaCaps> = {};
  for (const currency of Reflect.ownKeys(value)) {
    if (typeof currency !== "string" || !supportedCurrencies.has(currency)) throw new Error("Invalid cap currency");
    const cap = value[currency];
    const dayKey = "maxAbsoluteBudgetDeltaPerDayMinor", runKey = "maxAbsoluteBudgetDeltaPerRunMinor";
    if (!plainRecord(cap) || Reflect.ownKeys(cap).length !== 2 ||
      !Object.hasOwn(cap, dayKey) || !Object.hasOwn(cap, runKey)) throw new Error("Invalid currency cap fields");
    const day = cap[dayKey], run = cap[runKey];
    if (typeof day !== "number" || typeof run !== "number" ||
      !Number.isSafeInteger(day) || !Number.isSafeInteger(run) || day < 0 || run < 0 || run > day) throw new Error("Invalid minor-unit delta caps");
    result[currency] = { [dayKey]: day, [runKey]: run };
  }
  return result;
}

export function validateAutomationPolicy(value: unknown): AutomationPolicy {
  if (!plainRecord(value)) throw new Error("Policy must be an object");
  const raw = value as Record<string, unknown>;
  const absoluteBudgetDeltaCapsByCurrency = validateDeltaCaps(Object.hasOwn(raw, "absoluteBudgetDeltaCapsByCurrency") ? raw.absoluteBudgetDeltaCapsByCurrency : {});
  const bounds = {
    minObservedDays: [3, 365], minAttributionCoverage: [0, 1],
    maxIncreasePct: [0, 100], maxDecreasePct: [0, 100],
    minBudget: [0, 1e12], maxBudget: [0, 1e12], cooldownHours: [0, 8760],
    maxMutationsPerRun: [0, 1000], maxMutationsPerDay: [0, 10000],
  } as const;
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = raw[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid policy field: ${key}`);
  }
  for (const key of ["minObservedDays", "maxMutationsPerRun", "maxMutationsPerDay"]) {
    if (!Number.isInteger(raw[key])) throw new Error(`Integer required: ${key}`);
  }
  if ((raw.minBudget as number) > (raw.maxBudget as number)) throw new Error("Budget floor exceeds ceiling");
  if ((raw.maxMutationsPerRun as number) > (raw.maxMutationsPerDay as number)) throw new Error("Run limit exceeds daily limit");
  if (raw.status !== "draft" && raw.status !== "approved") throw new Error("Invalid policy status");
  if (typeof raw.version !== "string" || !raw.version.trim()) throw new Error("Policy version required");
  if (raw.owner !== null && (typeof raw.owner !== "string" || !raw.owner.trim())) throw new Error("Invalid owner");
  if (raw.status === "approved" && !raw.owner) throw new Error("Approved policy requires owner");
  if (typeof raw.globalEnabled !== "boolean" || typeof raw.applyEnabled !== "boolean") throw new Error("Boolean switches required");
  if (!Array.isArray(raw.protectedCampaignIds) || raw.protectedCampaignIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("Invalid protected campaigns");
  // Explicit projection prevents unrecognized settings from reaching consumers.
  return {
    absoluteBudgetDeltaCapsByCurrency,
    version: raw.version, status: raw.status, owner: raw.owner as string | null,
    globalEnabled: raw.globalEnabled && raw.status === "approved",
    applyEnabled: raw.applyEnabled && raw.globalEnabled && raw.status === "approved",
    minObservedDays: raw.minObservedDays as number,
    minAttributionCoverage: raw.minAttributionCoverage as number,
    maxIncreasePct: raw.maxIncreasePct as number, maxDecreasePct: raw.maxDecreasePct as number,
    minBudget: raw.minBudget as number, maxBudget: raw.maxBudget as number,
    cooldownHours: raw.cooldownHours as number,
    maxMutationsPerRun: raw.maxMutationsPerRun as number, maxMutationsPerDay: raw.maxMutationsPerDay as number,
    protectedCampaignIds: [...new Set(raw.protectedCampaignIds as string[])],
  };
}

export function readAutomationPolicy(): AutomationPolicy {
  try {
    return validateAutomationPolicy(JSON.parse(fs.readFileSync(POLICY_FILE, "utf8")));
  } catch {
    return { ...DEFAULT_AUTOMATION_POLICY, protectedCampaignIds: [], absoluteBudgetDeltaCapsByCurrency: {} };
  }
}

export function policyBlocksCampaign(policy: AutomationPolicy, campaignId: string): string | null {
  if (!policy.globalEnabled) return "automation_disabled";
  if (policy.protectedCampaignIds.includes(campaignId)) return "protected_campaign";
  return null;
}

export async function saveAutomationPolicyDraft(value: unknown, actorId: string, expectedVersion: string): Promise<AutomationPolicy> {
  return withFileLock(POLICY_FILE, async () => {
    const current = readAutomationPolicy();
    if (current.version !== expectedVersion) throw new Error("POLICY_CONFLICT");
    // Older editors omit this field. Preserve it under the same lock/revision check.
    // Explicit {} clears caps; explicit undefined/null is malformed, never omission.
    const candidate = validateAutomationPolicy(plainRecord(value) && !Object.hasOwn(value, "absoluteBudgetDeltaCapsByCurrency")
      ? { ...value, absoluteBudgetDeltaCapsByCurrency: current.absoluteBudgetDeltaCapsByCurrency }
      : value);
    const saved = validateAutomationPolicy({ ...candidate, status: "draft", globalEnabled: false, applyEnabled: false, owner: actorId, version: crypto.randomUUID() });
    const auditFile = path.join(process.cwd(), "data", "automation-policy-audit.json");
    let audit: unknown[] = [];
    try { audit = JSON.parse(fs.readFileSync(auditFile, "utf8")); if (!Array.isArray(audit)) throw new Error("audit"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("POLICY_AUDIT_UNAVAILABLE"); }
    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    // Persist intent before policy: an audit failure must not allow an unlogged change.
    writeFileAtomicSync(auditFile, JSON.stringify([...audit, { actorId, at: new Date().toISOString(), event: "draft_save_requested", before: current, after: saved }].slice(-2000), null, 2));
    writeFileAtomicSync(POLICY_FILE, JSON.stringify(saved, null, 2));
    return saved;
  });
}

/** Trusted server policy projection only. This is NOT atomic execution authorization.
 * Caller must obtain policy from trusted storage, never a request body. No I/O/claims.
 */
export function coordinatorLimitsFromPolicy(policy: AutomationPolicy, currency: string): import("./execution-coordinator").CoordinationRequest["limits"] {
  const validated = validateAutomationPolicy(policy);
  if (validated.status !== "approved" || !validated.owner || !validated.globalEnabled || !validated.applyEnabled ||
    !supportedCurrencies.has(currency) || !Object.hasOwn(validated.absoluteBudgetDeltaCapsByCurrency, currency)) {
    throw new Error("POLICY_COORDINATION_NOT_AUTHORIZED");
  }
  return {
    maxMutationsPerDay: validated.maxMutationsPerDay,
    maxMutationsPerRun: validated.maxMutationsPerRun,
    cooldownHours: validated.cooldownHours,
    ...validated.absoluteBudgetDeltaCapsByCurrency[currency],
  };
}
