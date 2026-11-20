import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

export interface SnapshotBinding {
  provider: "google" | "meta";
  company: string;
  accountId: string;
  campaignId: string;
  policyRevision: string;
}
export interface SnapshotPayload {
  provider: string;
  company: string;
  accountId: string;
  campaignId: string;
  readAt: string;
  expiresAt: string;
  approvable: boolean;
}
export interface StoredSnapshot {
  registryId: string;
  binding: SnapshotBinding;
  payload: SnapshotPayload;
  payloadHash: string;
  storedAt: string;
}
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 2000;
const filename = () => path.join(process.cwd(), "data", "automation-snapshots.json");
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function readAll(): StoredSnapshot[] {
  try {
    const rows: unknown = JSON.parse(fs.readFileSync(filename(), "utf8"));
    if (!Array.isArray(rows)) throw new Error("invalid registry");
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("SNAPSHOT_STORE_UNAVAILABLE");
  }
}
function validTime(payload: SnapshotPayload, now: Date): boolean {
  const readAt = Date.parse(payload.readAt), expiresAt = Date.parse(payload.expiresAt);
  return Number.isFinite(now.getTime()) && Number.isFinite(readAt) && Number.isFinite(expiresAt)
    && readAt <= now.getTime() && expiresAt > now.getTime()
    && expiresAt > readAt && expiresAt - readAt <= TTL_MS;
}
function matches(payload: SnapshotPayload, binding: SnapshotBinding): boolean {
  return (["provider", "company", "accountId", "campaignId"] as const).every(key =>
    typeof binding[key] === "string" && binding[key].trim().length > 0 && payload[key] === binding[key]);
}

/** Only server-side collectors may call this; never persist arbitrary request bodies. */
export async function persistCampaignSnapshot(payload: SnapshotPayload, binding: SnapshotBinding, now = new Date()): Promise<StoredSnapshot> {
  if (!["google", "meta"].includes(binding.provider) || !binding.policyRevision?.trim() || !matches(payload, binding) || payload.approvable !== false) throw new Error("SNAPSHOT_BINDING_MISMATCH");
  if (!validTime(payload, now)) throw new Error("SNAPSHOT_EXPIRED_OR_INVALID");
  // Clone before yielding so a caller cannot change the payload during persistence.
  const copy = structuredClone(payload);
  const record: StoredSnapshot = {
    registryId: crypto.randomUUID(), binding: { ...binding }, payload: copy,
    payloadHash: hash({ binding, payload: copy }), storedAt: now.toISOString(),
  };
  await withFileLock(filename(), async () => {
    const rows = readAll().filter(row => row?.payload && validTime(row.payload, now));
    // Refuse capacity exhaustion rather than evicting an unexpired snapshot.
    if (rows.length >= MAX_RECORDS) throw new Error("SNAPSHOT_STORE_FULL");
    fs.mkdirSync(path.dirname(filename()), { recursive: true });
    writeFileAtomicSync(filename(), JSON.stringify([...rows, record], null, 2));
  });
  return structuredClone(record);
}

/** Supply current server-owned account mapping and policy revision, not client claims. */
export function resolveCampaignSnapshot(registryId: string, expected: SnapshotBinding, now = new Date()): StoredSnapshot {
  const record = readAll().find(row => row?.registryId === registryId);
  if (!record?.binding || !record.payload) throw new Error("SNAPSHOT_NOT_FOUND");
  if (record.payloadHash !== hash({ binding: record.binding, payload: record.payload })) throw new Error("SNAPSHOT_INTEGRITY_FAILED");
  if (!matches(record.payload, record.binding) || (["provider", "company", "accountId", "campaignId", "policyRevision"] as const).some(key => typeof expected[key] !== "string" || expected[key] !== record.binding[key])) throw new Error("SNAPSHOT_BINDING_MISMATCH");
  if (expected.policyRevision !== record.binding.policyRevision) throw new Error("SNAPSHOT_BINDING_MISMATCH");
  if (!validTime(record.payload, now)) throw new Error("SNAPSHOT_EXPIRED_OR_INVALID");
  return structuredClone(record);
}
