// ============================================================
// Change Impact Tracker
// Lưu snapshot trước/sau khi Apply thay đổi audience
// So sánh metrics sau 3 ngày, hỗ trợ rollback
// ============================================================

import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import path from "path";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface MetricSnapshot {
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;       // %
  cpc: number;       // VND
  cpl: number;       // VND
  frequency: number;
  results: number;
  period: string;    // "3 ngày trước thay đổi" | "3 ngày sau thay đổi"
}

export interface ChangeRecord {
  id: string;
  campaignId: string;
  campaignName: string;
  company: string;
  actionType: "exclude_age" | "exclude_placement" | "focus_gender" | "exclude_gender" | "exclude_age_range" | "add_interests";
  actionLabel: string;
  appliedAt: string;    // ISO
  checkAt: string;      // appliedAt + 3 days

  // Targeting rollback data
  previousTargeting: Record<string, unknown>[];  // per adset [{adsetId, targeting}]
  adsetIds: string[];

  // Metrics
  metricsBefore: MetricSnapshot;
  metricsAfter?: MetricSnapshot;

  // Status
  status: "pending" | "completed" | "rolled_back";
  notified: boolean;

  // Comparison result (computed after metricsAfter is set)
  comparison?: MetricComparison;

  // Extended fields for GENDER/AGE tracking
  suggestionType?: string;  // EXCLUDE_PLACEMENT | EXCLUDE_GENDER | EXCLUDE_AGE
  changeLabel?: string;     // Human-readable change description
  delta?: Record<string, number>;  // % change per metric
  verdict?: "BETTER" | "WORSE" | "NEUTRAL";  // Auto verdict based on CPL ±10%
}

export interface MetricComparison {
  cplChange: number;    // % change (negative = better)
  ctrChange: number;    // % change (positive = better)
  cpcChange: number;    // % change (negative = better)
  freqChange: number;
  spendChange: number;
  resultChange: number;
  overall: "improved" | "declined" | "neutral";
  summary: string; // "CPL giảm 23%, CTR tăng 33%"
}

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "change-history.json");

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

export async function readHistory(): Promise<ChangeRecord[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as ChangeRecord[];
  } catch {
    return [];
  }
}

