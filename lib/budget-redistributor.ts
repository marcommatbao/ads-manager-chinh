// ============================================================
// AdsCommand — Budget Redistributor (Server-only)
// Auto-redistribute budgets across campaigns based on
// objective groups and efficiency scoring.
//
// Runs daily at 06:00 via CRON job.
//
// NOTE: This file uses Node.js fs/path — import from
// "@/lib/budget-redistributor.shared" for client components.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import type { Campaign } from "@/types/ads.types";

// Re-export everything from shared (types, constants, helpers)
export {
  type ObjectiveGroup,
  type GroupBenchmark,
  type ScoredCampaign,
  type BudgetChange,
  type RedistributionLog,
  type RedistributionSettings,
  GROUP_BENCHMARKS,
  GROUP_LABELS,
  DEFAULT_SETTINGS,
  fmtVND,
  estimateSavings,
} from "./budget-redistributor.shared";

import {
  type ObjectiveGroup,
  type ScoredCampaign,
  type BudgetChange,
  type RedistributionLog,
  type RedistributionSettings,
  GROUP_BENCHMARKS,
  GROUP_LABELS,
  DEFAULT_SETTINGS,
} from "./budget-redistributor.shared";

// ─────────────────────────────────────────────
// BƯỚC 1: Classify Campaign → Objective Group
// ─────────────────────────────────────────────

export function classifyGroup(campaign: Campaign): ObjectiveGroup {
  const name = (campaign.name || "").toLowerCase();

  // Domain Sales: tên miền, .one, .cloud, .asia, hosting
  if (
    name.includes("tên miền") ||
    name.includes("domain") ||
    name.includes(".one") ||
    name.includes(".cloud") ||
    name.includes(".asia") ||
    name.includes("thả ga") ||
    name.includes("mua 1") ||
    name.includes("hosting")
  ) {
    return "DOMAIN_SALES";
  }

  // Video Engagement
  if (
    campaign.objective === "OUTCOME_ENGAGEMENT" ||
    name.includes("video") ||
    name.includes("coffee")
  ) {
    return "VIDEO_ENGAGEMENT";
  }

  // Registration/Lead
  if (
    campaign.objective === "OUTCOME_SALES" ||
    name.includes("đăng ký") ||
    name.includes("sale ai") ||
    name.includes("áo đen") ||
    name.includes("registration")
  ) {
    return "REGISTRATION";
  }

  // Course/Webinar (MBI chủ yếu)
  if (
    name.includes("khoá học") ||
    name.includes("khóa học") ||
    name.includes("webinar") ||
    name.includes("bctc") ||
    name.includes("thuế") ||
    campaign.company === "MBI"
  ) {
    return "COURSE_LEAD";
  }

  // Default: Content/Traffic
  return "CONTENT_TRAFFIC";
}

// ─────────────────────────────────────────────
// BƯỚC 2: Efficiency Score (per group)
// ─────────────────────────────────────────────

function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return 999;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / 86400000);
}

export function calcEfficiencyScore(
  campaign: Campaign,
  group: ObjectiveGroup
): number | null {
  const bm = GROUP_BENCHMARKS[group];
  const m = campaign.metrics;

  // CPC link click & CTR link click — use campaign metrics
  const cpc = m.cpc || 0;
  const ctr = m.ctr || 0;
  const freq = m.frequency ?? 0;

  // Skip learning phase (< 3 days)
  const ageDays = daysSince(campaign.startDate);
  if (ageDays < 3) return null;

  // Need minimum data
  if (m.impressions < 500 || cpc === 0) return null;

  // Base score = CTR / CPC × 10^6 (higher = better)
  let score = (ctr / cpc) * 1_000_000;

  // Penalty for high frequency
  if (freq >= bm.freq_cap) {
    score *= 0.5; // −50%
  } else if (freq >= bm.freq_cap * 0.8) {
    score *= 0.75; // −25%
  }

  return score;
}

// ─────────────────────────────────────────────
// BƯỚC 3: Redistribution Algorithm
// ─────────────────────────────────────────────

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

