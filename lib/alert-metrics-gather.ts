// ============================================================
// Alert Engine — real metrics gather
// Builds AlertMetrics[] (lib/alert-rules.ts) from live Meta + Google
// campaign data so runAlertEngine() (lib/alert-engine.ts) has something
// real to evaluate. Before this file, runAlertEngine had zero callers
// anywhere in the codebase — CPL/fatigue/spend-spike rules existed but
// never actually ran (see docs/AUTOMATION_SIM_DESIGN.md history + commit
// this file landed in for the audit that found this).
//
// budget_low / budget_depleted are deliberately NOT populated with real
// per-campaign pacing here — lib/budget-monitor.ts already owns budget
// threshold alerting (its own Telegram channel, its own dedup store) at
// the company/month level. Duplicating that at the campaign/day level
// here would double-alert. Those two rules were removed from
// lib/alert-rules.ts's ALERT_RULES for the same reason.
//
// campaign_rejected is also NOT populated: Meta's `effective_status`
// (DISAPPROVED/WITH_ISSUES) isn't fetched by lib/nba/gather.ts's
// campaign list today, and Google Ads doesn't expose an equivalent at
// campaign level. Left as a known gap rather than faked.
// ============================================================

import { gatherCampaigns } from "@/lib/nba/gather";
import { computeAdFatigueMap } from "@/lib/ads-content/fatigue";
import type { AlertMetrics } from "@/lib/alert-rules";
import type { Campaign } from "@/types/ads.types";
import { isNotConfigured } from "@/lib/not-configured";
import { inLearning } from "@/lib/data-sufficiency";

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function dayTotals(day: string): Promise<Map<string, { spend: number; conversions: number }>> {
  const campaigns = await gatherCampaigns({ from: day, to: day });
  const map = new Map<string, { spend: number; conversions: number }>();
  for (const c of campaigns) {
    map.set(c.id, { spend: c.metrics.spend, conversions: c.metrics.conversions });
  }
  return map;
}

type FatigueLevel = NonNullable<AlertMetrics["fatigue_level"]>;

const SEVERITY_RANK: Record<string, number> = { ok: 0, warning: 1, critical: 2 };
const SEVERITY_TO_LEVEL: Record<string, FatigueLevel> = {
  ok: "healthy",
  warning: "warning",
  critical: "critical",
};

/** Worst-ad-wins rollup per campaign (Meta only — fatigue engine needs
 *  per-ad Meta insight windows that Google doesn't provide in this pipeline). */
async function fatigueByCampaign(): Promise<Map<string, { level: FatigueLevel; message: string }>> {
  const out = new Map<string, { level: FatigueLevel; message: string }>();
  let adMap: Awaited<ReturnType<typeof computeAdFatigueMap>>;
  try {
    adMap = await computeAdFatigueMap();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isNotConfigured(msg)) {
      console.warn("[alert-metrics-gather] fatigue compute failed:", msg);
    }
    return out;
  }

  for (const entry of adMap.values()) {
    const { severity, issues } = entry.result;
    if (severity === "ok") continue;
    const existing = out.get(entry.campaignId);
    if (existing && SEVERITY_RANK[existing.level === "critical" ? "critical" : existing.level === "warning" ? "warning" : "ok"] >= SEVERITY_RANK[severity]) {
      continue;
    }
    out.set(entry.campaignId, {
      level: SEVERITY_TO_LEVEL[severity],
      message: issues[0]?.message ?? "Creative đang suy giảm hiệu suất",
    });
  }
  return out;
}

function toAlertMetrics(
  c: Campaign,
  today: { spend: number; conversions: number } | undefined,
  yesterday: { spend: number; conversions: number } | undefined,
  fatigue: { level: FatigueLevel; message: string } | undefined
): AlertMetrics {
  const spend = c.metrics.spend;
  const conversions = c.metrics.conversions;
  const cpl = conversions > 0 ? spend / conversions : 0;
  const spend24h = today?.spend ?? 0;
  const conversions24h = today?.conversions ?? 0;
  const spendYesterday = yesterday?.spend ?? 0;
  const spendChangePct = spendYesterday > 0 ? ((spend24h - spendYesterday) / spendYesterday) * 100 : 0;

  const dailyBudget = c.dailyBudget ?? 0;
  const budgetRemainingPct = dailyBudget > 0
    ? Math.max(0, ((dailyBudget - spend24h) / dailyBudget) * 100)
    : 0;

  return {
    campaign_id: c.id,
    campaign_name: c.name,
    company: c.company ?? "MBC",
    spend,
    conversions,
    cpl,
    cpc: c.metrics.cpc,
    budget_total: dailyBudget,
    budget_remaining_pct: budgetRemainingPct,
    spend_24h: spend24h,
    conversions_24h: conversions24h,
    spend_change_pct: spendChangePct,
    status: c.status,
    fatigue_level: fatigue?.level,
    fatigue_message: fatigue?.message,
    learning: inLearning(c as Parameters<typeof inLearning>[0]), // Đợt 23
  };
}

/** Real AlertMetrics for every active/paused campaign — feed straight into runAlertEngine(). */
export async function gatherAlertMetrics(): Promise<AlertMetrics[]> {
  const now = new Date();
  const today = dateStr(now);
  const yesterday = dateStr(new Date(now.getTime() - 86400000));

  const [campaigns, todayMap, yesterdayMap, fatigueMap] = await Promise.all([
    gatherCampaigns(),
    dayTotals(today),
    dayTotals(yesterday),
    fatigueByCampaign(),
  ]);

  return campaigns
    .filter(c => c.status !== "ARCHIVED")
    .map(c => toAlertMetrics(c, todayMap.get(c.id), yesterdayMap.get(c.id), fatigueMap.get(c.id)));
}
