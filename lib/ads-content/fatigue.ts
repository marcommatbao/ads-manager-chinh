// ============================================================
// Ads Content — Creative Fatigue Detection
// ============================================================
// Wires the real, already-built lib/ad-fatigue-engine.ts (frequency +
// CTR-drop rules) into real per-ad Meta data — the engine existed but had
// zero callers anywhere in this codebase before this. Facebook only: this
// needs true per-ad daily/window insight data, which only exists for
// Facebook in this pipeline (same precedent already set by
// lib/ads-content/badges.ts's Learning badge).

import { metaClient, type MetaAdInsightRaw } from "@/lib/meta-client";
import { detectCompany } from "@/lib/company-detect";
import { checkAdFatigue, type FatigueResult } from "@/lib/ad-fatigue-engine";

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function conversions(row: MetaAdInsightRaw): number {
  return (row.actions ?? [])
    .filter(a => a.action_type === "lead" || a.action_type === "purchase")
    .reduce((s, a) => s + parseFloat(a.value), 0);
}

interface WindowAgg {
  spend: number;
  clicks: number;
  impressions: number;
  frequency: number;
  conversions: number;
  campaignId: string;
  campaignName: string;
}

function toWindowMap(rows: MetaAdInsightRaw[]): Map<string, WindowAgg> {
  const map = new Map<string, WindowAgg>();
  for (const row of rows) {
    // level=ad + no time_increment → one row per ad already; still guard
    // against an unexpected duplicate by summing rather than overwriting.
    const existing = map.get(row.ad_id);
    const agg: WindowAgg = existing ?? {
      spend: 0, clicks: 0, impressions: 0, frequency: 0, conversions: 0,
      campaignId: row.campaign_id, campaignName: row.campaign_name,
    };
    agg.spend += Number(row.spend || 0);
    agg.clicks += Number(row.clicks || 0);
    agg.impressions += Number(row.impressions || 0);
    agg.frequency = Number(row.frequency || agg.frequency); // window value, not summable
    agg.conversions += conversions(row);
    map.set(row.ad_id, agg);
  }
  return map;
}

export interface AdFatigueEntry {
  result: FatigueResult;
  campaignId: string;
  campaignName: string;
}

/** Real fatigue check per ad, current-7d vs previous-7d Meta window
 * aggregates. Returns only ads with enough current-window activity to
 * evaluate (spend or clicks > 0) — ads with zero recent activity have
 * nothing to "refresh". */
export async function computeAdFatigueMap(): Promise<Map<string, AdFatigueEntry>> {
  const now = new Date();
  const currentFrom = dateStr(new Date(now.getTime() - 7 * 86400000));
  const currentTo = dateStr(now);
  const prevFrom = dateStr(new Date(now.getTime() - 14 * 86400000));
  const prevTo = currentFrom;

  const [currentRows, prevRows] = await Promise.all([
    metaClient.getAdInsightsWindowAggregate({ from: currentFrom, to: currentTo }),
    metaClient.getAdInsightsWindowAggregate({ from: prevFrom, to: prevTo }),
  ]);

  const current = toWindowMap(currentRows);
  const previous = toWindowMap(prevRows);

  const result = new Map<string, AdFatigueEntry>();
  for (const [adId, cur] of current.entries()) {
    if (cur.spend <= 0 && cur.clicks === 0) continue;

    const company = detectCompany(cur.campaignName);
    const prev = previous.get(adId);

    const ctrCurrent = cur.impressions > 0 ? (cur.clicks / cur.impressions) * 100 : 0;
    const ctrPrevious = prev && prev.impressions > 0 ? (prev.clicks / prev.impressions) * 100 : 0;
    const cplCurrent = cur.conversions > 0 ? cur.spend / cur.conversions : 0;
    const cplPrevious = prev && prev.conversions > 0 ? prev.spend / prev.conversions : 0;

    const fatigue = checkAdFatigue({
      frequency: cur.frequency,
      ctrCurrent,
      ctrPrevious,
      cplCurrent,
      cplPrevious,
      spend: cur.spend,
      company,
    });

    result.set(adId, { result: fatigue, campaignId: cur.campaignId, campaignName: cur.campaignName });
  }

  return result;
}
