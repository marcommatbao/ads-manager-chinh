// ============================================================
// AdsCommand — Budget Monitor & Configuration
// JSON file storage for monthly budget configs per company×platform
// Includes: pacing calculator, alert tracking, spend snapshots
// ============================================================

import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import path from "path";
import { appLink } from "@/lib/app-url";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type BudgetCompany  = string /* mã công ty hoặc "ALL" */;
export type BudgetPlatform = "facebook" | "google" | "all";
export type BudgetAction   = "alert_only" | "pause";
export type PacingStatus   = "overspending" | "underspending" | "on_track";

export interface BudgetConfig {
  id: string;
  company: BudgetCompany;
  platform: BudgetPlatform;
  month: string;               // "2026-03" format
  budget_amount: number;       // VND
  alert_threshold_1: number;   // % → default 50
  alert_threshold_2: number;   // % → default 80
  alert_threshold_3: number;   // % → default 95
  action_at_100: BudgetAction; // what to do at 100%
  telegram_chat_id: string;
  created_at: string;          // ISO date
  updated_at: string;          // ISO date
}

export interface BudgetWithProgress extends BudgetConfig {
  spent: number;
  remaining: number;
  percentage: number;           // 0-100
  forecast_end_of_month: number;
  forecast_status: "ok" | "warning" | "danger";
  days_left: number;
  daily_average: number;
}

export interface BudgetPacing {
  spendPct: number;
  pacingStatus: PacingStatus;
  pacingDelta: number;          // + = overspend, - = underspend
  idealSpend: number;           // what should have been spent by now
  forecastTotal: number;
  forecastOverrun: number;      // + = will exceed budget
  daysInMonth: number;
  daysPassed: number;
  daysLeft: number;
  avgSpendPerDay: number;
  recommendedDailyBudget: number;
}

export interface AlertSentRecord {
  config_id: string;
  threshold: number | "forecast";
  month: string;
  sent_at: string;             // ISO date
}

export interface PacingSnapshot {
  config_id: string;
  date: string;                // YYYY-MM-DD
  spent: number;
  budget_amount: number;
  spend_pct: number;
  pacing_status: PacingStatus;
  forecast_total: number;
}

export interface BudgetChangeLog {
  id: string;
  config_id: string;
  company: BudgetCompany;
  platform: BudgetPlatform;
  month: string;
  field: string;               // e.g. "budget_amount"
  old_value: number | string;
  new_value: number | string;
  changed_at: string;          // ISO datetime
  changed_by: string;          // "user" | "system"
  note?: string;
}

// ─────────────────────────────────────────────
// Storage — JSON files
// ─────────────────────────────────────────────

const DATA_DIR        = path.join(process.cwd(), "data");
const CONFIG_FILE     = path.join(DATA_DIR, "budget-configs.json");
const ALERTS_FILE     = path.join(DATA_DIR, "budget-alerts-sent.json");
const SNAPSHOTS_FILE  = path.join(DATA_DIR, "budget-snapshots.json");

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // directory already exists
  }
}

