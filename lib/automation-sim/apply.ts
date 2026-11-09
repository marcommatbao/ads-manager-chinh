// ============================================================
// Automation Sim — Apply executor (slice 2B)
// Tiêu thụ safe_for_auto_apply items → gọi Meta API (gated NBA_AUTO_APPLY).
// off | dry_run → log only. on → execute thật.
// ============================================================

import { sendTelegram } from "@/lib/telegram";
import { recordDecision } from "@/lib/decision-memory/recorder";
import type { SimulationItem, SimulationResult } from "./types";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const META_BASE = META_GRAPH_BASE;

export type ApplyMode = "off" | "dry_run" | "on";

export function getApplyMode(): ApplyMode {
  const v = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  return v === "on" ? "on" : v === "off" ? "off" : "dry_run";
}

export interface ApplyRecord {
  entityId: string;
  entityName: string;
  company: string | null;
  actionType: string;
  actionLabel: string;
  proposedChange: string;
  executed: boolean;
  dryRun: boolean;
  error?: string;
}

export interface ApplyResult {
  mode: ApplyMode;
  eligible: number;
  records: ApplyRecord[];
  simulatedAt: string;
}

async function metaPost(campaignId: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");
  const res = await fetch(`${META_BASE}/${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
  if (!data.success) throw new Error(data.error?.message ?? "Meta API error");
}

async function metaGetDailyBudget(campaignId: string): Promise<number> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return 0;
  const res = await fetch(`${META_BASE}/${campaignId}?fields=daily_budget&access_token=${token}`);
  const data = (await res.json()) as { daily_budget?: string };
  return parseFloat(data.daily_budget ?? "0") || 0;
}

async function executeItem(item: SimulationItem): Promise<{ ok: boolean; note: string }> {
  const { entityId, proposedAction, proposedValueChange } = item;
  switch (proposedAction.type) {
    case "pause_campaign":
      await metaPost(entityId, { status: "PAUSED" });
      return { ok: true, note: "Đã PAUSE" };

    case "activate_campaign":
      await metaPost(entityId, { status: "ACTIVE" });
      return { ok: true, note: "Đã ACTIVATE" };

    case "increase_budget":
    case "decrease_budget": {
      const pct = Number(proposedAction.params?.value) || 0;
      const signed = proposedAction.type === "increase_budget" ? pct : -pct;
      const current = await metaGetDailyBudget(entityId);
      if (current <= 0) return { ok: false, note: "Không lấy được daily_budget" };
      const next = Math.round(current * (1 + signed / 100));
      await metaPost(entityId, { daily_budget: String(next) });
      const fmtVnd = (v: number) => `₫${Math.round(v / 100).toLocaleString("vi-VN")}`;
      return { ok: true, note: `Budget ${fmtVnd(current)} → ${fmtVnd(next)} (${signed >= 0 ? "+" : ""}${signed}%)` };
    }

    default:
      return { ok: false, note: `Action ${proposedAction.type} không hỗ trợ auto-execute` };
  }
}

export async function applySimulationResult(result: SimulationResult): Promise<ApplyResult> {
  const mode = getApplyMode();
  const eligible = result.items.filter(i => i.simulationStatus === "safe_for_auto_apply");
  const records: ApplyRecord[] = [];

  for (const item of eligible) {
    const vc = item.proposedValueChange;
    const proposedChange = vc
      ? `${vc.fromValue.toLocaleString("vi-VN")} → ${vc.toValue.toLocaleString("vi-VN")} (${vc.deltaPct >= 0 ? "+" : ""}${vc.deltaPct}%)`
      : item.proposedAction.label;

    if (mode === "off") {
      records.push({ entityId: item.entityId, entityName: item.entityName, company: item.company, actionType: item.proposedAction.type, actionLabel: item.proposedAction.label, proposedChange, executed: false, dryRun: false, error: "NBA_AUTO_APPLY=off" });
      continue;
    }

    if (mode === "dry_run") {
      console.log(`[AutoSim/apply] DRY_RUN: ${item.proposedAction.label} campaign "${item.entityName}" (${item.entityId})`);
      records.push({ entityId: item.entityId, entityName: item.entityName, company: item.company, actionType: item.proposedAction.type, actionLabel: item.proposedAction.label, proposedChange, executed: false, dryRun: true });
      continue;
    }

    // mode === "on" → execute
    try {
      const { ok, note } = await executeItem(item);
      records.push({ entityId: item.entityId, entityName: item.entityName, company: item.company, actionType: item.proposedAction.type, actionLabel: item.proposedAction.label, proposedChange, executed: ok, dryRun: false, error: ok ? undefined : note });
      console.log(`[AutoSim/apply] ${ok ? "✅" : "❌"} ${item.entityName}: ${note}`);
      if (ok) {
        const dmEvent = item.proposedAction.type === "pause_campaign"    ? "campaign.pause"
                      : item.proposedAction.type === "activate_campaign" ? "campaign.resume"
                      : item.proposedAction.type === "increase_budget"   ? "budget.increase"
                      : item.proposedAction.type === "decrease_budget"   ? "budget.decrease"
                      : "automation.rule_applied" as const;
        recordDecision({
          source:   { type: "automation_rule", ruleId: result.ruleId ?? "unknown", ruleName: result.ruleName, platform: "meta" },
          event:    dmEvent,
          action:   { field: item.proposedAction.type, notes: note, ...(item.proposedValueChange ? { deltaPercent: item.proposedValueChange.deltaPct } : {}) },
          target:   { company: (item.company ?? "MBC") as string, platform: "meta", entityType: "campaign", entityId: item.entityId, entityName: item.entityName },
          rationale: item.proposedAction.label,
          links:    { automationRunId: result.simulatedAt },
        }).catch(() => {/* non-blocking */});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      records.push({ entityId: item.entityId, entityName: item.entityName, company: item.company, actionType: item.proposedAction.type, actionLabel: item.proposedAction.label, proposedChange, executed: false, dryRun: false, error: msg });
      console.error(`[AutoSim/apply] Error on ${item.entityName}:`, msg);
    }
  }

  await sendTelegramSummary(result.ruleName, mode, records);

  return { mode, eligible: eligible.length, records, simulatedAt: result.simulatedAt };
}

async function sendTelegramSummary(ruleName: string, mode: ApplyMode, records: ApplyRecord[]): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const executed = records.filter(r => r.executed).length;
  const dryRun = records.filter(r => r.dryRun).length;
  const failed = records.filter(r => !r.executed && !r.dryRun && r.error && r.error !== "NBA_AUTO_APPLY=off").length;

  const modeLabel = mode === "on" ? "🟢 LIVE" : mode === "dry_run" ? "🟡 DRY-RUN" : "🔴 OFF";
  const header = `⚡ *AutoSim Apply* — Rule: ${ruleName}\nMode: ${modeLabel} | Eligible: ${records.length} | Executed: ${executed} | Dry: ${dryRun} | Failed: ${failed}`;

  const lines = records.map(r => {
    const icon = r.executed ? "✅" : r.dryRun ? "💤" : "❌";
    return `${icon} [${r.company ?? "?"}] ${r.entityName}\n    ${r.actionLabel}: ${r.proposedChange}${r.error ? `\n    ⚠️ ${r.error}` : ""}`;
  });

  await sendTelegram(chatId, [header, ...lines].join("\n\n"));
}