async function writeHistory(records: ChangeRecord[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(HISTORY_FILE, JSON.stringify(records, null, 2));
}

// ─────────────────────────────────────────────
// Save a change record
// ─────────────────────────────────────────────

export async function saveChangeRecord(record: Omit<ChangeRecord, "id" | "checkAt" | "status" | "notified">): Promise<ChangeRecord> {
  return withFileLock(HISTORY_FILE, async () => {
    const history = await readHistory();

    const appliedDate = new Date(record.appliedAt);
    const checkDate = new Date(appliedDate.getTime() + 3 * 24 * 60 * 60 * 1000);

    const newRecord: ChangeRecord = {
      ...record,
      id: `chg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      checkAt: checkDate.toISOString(),
      status: "pending",
      notified: false,
    };

    history.unshift(newRecord); // newest first

    // Keep max 200 records
    const capped = history.slice(0, 200);
    await writeHistory(capped);

    return newRecord;
  });
}

// ─────────────────────────────────────────────
// Update metrics after 3 days
// ─────────────────────────────────────────────

export function computeComparison(before: MetricSnapshot, after: MetricSnapshot): MetricComparison {
  const pctChange = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);

  const cplChange = pctChange(after.cpl, before.cpl);
  const ctrChange = pctChange(after.ctr, before.ctr);
  const cpcChange = pctChange(after.cpc, before.cpc);
  const freqChange = pctChange(after.frequency, before.frequency);
  const spendChange = pctChange(after.spend, before.spend);
  const resultChange = pctChange(after.results, before.results);

  // Overall: improved if CPL decreased OR (CTR increased AND CPC decreased)
  let overall: "improved" | "declined" | "neutral" = "neutral";
  if (cplChange < -5 || (ctrChange > 10 && cpcChange < -5)) {
    overall = "improved";
  } else if (cplChange > 10 || (ctrChange < -10 && cpcChange > 10)) {
    overall = "declined";
  }

  // Build summary
  const parts: string[] = [];
  if (cplChange !== 0) parts.push(`CPL ${cplChange < 0 ? "giảm" : "tăng"} ${Math.abs(cplChange)}%`);
  if (ctrChange !== 0) parts.push(`CTR ${ctrChange > 0 ? "tăng" : "giảm"} ${Math.abs(ctrChange)}%`);
  if (cpcChange !== 0) parts.push(`CPC ${cpcChange < 0 ? "giảm" : "tăng"} ${Math.abs(cpcChange)}%`);

  return {
    cplChange,
    ctrChange,
    cpcChange,
    freqChange,
    spendChange,
    resultChange,
    overall,
    summary: parts.join(", ") || "Không có thay đổi đáng kể",
  };
}

/**
 * Compute verdict (BETTER/WORSE/NEUTRAL) based on CPL ±10% threshold
 * and delta object with % changes per metric
 */
export function computeVerdict(
  before: MetricSnapshot,
  after: MetricSnapshot
): { verdict: "BETTER" | "WORSE" | "NEUTRAL"; delta: Record<string, number> } {
  const pctChange = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);

  const delta = {
    cpl: pctChange(after.cpl, before.cpl),
    ctr: pctChange(after.ctr, before.ctr),
    cpc: pctChange(after.cpc, before.cpc),
    frequency: pctChange(after.frequency, before.frequency),
    impressions: pctChange(after.impressions, before.impressions),
    spend: pctChange(after.spend, before.spend),
    results: pctChange(after.results, before.results),
  };

  // CPL > +10% → WORSE, CPL < -10% → BETTER, else NEUTRAL
  const verdict: "BETTER" | "WORSE" | "NEUTRAL" =
    after.cpl > before.cpl * 1.1 ? "WORSE" :
    after.cpl < before.cpl * 0.9 ? "BETTER" :
    "NEUTRAL";

  return { verdict, delta };
}

export async function updateMetricsAfter(
  id: string,
  metricsAfter: MetricSnapshot
): Promise<ChangeRecord | null> {
  return withFileLock(HISTORY_FILE, async () => {
    const history = await readHistory();
    const idx = history.findIndex((r) => r.id === id);
    if (idx < 0) return null;

    history[idx].metricsAfter = metricsAfter;
    history[idx].status = "completed";
    history[idx].comparison = computeComparison(history[idx].metricsBefore, metricsAfter);

    // Compute verdict and delta
    const { verdict, delta } = computeVerdict(history[idx].metricsBefore, metricsAfter);
    history[idx].verdict = verdict;
    history[idx].delta = delta;

    await writeHistory(history);
    return history[idx];
  });
}

// ─────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────

export async function markRolledBack(id: string): Promise<ChangeRecord | null> {
  return withFileLock(HISTORY_FILE, async () => {
    const history = await readHistory();
    const idx = history.findIndex((r) => r.id === id);
    if (idx < 0) return null;

    history[idx].status = "rolled_back";
    await writeHistory(history);
    return history[idx];
  });
}

// ─────────────────────────────────────────────
// Get records due for check (3 days passed)
// ─────────────────────────────────────────────

export async function getPendingChecks(): Promise<ChangeRecord[]> {
  const history = await readHistory();
  const now = new Date().toISOString();

  return history.filter(
    (r) => r.status === "pending" && r.checkAt <= now && !r.notified
  );
}

export async function markNotified(id: string): Promise<void> {
  await withFileLock(HISTORY_FILE, async () => {
    const history = await readHistory();
    const idx = history.findIndex((r) => r.id === id);
    if (idx >= 0) {
      history[idx].notified = true;
      await writeHistory(history);
    }
  });
}

// ─────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────

export async function getChangeHistory(filter?: {
  campaignId?: string;
  status?: string;
  limit?: number;
}): Promise<ChangeRecord[]> {
  let records = await readHistory();

  if (filter?.campaignId) {
    records = records.filter((r) => r.campaignId === filter.campaignId);
  }
  if (filter?.status) {
    records = records.filter((r) => r.status === filter.status);
  }
  if (filter?.limit) {
    records = records.slice(0, filter.limit);
  }

  return records;
}
