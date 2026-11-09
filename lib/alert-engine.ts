// ============================================================
// AdsCommand — Alert Engine
// Scans campaigns, evaluates rules, persists alerts to JSON
// ============================================================

import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import path from "path";
import type { Alert, AlertMetrics, RootCauseAnalysis } from "./alert-rules";
import { ALERT_RULES } from "./alert-rules";
import { generateRootCause } from "./root-cause";

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.json");

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

async function readAlerts(): Promise<Alert[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(ALERTS_FILE, "utf-8");
    return JSON.parse(raw) as Alert[];
  } catch {
    return [];
  }
}

async function writeAlerts(alerts: Alert[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

// ─────────────────────────────────────────────
// Alert Engine — Evaluate Rules
// ─────────────────────────────────────────────

import { broadcastTelegram } from "./telegram";

export async function runAlertEngine(
  campaignMetrics: AlertMetrics[]
): Promise<Alert[]> {
  const existing = await readAlerts();
  const newAlerts: Alert[] = [];
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  for (const campaign of campaignMetrics) {
    for (const rule of ALERT_RULES) {
      // Only check rules matching the campaign's company
      if (rule.company !== "ALL" && rule.company !== campaign.company) continue;

      if (rule.condition(campaign)) {
        // Dedup: skip if same type + campaign exists in last 6h
        const isDuplicate = existing.some(
          (a) =>
            a.campaign_id === campaign.campaign_id &&
            a.type === rule.type &&
            !a.is_resolved &&
            a.created_at > sixHoursAgo
        );

        if (!isDuplicate) {
          newAlerts.push({
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
            type: rule.type,
            severity: rule.severity,
            campaign_id: campaign.campaign_id,
            campaign_name: campaign.campaign_name,
            company: campaign.company,
            message: rule.message(campaign),
            metadata: {
              spend: campaign.spend,
              conversions: campaign.conversions,
              cpl: campaign.cpl,
              budget_remaining_pct: campaign.budget_remaining_pct,
              spend_24h: campaign.spend_24h,
              spend_change_pct: campaign.spend_change_pct,
            },
            is_read: false,
            is_resolved: false,
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  if (newAlerts.length > 0) {
    await withFileLock(ALERTS_FILE, async () => {
      // Re-read inside the lock — `existing` above may be stale if another
      // writer ran in between the initial read and acquiring this lock.
      const latest = await readAlerts();
      const all = [...newAlerts, ...latest];
      // Keep max 500 alerts, remove oldest first
      const capped = all.slice(0, 500);
      await writeAlerts(capped);
    });

    // --- Broadcast to Telegram if Critical or Warning ---
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (telegramChatId) {
      const actionableAlerts = newAlerts.filter(a => a.severity === "critical" || a.severity === "warning");
      
      if (actionableAlerts.length > 0) {
        const severityIcons: Record<string, string> = { critical: "🚨", warning: "⚠️" };
        
        const lines = actionableAlerts.map(a => 
          `${severityIcons[a.severity] || "🔔"} *${a.company || "Ads"}* - ${a.message}`
        );
        
        const message = `*AdsCommand Alerts* (${actionableAlerts.length})\n\n${lines.join("\n\n")}`;
        
        // Non-blocking broadcast
        broadcastTelegram([telegramChatId], message).catch(err =>
          console.error("[AlertEngine] Telegram broadcast failed", err)
        );
      }
    }

    // --- Root-cause diagnosis for new CPL alerts (best-effort, bounded) ---
    await generateRootCausesForNewAlerts(newAlerts);
  }

  return newAlerts;
}

// ─────────────────────────────────────────────
// Root-cause diagnosis attach ("vì sao CPL spike" + đề xuất fix)
// ─────────────────────────────────────────────

const CPL_ALERT_TYPES = new Set<Alert["type"]>(["cpl_critical", "cpl_warning"]);
const ROOT_CAUSE_BATCH_TIMEOUT_MS = 35_000;

/** Sinh root-cause cho các alert CPL mới tạo trong lượt quét này — không chặn alert đã ghi, có bound thời gian tổng. */
async function generateRootCausesForNewAlerts(alerts: Alert[]): Promise<void> {
  const targets = alerts.filter((a) => CPL_ALERT_TYPES.has(a.type));
  if (targets.length === 0) return;

  const work = Promise.allSettled(
    targets.map(async (alert) => {
      const analysis = await generateRootCause(alert.campaign_id);
      if (analysis) await attachRootCause(alert.id, analysis);
    })
  ).catch((err) => console.warn("[AlertEngine] root-cause batch failed:", err));

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, ROOT_CAUSE_BATCH_TIMEOUT_MS)),
  ]);
}

/** Gắn root-cause vào 1 alert theo id (dùng nội bộ sau khi tạo alert mới). */
export async function attachRootCause(alertId: string, analysis: RootCauseAnalysis): Promise<Alert | null> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    const idx = all.findIndex((a) => a.id === alertId);
    if (idx < 0) return null;
    all[idx].root_cause = analysis;
    await writeAlerts(all);
    return all[idx];
  });
}

/** Gắn root-cause vào alert CPL chưa resolve gần nhất của 1 campaign (dùng cho refresh on-demand từ UI). */
export async function attachRootCauseByCampaign(campaignId: string, analysis: RootCauseAnalysis): Promise<Alert | null> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    const candidates = all
      .filter((a) => a.campaign_id === campaignId && CPL_ALERT_TYPES.has(a.type) && !a.is_resolved)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const target = candidates[0];
    if (!target) return null;
    const idx = all.findIndex((a) => a.id === target.id);
    all[idx].root_cause = analysis;
    await writeAlerts(all);
    return all[idx];
  });
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export interface AlertFilter {
  severity?: string;
  company?: string;
  is_read?: boolean;
  is_resolved?: boolean;
  limit?: number;
}

