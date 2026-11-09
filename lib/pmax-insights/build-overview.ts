// ─────────────────────────────────────────────
// PMax Insights 2.0 — assembles real Google Ads data into
// CampaignOverview / AssetGroupOverview, shared by the overview,
// diagnosis, and (Stage 2) advisor API routes so they never duplicate
// the fetch/aggregate logic.
// ─────────────────────────────────────────────

import { googlePMaxClient, getLastAssetError, type PMaxSearchCategory, type PMaxDateRange } from "@/lib/google-pmax-client";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { computeOverviewMetrics, computeAssetCoverage, computeScores, deriveRecommendationStatus } from "./scoring";
import type { CampaignOverview, AssetGroupOverview } from "./types";

export async function buildCampaignOverviews(company: string, range: PMaxDateRange): Promise<CampaignOverview[]> {
  const customerId = GOOGLE_CUSTOMER_IDS[company];
  if (!customerId) return [];

  const [campaignMetrics, assets, channelBreakdown] = await Promise.all([
    googlePMaxClient.getCampaignMetrics(customerId, range),
    googlePMaxClient.getAssetPerformance(customerId),
    googlePMaxClient.getChannelBreakdown(customerId, range),
  ]);

  if (campaignMetrics.length === 0) return [];

  // Portfolio-wide average ROAS for the selected range — the baseline
  // computePerformanceScore compares each campaign against, same "vs
  // account average" principle already used for CPL (lib/cpl-calculator.ts)
  // and N-Gram (avgCPA).
  const totalSpend = campaignMetrics.reduce((s, m) => s + m.spendTotal, 0);
  const totalRevenue = campaignMetrics.reduce((s, m) => s + m.revenueTotal, 0);
  const avgRoasTotal = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  // Phân biệt "không có asset" với "không đọc được asset" — hai chuyện cho ra
  // hai kết luận trái ngược về mức sẵn sàng mở rộng.
  const assetError = getLastAssetError();

  const channelByCampaign = new Map(channelBreakdown.map((cb) => [cb.campaignId, cb]));
  const assetsByCampaign = new Map<string, typeof assets>();
  for (const a of assets) {
    const list = assetsByCampaign.get(a.campaignId) ?? [];
    list.push(a);
    assetsByCampaign.set(a.campaignId, list);
  }

  return campaignMetrics.map((m) => {
    const metrics = computeOverviewMetrics(m);
    const campaignAssets = assetsByCampaign.get(m.campaignId) ?? [];
    const assetCoverage = computeAssetCoverage(campaignAssets, assetError !== null);
    const scores = computeScores(metrics, assetCoverage, avgRoasTotal);
    const recommendationStatus = deriveRecommendationStatus(scores);

    const cb = channelByCampaign.get(m.campaignId);
    const channelEntries = cb ? Object.entries(cb.channels) : [];
    const totalCost = channelEntries.reduce((s, [, v]) => s + v.costMicros, 0);
    const channelMix = channelEntries
      .map(([channel, v]) => ({
        channel, costMicros: v.costMicros, impressions: v.impressions,
        pct: totalCost > 0 ? (v.costMicros / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.costMicros - a.costMicros);

    return {
      campaignId: m.campaignId,
      campaignName: m.campaignName,
      campaignStatus: m.campaignStatus,
      metrics,
      channelMix,
      assetCoverage,
      scores,
      accountAvgRoas: Math.round(avgRoasTotal * 100) / 100,
      recommendationStatus,
      aiSummaryLine: null, // lazy — see /api/google/pmax/diagnosis
    } satisfies CampaignOverview;
  }).sort((a, b) => b.metrics.spendTotal - a.metrics.spendTotal);
}

export async function buildAssetGroupOverviews(
  company: string,
  campaignIdFilter?: string,
  range?: PMaxDateRange
): Promise<AssetGroupOverview[]> {
  const customerId = GOOGLE_CUSTOMER_IDS[company];
  if (!customerId) return [];

  // Asset coverage itself is structural (how many headlines/images exist and
  // whether they are eligible), so it carries no date range — only the search
  // categories are time-bound, and those now follow the caller's window
  // instead of always reporting the last 30 days.
  const [assets, searchCategories] = await Promise.all([
    googlePMaxClient.getAssetPerformance(customerId),
    googlePMaxClient.getSearchCategories(customerId, range),
  ]);

  const categoriesByCampaign = new Map<string, PMaxSearchCategory[]>();
  for (const c of searchCategories) {
    const list = categoriesByCampaign.get(c.campaignId) ?? [];
    list.push(c);
    categoriesByCampaign.set(c.campaignId, list);
  }

  const groupMap = new Map<string, AssetGroupOverview>();
  for (const a of assets) {
    if (campaignIdFilter && a.campaignId !== campaignIdFilter) continue;
    if (!groupMap.has(a.assetGroupId)) {
      groupMap.set(a.assetGroupId, {
        assetGroupId: a.assetGroupId,
        assetGroupName: a.assetName, // getAssetPerformance names this from asset_group.name
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        assetCoverage: computeAssetCoverage([]),
        searchCategories: categoriesByCampaign.get(a.campaignId) ?? [],
      });
    }
  }

  // Second pass — computeAssetCoverage needs the full per-group asset list,
  // not accumulated one row at a time.
  for (const group of groupMap.values()) {
    const groupAssets = assets.filter((a) => a.assetGroupId === group.assetGroupId);
    group.assetCoverage = computeAssetCoverage(groupAssets);
  }

  return Array.from(groupMap.values());
}
