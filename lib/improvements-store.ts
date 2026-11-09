// ============================================================
// Improvements — Dismissed-ID persistence
// ============================================================
// The GET /api/improvements handler regenerates the improvement
// list fresh on every request (no DB row per improvement), so
// "dismissed" state can't live on the item itself — it has to be
// tracked separately by a stable id and filtered out at read time.
// JSON-file store, same pattern as lib/team.ts.

import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "./file-lock";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "improvements-dismissed.json");

interface DismissedEntry {
  id: string;
  company: string;
  dismissedAt: string;
}

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

async function readAll(): Promise<DismissedEntry[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as DismissedEntry[];
  } catch {
    return [];
  }
}

async function writeAll(entries: DismissedEntry[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(FILE, JSON.stringify(entries, null, 2));
}

export async function dismissImprovement(id: string, company: string): Promise<void> {
  await withFileLock(FILE, async () => {
    const entries = await readAll();
    if (entries.some((e) => e.id === id)) return;
    entries.push({ id, company, dismissedAt: new Date().toISOString() });
    // Cap growth — improvement ids are deterministic per underlying
    // entity/metric, so old entries for since-resolved issues are safe
    // to drop once the list gets large.
    await writeAll(entries.slice(-2000));
  });
}

export async function getDismissedIds(company: string): Promise<Set<string>> {
  const entries = await readAll();
  return new Set(entries.filter((e) => e.company === company).map((e) => e.id));
}
