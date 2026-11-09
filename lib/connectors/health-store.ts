// ============================================================
// Connector health persistence — data/connector-health.json
// Uses withFileLock for safe concurrent writes.
// ============================================================

import fs from "fs";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomic } from "@/lib/fs-atomic";
import type { ConnectorHealthFile, ConnectorHealthRecord, ConnectorId } from "./types";

const HEALTH_FILE = path.join(process.cwd(), "data", "connector-health.json");

function readHealthFile(): ConnectorHealthFile {
  try {
    if (fs.existsSync(HEALTH_FILE)) {
      return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8")) as ConnectorHealthFile;
    }
  } catch { /* ignore — return empty */ }
  return { updatedAt: new Date().toISOString(), records: {} };
}

/**
 * Read all stored health records (may be stale — use engine to refresh).
 */
export function getAllStoredHealth(): ConnectorHealthFile {
  return readHealthFile();
}

/**
 * Read a single connector's stored health record (null if never checked).
 */
export function getStoredHealth(id: ConnectorId): ConnectorHealthRecord | null {
  return readHealthFile().records[id] ?? null;
}

/**
 * Persist one or more health records atomically.
 */
export async function saveHealthRecords(
  updates: Partial<Record<ConnectorId, ConnectorHealthRecord>>,
): Promise<void> {
  await withFileLock(HEALTH_FILE, async () => {
    const current = readHealthFile();
    const merged: ConnectorHealthFile = {
      updatedAt: new Date().toISOString(),
      records: { ...current.records, ...updates },
    };
    fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
    await writeFileAtomic(HEALTH_FILE, JSON.stringify(merged, null, 2));
  });
}

/**
 * Persist a single record.
 */
export async function saveHealthRecord(record: ConnectorHealthRecord): Promise<void> {
  await saveHealthRecords({ [record.id]: record });
}
