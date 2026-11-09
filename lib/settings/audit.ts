// ============================================================
// Central audit log — one JSON file per domain under data/audit/
// Max 500 entries + 20 snapshots per domain.
// SECRET domains log action only — never old/new values.
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import crypto from "crypto";
import { withFileLock } from "@/lib/file-lock";
import {
  DOMAIN_CLASS,
  ROLLBACK_ELIGIBLE_DOMAINS,
  type AuditEntry,
  type AuditFile,
  type AuditSnapshot,
  type AuditWriteOpts,
  type DiffRecord,
  type SettingsDomain,
} from "./types";
import type { SessionUser } from "@/lib/auth";

const AUDIT_DIR = path.join(process.cwd(), "data", "audit");
const MAX_ENTRIES   = 500;
const MAX_SNAPSHOTS = 20;

// ── File helpers ───────────────────────────────────────────

function auditPath(domain: SettingsDomain): string {
  return path.join(AUDIT_DIR, `${domain}.audit.json`);
}

function readFile(domain: SettingsDomain): AuditFile {
  try {
    const p = auditPath(domain);
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<AuditFile>;
      return {
        entries:   Array.isArray(raw.entries)   ? raw.entries   : [],
        snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
      };
    }
  } catch { /* ignore */ }
  return { entries: [], snapshots: [] };
}

async function writeAuditFile(domain: SettingsDomain, data: AuditFile): Promise<void> {
  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  await writeFileAtomic(auditPath(domain), JSON.stringify(data, null, 2));
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

// ── Diff utility ───────────────────────────────────────────

/**
 * Compute a flat list of field-level changes between two plain objects.
 * Recurses one level deep for nested objects; does not recurse into arrays.
 */
export function computeDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefix = "",
): DiffRecord[] {
  const diffs: DiffRecord[] = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (oldVal === newVal) continue;

    const bothObjects =
      typeof oldVal === "object" && oldVal !== null && !Array.isArray(oldVal) &&
      typeof newVal === "object" && newVal !== null && !Array.isArray(newVal);

    if (bothObjects) {
      diffs.push(
        ...computeDiff(
          oldVal as Record<string, unknown>,
          newVal as Record<string, unknown>,
          fieldPath,
        ),
      );
    } else {
      diffs.push({ field: fieldPath, oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Append one audit entry.
 * For SECRET domains, old_value, new_value, and diff are always null/undefined.
 */
export async function writeAuditEntry(
  domain: SettingsDomain,
  actor: SessionUser,
  action: AuditEntry["action"],
  field: string,
  oldValue: unknown,
  newValue: unknown,
  company: string /* mã công ty hoặc "ALL" */ = "ALL",
  opts: AuditWriteOpts = {},
): Promise<void> {
  const isSecret         = DOMAIN_CLASS[domain] === "SECRET";
  const rollbackEligible = opts.rollbackEligible ?? ROLLBACK_ELIGIBLE_DOMAINS.includes(domain);

  const entry: AuditEntry = {
    id:                 makeId("aud"),
    timestamp:          new Date().toISOString(),
    actor_id:           actor.id,
    actor_email:        actor.email,
    actor_role:         actor.role,
    domain,
    company,
    action,
    field,
    old_value:          isSecret ? null : oldValue,
    new_value:          isSecret ? null : newValue,
    diff:               isSecret ? undefined : opts.diff,
    rollbackEligible,
    rollbackReference:  opts.rollbackReference,
    note:               opts.note,
  };

  await withFileLock(`audit:${domain}`, async () => {
    const file = readFile(domain);
    file.entries.unshift(entry);
    if (file.entries.length > MAX_ENTRIES) file.entries = file.entries.slice(0, MAX_ENTRIES);
    await writeAuditFile(domain, file);
  });
}

/**
 * Save a full-config snapshot before overwriting (enables rollback).
 * Returns the snapshot id.
 */
export async function writeAuditSnapshot(
  domain: SettingsDomain,
  actor: SessionUser,
  data: unknown,
): Promise<string> {
  const snap: AuditSnapshot = {
    id:          makeId("snap"),
    timestamp:   new Date().toISOString(),
    actor_id:    actor.id,
    actor_email: actor.email,
    domain,
    data,
  };

  await withFileLock(`audit:${domain}`, async () => {
    const file = readFile(domain);
    file.snapshots.unshift(snap);
    if (file.snapshots.length > MAX_SNAPSHOTS) file.snapshots = file.snapshots.slice(0, MAX_SNAPSHOTS);
    await writeAuditFile(domain, file);
  });

  return snap.id;
}

/** Read audit log for one domain (newest first). */
export function getAuditLog(domain: SettingsDomain, limit = 50): AuditEntry[] {
  return readFile(domain).entries.slice(0, limit);
}

/** Read rollback snapshots for one domain (newest first). */
export function getAuditSnapshots(domain: SettingsDomain): AuditSnapshot[] {
  return readFile(domain).snapshots;
}

/** Find one snapshot by id. */
export function findSnapshot(domain: SettingsDomain, snapshotId: string): AuditSnapshot | undefined {
  return readFile(domain).snapshots.find(s => s.id === snapshotId);
}
