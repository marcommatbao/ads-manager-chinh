// ============================================================
// Quality Score history — shared store + comparison rules
//
// Extracted from app/api/google/toolkit/quality-score/route.ts (which owned
// the only read/write path) so lib/quality-score-digest.ts stops keeping its
// own copy of the read + "previous score" logic. Both consumers had the same
// comparison bug, and fixing it twice in two places is how it comes back.
//
// The bug: a snapshot is written once per day, and both callers picked the
// most recent record in the file as "the previous score". The first page view
// of the day writes today's snapshot — every view after that compared today's
// QS against today's own snapshot and reported "unchanged" for every keyword,
// which is also why the daily digest could never count a declining keyword
// once the snapshot job ran before it. The previous score must come from a
// DIFFERENT day than the one being scored.
// ============================================================
import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";

const DATA_DIR = path.join(process.cwd(), "data");
export const QS_FILE = path.join(DATA_DIR, "quality-score-history.json");

export interface QSRecord {
  company: string;
  criterionId: string;
  keyword: string;
  qualityScore: number;
  expectedCtr: string;
  adRelevance: string;
  landingPage: string;
  recordedAt: string;
  /** "YYYY-MM-DD". Optional — records written before this field existed are
   *  still valid and fall back to slicing recordedAt. */
  recordedDate?: string;
}

/** Retention window. Long enough to see a quarter of movement per keyword. */
const RETENTION_DAYS = 90;

export function dateOf(record: { recordedAt: string; recordedDate?: string }): string {
  return record.recordedDate ?? record.recordedAt.slice(0, 10);
}

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export async function readQSHistory(): Promise<QSRecord[]> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
  try {
    const raw = await fs.readFile(QS_FILE, "utf-8");
    return JSON.parse(raw) as QSRecord[];
  } catch {
    return [];
  }
}

/**
 * Prune by DATE, not by record count.
 *
 * The old rule kept the last 5000 array entries. A few hundred keywords a day
 * fills that in a couple of weeks, and because it sliced from the front it
 * dropped whichever keywords happened to be written first — so a keyword still
 * running could silently lose the only older snapshot it had to be compared
 * against. Age is the thing that makes a record worthless, so age is what
 * decides. Within the window every keyword keeps every snapshot it has.
 */
export function pruneQSHistory(records: QSRecord[], today = todayStr()): QSRecord[] {
  const cutoffMs = new Date(`${today}T00:00:00Z`).getTime() - RETENTION_DAYS * 86400000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);

  const kept = records.filter((r) => dateOf(r) >= cutoff);

  // A keyword whose entire history predates the window would lose its only
  // comparison mark and read as "new" forever. Keep its single newest record
  // so the next snapshot still has something to compare against.
  const keptKeys = new Set(kept.map((r) => `${r.company}:${r.criterionId}`));
  const rescued = new Map<string, QSRecord>();
  for (const r of records) {
    const key = `${r.company}:${r.criterionId}`;
    if (keptKeys.has(key)) continue;
    const existing = rescued.get(key);
    if (!existing || r.recordedAt > existing.recordedAt) rescued.set(key, r);
  }

  return [...kept, ...rescued.values()];
}

export async function writeQSHistory(records: QSRecord[]): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
  await writeFileAtomic(QS_FILE, JSON.stringify(pruneQSHistory(records), null, 2));
}

/**
 * Newest snapshot for this keyword from a day OTHER than `today`.
 *
 * Returns null when the keyword has only ever been seen today — the caller
 * must then report "new", never "unchanged". Those two mean opposite things
 * to someone deciding whether a keyword is getting worse.
 */
export function previousSnapshotFor(
  history: QSRecord[],
  company: string,
  criterionId: string,
  today = todayStr(),
): QSRecord | null {
  let best: QSRecord | null = null;
  for (const h of history) {
    if (h.company !== company) continue;
    if (h.criterionId !== criterionId) continue;
    if (dateOf(h) >= today) continue;
    if (!best || h.recordedAt > best.recordedAt) best = h;
  }
  return best;
}

/** Index of previous snapshots for a whole set of keywords, one pass. */
export function previousSnapshotIndex(
  history: QSRecord[],
  company: string,
  today = todayStr(),
): Map<string, QSRecord> {
  const index = new Map<string, QSRecord>();
  for (const h of history) {
    if (h.company !== company) continue;
    if (dateOf(h) >= today) continue;
    const existing = index.get(h.criterionId);
    if (!existing || h.recordedAt > existing.recordedAt) index.set(h.criterionId, h);
  }
  return index;
}

/** Coverage of the stored series, so the UI can say what it is comparing against. */
export function historyCoverage(history: QSRecord[], company: string) {
  const dates = new Set<string>();
  for (const h of history) {
    if (h.company !== company) continue;
    dates.add(dateOf(h));
  }
  const sorted = [...dates].sort();
  return {
    firstSnapshot: sorted[0] ?? null,
    lastSnapshot: sorted[sorted.length - 1] ?? null,
    snapshotDays: sorted.length,
  };
}