export async function getAlerts(filter?: AlertFilter): Promise<Alert[]> {
  let alerts = await readAlerts();

  if (filter?.severity) {
    alerts = alerts.filter((a) => a.severity === filter.severity);
  }
  if (filter?.company) {
    alerts = alerts.filter((a) => a.company === filter.company);
  }
  if (filter?.is_read !== undefined) {
    alerts = alerts.filter((a) => a.is_read === filter.is_read);
  }
  if (filter?.is_resolved !== undefined) {
    alerts = alerts.filter((a) => a.is_resolved === filter.is_resolved);
  }

  // Sort by newest first
  alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (filter?.limit) {
    alerts = alerts.slice(0, filter.limit);
  }

  return alerts;
}

export async function getAlertById(id: string): Promise<Alert | null> {
  const all = await readAlerts();
  return all.find((a) => a.id === id) ?? null;
}

export async function markAlertRead(id: string): Promise<Alert | null> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) return null;

    all[idx].is_read = true;
    await writeAlerts(all);
    return all[idx];
  });
}

export async function markAllAlertsRead(companies?: string[]): Promise<number> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    let count = 0;
    for (const alert of all) {
      if (!alert.is_read) {
        if (!companies || companies.includes(alert.company)) {
          alert.is_read = true;
          count++;
        }
      }
    }
    if (count > 0) await writeAlerts(all);
    return count;
  });
}

export async function resolveAlert(
  id: string,
  note?: string
): Promise<Alert | null> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    const idx = all.findIndex((a) => a.id === id);
    if (idx < 0) return null;

    all[idx].is_resolved = true;
    all[idx].is_read = true;
    all[idx].resolved_at = new Date().toISOString();
    if (note) all[idx].resolved_note = note;

    await writeAlerts(all);
    return all[idx];
  });
}

export async function deleteAlert(id: string): Promise<boolean> {
  return withFileLock(ALERTS_FILE, async () => {
    const all = await readAlerts();
    const filtered = all.filter((a) => a.id !== id);
    if (filtered.length === all.length) return false;
    await writeAlerts(filtered);
    return true;
  });
}

export async function getUnreadCount(companies?: string[]): Promise<number> {
  const all = await readAlerts();
  return all.filter(
    (a) =>
      !a.is_read &&
      !a.is_resolved &&
      (!companies || companies.includes(a.company))
  ).length;
}