export function computeRedistribution(
  campaigns: Campaign[],
  settings: RedistributionSettings
): BudgetChange[] {
  // Score all campaigns
  const scored: ScoredCampaign[] = campaigns
    .filter((c) => c.status === "ACTIVE")
    .filter((c) => !settings.exceptions.includes(c.id))
    .map((c) => {
      const group = classifyGroup(c);
      return {
        campaign: c,
        group,
        score: calcEfficiencyScore(c, group),
        currentBudget: c.dailyBudget || 0,
        cpcLink: c.metrics.cpc || 0,
        ctrLink: c.metrics.ctr || 0,
        frequency: c.metrics.frequency ?? 0,
      };
    })
    .filter((s) => s.score !== null && s.currentBudget > 0);

  // Group by objective group
  const groups = groupBy(scored, (s) => s.group);
  const changes: BudgetChange[] = [];

  for (const [groupName, groupCampaigns] of Object.entries(groups)) {
    if (groupCampaigns.length < 2) continue; // Need ≥2 to compare

    // Sort by score descending
    const sorted = [...groupCampaigns].sort(
      (a, b) => (b.score as number) - (a.score as number)
    );

    const total = sorted.length;
    const top30Count = Math.ceil(total * 0.3);
    const bottom30Count = Math.floor(total * 0.3) || 1; // At least 1

    // TOP 30%: Increase budget
    const winners = sorted.slice(0, top30Count);
    // BOTTOM 30%: Decrease budget
    const losers = sorted.slice(total - bottom30Count);

    for (const w of winners) {
      const increasePct = settings.maxIncreasePct / 100;
      const increase = w.currentBudget * increasePct;
      const newBudget = Math.round(w.currentBudget + increase);

      changes.push({
        campaignId: w.campaign.id,
        campaignName: w.campaign.name,
        group: w.group,
        action: "increase",
        oldBudget: w.currentBudget,
        newBudget,
        score: w.score as number,
        reason:
          `Top performer trong ${GROUP_LABELS[w.group as ObjectiveGroup]}. ` +
          `Score: ${(w.score as number).toFixed(2)}, ` +
          `CTR: ${w.ctrLink.toFixed(2)}%, ` +
          `CPC: ₫${Math.round(w.cpcLink).toLocaleString("vi-VN")}`,
        status: "pending",
      });
    }

    for (const l of losers) {
      const decreasePct = settings.maxDecreasePct / 100;
      const decrease = l.currentBudget * decreasePct;
      const newBudget = Math.max(
        settings.minBudget,
        Math.round(l.currentBudget - decrease)
      );

      changes.push({
        campaignId: l.campaign.id,
        campaignName: l.campaign.name,
        group: l.group,
        action: "decrease",
        oldBudget: l.currentBudget,
        newBudget,
        score: l.score as number,
        reason:
          `Bottom performer trong ${GROUP_LABELS[l.group as ObjectiveGroup]}. ` +
          `Score: ${(l.score as number).toFixed(2)}, ` +
          `CPC: ₫${Math.round(l.cpcLink).toLocaleString("vi-VN")}, ` +
          `CTR: ${l.ctrLink.toFixed(2)}%`,
        status: "pending",
      });
    }
  }

  return changes;
}

// ─────────────────────────────────────────────
// BƯỚC 4: Safety Checks
// ─────────────────────────────────────────────

export function applySafetyChecks(
  changes: BudgetChange[],
  settings: RedistributionSettings
): BudgetChange[] {
  return changes.map((change) => {
    // SAFETY 1: Min budget
    if (change.newBudget < settings.minBudget) {
      change.newBudget = settings.minBudget;
    }

    // SAFETY 2: Max increase cap
    const maxIncrease = change.oldBudget * (1 + settings.maxIncreasePct / 100);
    if (change.newBudget > maxIncrease) {
      change.newBudget = Math.round(maxIncrease);
    }

    // SAFETY 3: Don't change if difference is < ₫10K (avoid noise)
    if (Math.abs(change.newBudget - change.oldBudget) < 10000) {
      change.status = "skipped";
      change.error = "Thay đổi quá nhỏ (< ₫10K)";
    }

    return change;
  });
}

// ─────────────────────────────────────────────
// JSON Storage
// ─────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "redistribution-logs.json");
const SETTINGS_FILE = path.join(DATA_DIR, "redistribution-settings.json");

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // exists
  }
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(file: string, data: T): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(file, JSON.stringify(data, null, 2));
}

// ── Settings ──

export async function getSettings(): Promise<RedistributionSettings> {
  return readJSON<RedistributionSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
}

export async function saveSettings(
  settings: RedistributionSettings
): Promise<void> {
  await writeJSON(SETTINGS_FILE, settings);
}

// ── Logs ──

export async function getLogs(): Promise<RedistributionLog[]> {
  return readJSON<RedistributionLog[]>(LOG_FILE, []);
}

export async function saveLog(log: RedistributionLog): Promise<void> {
  await withFileLock(LOG_FILE, async () => {
    const logs = await getLogs();
    logs.push(log);
    // Keep last 90 days
    const cutoff = Date.now() - 90 * 86400000;
    const filtered = logs.filter(
      (l) => new Date(l.date).getTime() > cutoff
    );
    await writeJSON(LOG_FILE, filtered);
  });
}

export async function getLatestLog(
  company?: string
): Promise<RedistributionLog | null> {
  const logs = await getLogs();
  const filtered = company
    ? logs.filter((l) => l.company === company)
    : logs;
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

export async function getTodayLogs(): Promise<RedistributionLog[]> {
  const logs = await getLogs();
  const today = new Date().toISOString().split("T")[0];
  return logs.filter((l) => l.date.startsWith(today));
}

// ── Undo ──

export async function undoRedistribution(
  logId: string
): Promise<BudgetChange[]> {
  const logs = await getLogs();
  const log = logs.find((l) => l.id === logId);
  if (!log) return [];

  // Build reverse changes
  return log.changes
    .filter((c) => c.status === "success")
    .map((c) => ({
      ...c,
      action: c.action === "increase" ? "decrease" as const : "increase" as const,
      oldBudget: c.newBudget,
      newBudget: c.oldBudget,
      reason: `↩ Hoàn tác thay đổi từ ${new Date(log.date).toLocaleString("vi-VN")}`,
      status: "pending" as const,
    }));
}

export async function undoSingleChange(
  logId: string,
  campaignId: string
): Promise<BudgetChange | null> {
  const logs = await getLogs();
  const log = logs.find((l) => l.id === logId);
  if (!log) return null;

  const change = log.changes.find(
    (c) => c.campaignId === campaignId && c.status === "success"
  );
  if (!change) return null;

  return {
    ...change,
    action: change.action === "increase" ? "decrease" : "increase",
    oldBudget: change.newBudget,
    newBudget: change.oldBudget,
    reason: `↩ Hoàn tác thay đổi campaign ${change.campaignName}`,
    status: "pending",
  };
}

// Formatting Helpers & estimateSavings are in budget-redistributor.shared.ts