async function readJSON<T>(file: string): Promise<T[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function writeJSON<T>(file: string, data: T[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(file, JSON.stringify(data, null, 2));
}

// Typed readers/writers
async function readConfigs(): Promise<BudgetConfig[]> { return readJSON<BudgetConfig>(CONFIG_FILE); }
async function writeConfigs(c: BudgetConfig[]): Promise<void> { return writeJSON(CONFIG_FILE, c); }
async function readAlerts(): Promise<AlertSentRecord[]> { return readJSON<AlertSentRecord>(ALERTS_FILE); }
async function writeAlerts(a: AlertSentRecord[]): Promise<void> { return writeJSON(ALERTS_FILE, a); }
async function readSnapshots(): Promise<PacingSnapshot[]> { return readJSON<PacingSnapshot>(SNAPSHOTS_FILE); }
async function writeSnapshots(s: PacingSnapshot[]): Promise<void> { return writeJSON(SNAPSHOTS_FILE, s); }

// Changelog
const CHANGELOG_FILE = path.join(DATA_DIR, "budget-changelog.json");
async function readChangelog(): Promise<BudgetChangeLog[]> { return readJSON<BudgetChangeLog>(CHANGELOG_FILE); }
async function writeChangelog(c: BudgetChangeLog[]): Promise<void> { return writeJSON(CHANGELOG_FILE, c); }

async function logBudgetChange(entry: Omit<BudgetChangeLog, "id" | "changed_at">): Promise<void> {
  await withFileLock(CHANGELOG_FILE, async () => {
    const logs = await readChangelog();
    logs.push({
      ...entry,
      id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      changed_at: new Date().toISOString(),
    });
    // Keep last 500 entries
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    await writeChangelog(logs);
  });
}

// ─────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────

/** Get all configs (no filter). */
export async function getAllConfigs(): Promise<BudgetConfig[]> {
  return readConfigs();
}

/** Get all configs for a given month. */
export async function getConfigsByMonth(month: string): Promise<BudgetConfig[]> {
  const all = await readConfigs();
  return all.filter((c) => c.month === month);
}

/** Get current month string YYYY-MM. */
export function currentMonthStr(now?: Date): string {
  const d = now ?? new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Get all active configs for the current month. */
export async function getActiveConfigs(now?: Date): Promise<BudgetConfig[]> {
  return getConfigsByMonth(currentMonthStr(now));
}

/** Get a specific config by company + platform + month. */
export async function getConfig(
  company: BudgetCompany,
  platform: BudgetPlatform,
  month: string
): Promise<BudgetConfig | null> {
  const all = await readConfigs();
  return all.find(
    (c) => c.company === company && c.platform === platform && c.month === month
  ) ?? null;
}

/** Upsert (create or update) a config. */
export async function upsertConfig(
  config: Omit<BudgetConfig, "id" | "created_at" | "updated_at"> & { id?: string }
): Promise<BudgetConfig> {
  return withFileLock(CONFIG_FILE, async () => {
    const all = await readConfigs();
    const now = new Date().toISOString();

    const existingIdx = all.findIndex(
      (c) => c.company === config.company && c.platform === config.platform && c.month === config.month
    );

    if (existingIdx >= 0) {
      const existing = all[existingIdx];

      // ── Track changes for changelog ──
      const trackFields: Array<{ field: string; key: keyof BudgetConfig }> = [
        { field: "budget_amount", key: "budget_amount" },
        { field: "alert_threshold_1", key: "alert_threshold_1" },
        { field: "alert_threshold_2", key: "alert_threshold_2" },
        { field: "alert_threshold_3", key: "alert_threshold_3" },
        { field: "action_at_100", key: "action_at_100" },
      ];

      for (const { field, key } of trackFields) {
        const oldVal = existing[key];
        const newVal = (config as Record<string, unknown>)[key];
        if (newVal !== undefined && newVal !== oldVal) {
          await logBudgetChange({
            config_id: existing.id,
            company: existing.company,
            platform: existing.platform,
            month: existing.month,
            field,
            old_value: oldVal as number | string,
            new_value: newVal as number | string,
            changed_by: "user",
          });
          console.log(`📝 Budget change: ${existing.company}×${existing.platform} ${field}: ${oldVal} → ${newVal}`);
        }
      }

      all[existingIdx] = {
        ...existing,
        ...config,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      };
      await writeConfigs(all);
      return all[existingIdx];
    }

    const newConfig: BudgetConfig = {
      id: `budget_${config.company}_${config.platform}_${config.month}`,
      company: config.company,
      platform: config.platform,
      month: config.month,
      budget_amount: config.budget_amount,
      alert_threshold_1: config.alert_threshold_1 ?? 50,
      alert_threshold_2: config.alert_threshold_2 ?? 80,
      alert_threshold_3: config.alert_threshold_3 ?? 95,
      action_at_100: config.action_at_100 ?? "alert_only",
      telegram_chat_id: config.telegram_chat_id ?? "",
      created_at: now,
      updated_at: now,
    };

    all.push(newConfig);
    await writeConfigs(all);
    return newConfig;
  });
}

/** Save multiple configs at once (for bulk month save). */
export async function saveMonthConfigs(
  month: string,
  configs: Array<Omit<BudgetConfig, "id" | "created_at" | "updated_at">>
): Promise<BudgetConfig[]> {
  const results: BudgetConfig[] = [];
  for (const c of configs) {
    results.push(await upsertConfig({ ...c, month }));
  }
  return results;
}

/** Copy configs from a previous month to a new month. */
export async function copyFromMonth(
  sourceMonth: string,
  targetMonth: string
): Promise<BudgetConfig[]> {
  const source = await getConfigsByMonth(sourceMonth);
  if (source.length === 0) return [];

  const results: BudgetConfig[] = [];
  for (const s of source) {
    results.push(
      await upsertConfig({
        company: s.company,
        platform: s.platform,
        month: targetMonth,
        budget_amount: s.budget_amount,
        alert_threshold_1: s.alert_threshold_1,
        alert_threshold_2: s.alert_threshold_2,
        alert_threshold_3: s.alert_threshold_3,
        action_at_100: s.action_at_100,
        telegram_chat_id: s.telegram_chat_id,
      })
    );
  }
  return results;
}

// ─────────────────────────────────────────────
// Budget Progress Calculation (simple)
// ─────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Enrich a budget config with spend progress data. */
export function enrichWithProgress(
  config: BudgetConfig,
  currentSpend: number,
  now?: Date
): BudgetWithProgress {
  const d = now ?? new Date();
  const [yearStr, monthStr] = config.month.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;

  const totalDays = getDaysInMonth(year, monthIdx);
  const daysElapsed = d.getMonth() === monthIdx && d.getFullYear() === year
    ? d.getDate()
    : totalDays;

  const daysLeft = Math.max(0, totalDays - daysElapsed);
  const dailyAvg = daysElapsed > 0 ? currentSpend / daysElapsed : 0;
  const forecastTotal = currentSpend + (dailyAvg * daysLeft);
  const remaining = Math.max(0, config.budget_amount - currentSpend);
  const percentage = config.budget_amount > 0
    ? Math.min(Math.round((currentSpend / config.budget_amount) * 100), 100)
    : 0;

  let forecastStatus: "ok" | "warning" | "danger" = "ok";
  if (forecastTotal > config.budget_amount * 1.05) {
    forecastStatus = "danger";
  } else if (forecastTotal > config.budget_amount * 0.9) {
    forecastStatus = "warning";
  }

  return {
    ...config,
    spent: currentSpend,
    remaining,
    percentage,
    forecast_end_of_month: Math.round(forecastTotal),
    forecast_status: forecastStatus,
    days_left: daysLeft,
    daily_average: Math.round(dailyAvg),
  };
}

// ─────────────────────────────────────────────
// Budget Pacing Calculator (advanced)
// ─────────────────────────────────────────────

export function calculateBudgetPacing(
  config: BudgetConfig,
  currentSpend: number,
  now?: Date
): BudgetPacing {
  const today = now ?? new Date();
  const [yearStr, monthStr] = config.month.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;

  const daysInMonth = getDaysInMonth(year, monthIdx);
  const daysPassed = today.getMonth() === monthIdx && today.getFullYear() === year
    ? today.getDate()
    : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - daysPassed);

  const spendPct = config.budget_amount > 0
    ? (currentSpend / config.budget_amount) * 100
    : 0;

  // Ideal spend: evenly distributed across month
  const idealSpend = (config.budget_amount / daysInMonth) * daysPassed;
  const pacingDelta = currentSpend - idealSpend;

  // Tolerance: within 5% of ideal = on_track
  const tolerance = config.budget_amount * 0.05;
  let pacingStatus: PacingStatus;
  if (pacingDelta > tolerance) {
    pacingStatus = "overspending";
  } else if (pacingDelta < -tolerance) {
    pacingStatus = "underspending";
  } else {
    pacingStatus = "on_track";
  }

  // Forecast end of month
  const avgSpendPerDay = daysPassed > 0 ? currentSpend / daysPassed : 0;
  const forecastTotal = currentSpend + (avgSpendPerDay * daysLeft);
  const forecastOverrun = forecastTotal - config.budget_amount;

  // Recommended daily budget for remaining days
  const recommendedDailyBudget = daysLeft > 0
    ? Math.max(0, (config.budget_amount - currentSpend) / daysLeft)
    : 0;

  return {
    spendPct: Math.round(spendPct * 10) / 10,
    pacingStatus,
    pacingDelta: Math.round(pacingDelta),
    idealSpend: Math.round(idealSpend),
    forecastTotal: Math.round(forecastTotal),
    forecastOverrun: Math.round(forecastOverrun),
    daysInMonth,
    daysPassed,
    daysLeft,
    avgSpendPerDay: Math.round(avgSpendPerDay),
    recommendedDailyBudget: Math.round(recommendedDailyBudget),
  };
}

// ─────────────────────────────────────────────
// Alert Tracking — ensure each threshold sent once/month
// ─────────────────────────────────────────────

/** Check if an alert was already sent for this config + threshold + month. */
export async function alreadySent(
  configId: string,
  threshold: number | "forecast",
  month: string
): Promise<boolean> {
  const alerts = await readAlerts();
  return alerts.some(
    (a) => a.config_id === configId && a.threshold === threshold && a.month === month
  );
}

/** Mark an alert as sent. */
export async function markSent(
  configId: string,
  threshold: number | "forecast",
  month: string
): Promise<void> {
  await withFileLock(ALERTS_FILE, async () => {
    const alerts = await readAlerts();
    alerts.push({
      config_id: configId,
      threshold,
      month,
      sent_at: new Date().toISOString(),
    });
    await writeAlerts(alerts);
  });
}

// ─────────────────────────────────────────────
// Pacing Snapshots — history for charts
// ─────────────────────────────────────────────

/** Save a pacing snapshot for today. Overwrites existing for same config+date. */
export async function savePacingSnapshot(
  configId: string,
  spent: number,
  pacing: BudgetPacing,
  budgetAmount: number
): Promise<void> {
  await withFileLock(SNAPSHOTS_FILE, async () => {
    const snapshots = await readSnapshots();
    const today = new Date().toISOString().split("T")[0];

    // Remove existing snapshot for same config+date
    const filtered = snapshots.filter(
      (s) => !(s.config_id === configId && s.date === today)
    );

    filtered.push({
      config_id: configId,
      date: today,
      spent,
      budget_amount: budgetAmount,
      spend_pct: pacing.spendPct,
      pacing_status: pacing.pacingStatus,
      forecast_total: pacing.forecastTotal,
    });

    await writeSnapshots(filtered);
  });
}

// ─────────────────────────────────────────────
// Telegram Message Builders
// ─────────────────────────────────────────────

const MONTH_NAMES_VI = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4",
  "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8",
  "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12",
];

function getMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES_VI[m - 1]} ${y}`;
}

export function buildAlertMessage(
  threshold: string,
  config: BudgetConfig,
  pacing: BudgetPacing,
  currentSpend: number
): string {
  const emoji: Record<string, string> = {
    "50%": "ℹ️",
    "80%": "⚠️",
    "95%": "🚨",
  };
  const icon = emoji[threshold] ?? "📊";
  const monthLabel = getMonthLabel(config.month);
  const platform = config.platform === "facebook" ? "Facebook" : "Google";

  return [
    `${icon} *AdsCommand Budget Alert*`,
    ``,
    `*${config.company} × ${platform}* — ${monthLabel}`,
    ``,
    `💰 Đã dùng: *${formatVND(currentSpend)}* / ${formatVND(config.budget_amount)}`,
    `📊 Tiến độ: *${pacing.spendPct.toFixed(1)}%* đã dùng`,
    `📅 Còn lại: *${pacing.daysLeft} ngày*`,
    ``,
    `📈 Dự báo cuối tháng: ${formatVND(pacing.forecastTotal)}`,
    pacing.forecastOverrun > 0
      ? `⚠️ Dự báo vượt: ${formatVND(pacing.forecastOverrun)}`
      : `✅ Trong ngân sách`,
    ``,
    `💡 Budget/ngày đề nghị còn lại: ${formatVND(pacing.recommendedDailyBudget)}/ngày`,
    ...budgetLinkLines("Xem chi tiết"),
  ].join("\n");
}

export function buildForecastWarningMessage(
  config: BudgetConfig,
  pacing: BudgetPacing,
  currentSpend: number
): string {
  const platform = config.platform === "facebook" ? "Facebook" : "Google";
  const monthLabel = getMonthLabel(config.month);

  return [
    `📉 *Cảnh báo Pace — AdsCommand*`,
    ``,
    `*${config.company} × ${platform}* — ${monthLabel}`,
    ``,
    `Bạn đang chi tiêu nhanh hơn kế hoạch.`,
    ``,
    `📊 Đã dùng: ${pacing.spendPct.toFixed(1)}%`,
    `   nhưng mới qua ${pacing.daysPassed}/${pacing.daysInMonth} ngày tháng`,
    ``,
    `🔮 Nếu giữ pace hiện tại:`,
    `   → Cuối tháng sẽ chi: *${formatVND(pacing.forecastTotal)}*`,
    `   → Vượt ngân sách: *${formatVND(pacing.forecastOverrun)}*`,
    ``,
    `💡 Để đúng ngân sách, hãy giảm xuống:`,
    `   *${formatVND(pacing.recommendedDailyBudget)}/ngày* cho ${pacing.daysLeft} ngày còn lại`,
    ...budgetLinkLines("Điều chỉnh"),
  ].join("\n");
}

/** Liên kết tới trang ngân sách của CHÍNH bản cài (APP_URL). Không biết địa chỉ → không có dòng nào. */
function budgetLinkLines(label: string): string[] {
  const url = appLink("/settings/budget");
  return url ? [``, `🔗 ${label}: ${url}`] : [];
}

// ─────────────────────────────────────────────
// VND Formatting Helpers
// ─────────────────────────────────────────────

export function formatVND(val: number): string {
  if (val >= 1_000_000_000) return `₫${(val / 1_000_000_000).toFixed(1)}Tỷ`;
  if (val >= 1_000_000) return `₫${(val / 1_000_000).toFixed(1)}Tr`;
  if (val >= 1_000) return `₫${(val / 1_000).toFixed(0)}K`;
  return `₫${Math.round(val).toLocaleString("vi-VN")}`;
}

// ─────────────────────────────────────────────
// Budget Change History
// ─────────────────────────────────────────────

/** Get budget change history, optionally filtered by month. */
export async function getBudgetChangelog(month?: string): Promise<BudgetChangeLog[]> {
  const all = await readChangelog();
  const filtered = month ? all.filter((c) => c.month === month) : all;
  // Sort newest first
  return filtered.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
}

// ─────────────────────────────────────────────
// Default configs for a new month
// ─────────────────────────────────────────────

export const DEFAULT_BUDGETS: Array<{
  company: BudgetCompany;
  platform: BudgetPlatform;
  budget_amount: number;
  label: string;
  accent: string;
}> = [
  { company: "MBC", platform: "facebook", budget_amount: 30_000_000, label: "MBC × Facebook",  accent: "blue"   },
  { company: "MBC", platform: "google",   budget_amount: 45_000_000, label: "MBC × Google",    accent: "blue"   },
  { company: "MBI", platform: "facebook", budget_amount: 20_000_000, label: "MBI × Facebook",  accent: "violet" },
  { company: "MBI", platform: "google",   budget_amount: 40_000_000, label: "MBI × Google",    accent: "violet" },
];

