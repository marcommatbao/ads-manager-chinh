// ============================================================
// Ads Content — Cross-Platform Creative Aggregation
// ============================================================
// Normalizes Facebook ad creatives, Google Search RSA ads, and
// Google PMax asset groups into the unified CreativeItem shape.
// Business logic lives here (not in the route handler) so it can be
// reused/tested independently of Next.js request plumbing.

import { metaClient, type MetaAdInsightRaw, type MetaAdRaw, type MetaCampaignRaw } from "@/lib/meta-client";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import { googlePMaxClient, type PMaxAssetPerf } from "@/lib/google-pmax-client";
import { googleSearchAdsClient, type RsaAsset } from "@/lib/google-search-ads-client";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { detectCompany } from "@/lib/company-detect";
import { computeCreativeBadges } from "@/lib/ads-content/badges";
import { computeAdFatigueMap, type AdFatigueEntry } from "@/lib/ads-content/fatigue";
import type { CreativeItem, CreativeEntityStatus } from "@/types/creative-content.types";

type Company = string;
type DateRange = { from: string; to: string };

interface FetchResult {
  items: CreativeItem[];
  warnings: string[];
}

function mapMetaStatus(status: string | undefined): CreativeEntityStatus {
  switch (status) {
    case "ACTIVE": return "ACTIVE";
    case "PAUSED": return "PAUSED";
    case "ARCHIVED":
    case "DELETED": return "ARCHIVED";
    default: return "UNKNOWN";
  }
}

function mapGoogleStatus(status: string | undefined): CreativeEntityStatus {
  switch (status) {
    case "ENABLED": return "ACTIVE";
    case "PAUSED": return "PAUSED";
    case "REMOVED": return "ARCHIVED";
    default: return "UNKNOWN";
  }
}

// ── Facebook ─────────────────────────────────────────────────

async function fetchFacebookCreatives(dateRange: DateRange, companies: Company[]): Promise<FetchResult> {
  try {
    const [dailyRows, campaigns, fatigueMap] = await Promise.all([
      metaClient.getAdInsightsForAccount(dateRange),
      // Ghi log như lời gọi best-effort ngay bên dưới. Nuốt im lặng ở đây
      // khiến mọi creative mất campaignStatus/objective/ngày chạy và âm thầm
      // về "UNKNOWN" — nhìn như dữ liệu Facebook vốn thiếu.
      metaClient.getCampaigns({ limit: 500 }).catch((err): MetaCampaignRaw[] => {
        console.error("[ads-content] không lấy được danh sách campaign Facebook:", err instanceof Error ? err.message : err);
        return [];
      }),
      // Fatigue is always current-7d vs previous-7d, independent of the
      // page's selected dateRange (a fatigue check on "last January" isn't
      // meaningful) — best-effort, never blocks the main creative list.
      computeAdFatigueMap().catch((err) => {
        console.error("[AdsContent] Fatigue check failed:", err);
        return new Map<string, AdFatigueEntry>();
      }),
    ]);

    const campaignStatusById = new Map(campaigns.map((c) => [c.id, c.status]));
    const campaignObjectiveById = new Map(campaigns.map((c) => [c.id, c.objective]));
    const campaignCreatedTimeById = new Map(campaigns.map((c) => [c.id, c.created_time || c.start_time]));
    const campaignStartDateById = new Map(campaigns.map((c) => [c.id, c.start_time?.split("T")[0] ?? ""]));
    const campaignEndDateById = new Map(campaigns.map((c) => [c.id, c.stop_time ? c.stop_time.split("T")[0] : null]));

    interface Agg {
      adId: string; adName: string; campaignId: string; campaignName: string;
      spend: number; clicks: number; impressions: number; firstActiveDate: string; lastActiveDate: string;
      videoP25: number; videoThruplay: number;
    }
    const byAd = new Map<string, Agg>();

    const sumActions = (actions?: Array<{ action_type: string; value: string }>): number =>
      (actions ?? []).reduce((sum, a) => sum + Number(a.value || 0), 0);

    for (const row of dailyRows as MetaAdInsightRaw[]) {
      const spend = Number(row.spend || 0);
      const clicks = Number(row.clicks || 0);
      const impressions = Number(row.impressions || 0);
      if (spend <= 0 && clicks === 0 && impressions === 0) continue;

      const videoP25 = sumActions(row.video_p25_watched_actions);
      const videoThruplay = sumActions(row.video_thruplay_watched_actions);

      const existing = byAd.get(row.ad_id);
      const date = row.date_start;
      if (existing) {
        existing.spend += spend;
        existing.clicks += clicks;
        existing.impressions += impressions;
        existing.videoP25 += videoP25;
        existing.videoThruplay += videoThruplay;
        if (date > existing.lastActiveDate) existing.lastActiveDate = date;
        if (date < existing.firstActiveDate) existing.firstActiveDate = date;
      } else {
        byAd.set(row.ad_id, {
          adId: row.ad_id, adName: row.ad_name, campaignId: row.campaign_id, campaignName: row.campaign_name,
          spend, clicks, impressions, firstActiveDate: date, lastActiveDate: date,
          videoP25, videoThruplay,
        });
      }
    }

    const adIds = Array.from(byAd.keys());
    const ads = await metaClient.getAdsByIds(adIds);
    const adById = new Map<string, MetaAdRaw>(ads.map((a) => [a.id, a]));

    const items: CreativeItem[] = [];
    for (const agg of byAd.values()) {
      const company = detectCompany(agg.campaignName);
      if (!companies.includes(company)) continue;

      const ad = adById.get(agg.adId);
      const creative = ad?.creative;
      const linkData = creative?.object_story_spec?.link_data;
      const videoData = creative?.object_story_spec?.video_data;
      const imageUrl = creative?.thumbnail_url ?? creative?.image_url ?? linkData?.picture ?? videoData?.image_url ?? null;

      const metrics = {
        spend: agg.spend,
        clicks: agg.clicks,
        impressions: agg.impressions,
        ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
        metricsAvailable: true,
      };

      const isVideo = Boolean(videoData);
      // Hook Rate = who stopped scrolling in the first 3s (p25 of watch time
      // is Meta's closest proxy). Hold Rate = of those hooked, who stayed to
      // Thruplay (15s or full video) — only meaningful relative to p25, not impressions.
      const video = isVideo ? {
        p25: agg.videoP25,
        thruplay: agg.videoThruplay,
        hookRate: agg.impressions > 0 ? (agg.videoP25 / agg.impressions) * 100 : undefined,
        holdRate: agg.videoP25 > 0 ? (agg.videoThruplay / agg.videoP25) * 100 : undefined,
      } : undefined;

      const fatigueEntry = fatigueMap.get(agg.adId);

      items.push({
        id: `facebook:${agg.adId}`,
        nativeId: agg.adId,
        platform: "facebook",
        company,
        campaignId: agg.campaignId,
        campaignName: agg.campaignName,
        campaignObjective: campaignObjectiveById.get(agg.campaignId),
        campaignStatus: mapMetaStatus(campaignStatusById.get(agg.campaignId)),
        campaignStartDate: campaignStartDateById.get(agg.campaignId),
        campaignEndDate: campaignEndDateById.get(agg.campaignId),
        status: mapMetaStatus(ad?.status),
        name: agg.adName || ad?.name || agg.adId,
        headline: linkData?.name ?? videoData?.title ?? creative?.title,
        primaryText: linkData?.message ?? videoData?.message ?? creative?.body,
        descriptions: linkData?.description ? [linkData.description] : undefined,
        cta: linkData?.call_to_action?.type ?? videoData?.call_to_action?.type ?? creative?.call_to_action_type,
        finalUrl: linkData?.link,
        imageUrl,
        assetAvailable: Boolean(imageUrl),
        metrics,
        isVideo,
        video,
        firstActiveDate: agg.firstActiveDate,
        lastActiveDate: agg.lastActiveDate,
        badges: computeCreativeBadges({
          platform: "facebook",
          metrics,
          campaignCreatedTime: campaignCreatedTimeById.get(agg.campaignId),
          fatigue: fatigueEntry?.result,
        }),
        fatigueDetail: fatigueEntry && fatigueEntry.result.severity !== "ok" ? {
          severity: fatigueEntry.result.severity,
          issues: fatigueEntry.result.issues.map(i => ({ message: i.message, suggestion: i.suggestion })),
        } : undefined,
        raw: { subtype: "fb_ad" },
      });
    }

    return { items, warnings: [] };
  } catch (err) {
    console.error("[AdsContent] Facebook fetch failed:", err);
    return { items: [], warnings: [`facebook: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

// ── Google Search (RSA) ─────────────────────────────────────

function rsaToCreativeItem(r: RsaAsset, company: Company): CreativeItem {
  const metrics = {
    spend: r.spend,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    metricsAvailable: true,
  };

  return {
    id: `google_search:${r.adId}`,
    nativeId: r.adId,
    platform: "google_search",
    company,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    campaignObjective: "SEARCH",
    campaignStatus: mapGoogleStatus(r.campaignStatus),
    campaignStartDate: r.campaignStartDate,
    campaignEndDate: r.campaignEndDate,
    adGroupId: r.adGroupId,
    adGroupName: r.adGroupName,
    status: mapGoogleStatus(r.status),
    name: r.adName || r.headlines[0] || r.adId,
    headline: r.headlines[0],
    primaryText: r.headlines.slice(1, 3).join(" · ") || undefined,
    descriptions: r.descriptions.length ? r.descriptions : undefined,
    finalUrl: r.finalUrls[0],
    imageUrl: null,
    assetAvailable: false, // RSA is text-only, no image slot
    metrics,
    firstActiveDate: r.firstActiveDate,
    lastActiveDate: r.lastActiveDate,
    badges: computeCreativeBadges({ platform: "google_search", metrics }),
    raw: { subtype: "rsa", headlines: r.headlines, descriptions: r.descriptions },
  };
}

async function fetchGoogleSearchCreatives(dateRange: DateRange, companies: Company[]): Promise<FetchResult> {
  const settled = await Promise.allSettled(
    companies.map(async (company) => ({ company, rows: await googleSearchAdsClient.getRsaCreatives(company, dateRange) }))
  );

  const items: CreativeItem[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value.rows.map((r) => rsaToCreativeItem(r, result.value.company)));
    } else {
      warnings.push(`google_search: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }
  return { items, warnings };
}

// ── Google PMax ──────────────────────────────────────────────
// Asset-level spend/clicks are NOT exposed by the Ads API — only
// performance_label per asset. Each PMax CreativeItem represents one
// asset group (the closest analogue to "one ad"), with real spend
// coming from the parent campaign's monthly total (metricsAvailable:
// false signals the UI to show a badge instead of a per-asset number).

async function fetchPmaxCreatives(dateRange: DateRange, companies: Company[]): Promise<FetchResult> {
  // getCampaignInsights fetches BOTH MBC+MBI accounts in one call — hoist
  // it out of the per-company loop below instead of re-fetching per company.
  let dailyInsights: Awaited<ReturnType<typeof googleAdsClient.getCampaignInsights>> = [];
  try {
    dailyInsights = await googleAdsClient.getCampaignInsights(dateRange);
  } catch (err) {
    console.error("[AdsContent] PMax campaign insights fetch failed:", err);
    return { items: [], warnings: [`google_pmax: ${err instanceof Error ? err.message : String(err)}`] };
  }

  // NOTE: campaign start/end date is not available here — getCampaigns()
  // no longer requests campaign.start_date/end_date (not a recognized
  // field in this API version, broke campaign sync account-wide when
  // tried 2026-07-29). "Thời gian chạy" shows "—" for PMax campaigns.

  const settled = await Promise.allSettled(
    companies.map(async (company) => {
      const customerId = GOOGLE_CUSTOMER_IDS[company];
      if (!customerId) return { company, items: [] as CreativeItem[] };

      // Include PAUSED campaigns too — a campaign can be paused *now* but
      // still have had real spend earlier in the selected month, and the
      // data-scope rule for this page is "had spend this month", not
      // "currently enabled" (matching how Facebook/RSA already work).
      const assets = await googlePMaxClient.getAssetPerformance(customerId, { includeStatuses: ["ENABLED", "PAUSED"] });

      const pmaxCampaignIds = new Set(assets.map((a: PMaxAssetPerf) => a.campaignId));

      interface CampaignAgg { spend: number; clicks: number; impressions: number; firstActiveDate: string; lastActiveDate: string }
      const perCampaign = new Map<string, CampaignAgg>();
      for (const row of dailyInsights) {
        if (row.accountId !== customerId || !pmaxCampaignIds.has(row.campaignId)) continue;
        const spend = convertMicros(row.costMicros);
        if (spend <= 0 && row.clicks === 0) continue;
        const existing = perCampaign.get(row.campaignId) ?? { spend: 0, clicks: 0, impressions: 0, firstActiveDate: row.date, lastActiveDate: "" };
        existing.spend += spend;
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        if (row.date > existing.lastActiveDate) existing.lastActiveDate = row.date;
        if (row.date < existing.firstActiveDate) existing.firstActiveDate = row.date;
        perCampaign.set(row.campaignId, existing);
      }

      // Only campaigns with real spend/clicks this month
      const spendingCampaignIds = new Set(
        Array.from(perCampaign.entries()).filter(([, v]) => v.spend > 0 || v.clicks > 0).map(([id]) => id)
      );

      const byGroup = new Map<string, PMaxAssetPerf[]>();
      for (const asset of assets) {
        if (!spendingCampaignIds.has(asset.campaignId)) continue;
        const list = byGroup.get(asset.assetGroupId) ?? [];
        list.push(asset);
        byGroup.set(asset.assetGroupId, list);
      }

      const items: CreativeItem[] = [];
      for (const [assetGroupId, groupAssets] of byGroup) {
        const first = groupAssets[0];
        const campaignMetrics = perCampaign.get(first.campaignId);
        const headline = groupAssets.find((a) => a.fieldType === "HEADLINE")?.assetName;
        const longHeadline = groupAssets.find((a) => a.fieldType === "LONG_HEADLINE")?.assetName;
        const descriptions = groupAssets.filter((a) => a.fieldType === "DESCRIPTION").map((a) => a.assetName);
        const hasImageAsset = groupAssets.some((a) => a.fieldType === "MARKETING_IMAGE" || a.fieldType === "SQUARE_MARKETING_IMAGE");

        const metrics = {
          spend: campaignMetrics?.spend ?? 0,
          clicks: campaignMetrics?.clicks ?? 0,
          impressions: campaignMetrics?.impressions,
          metricsAvailable: false,
        };

        items.push({
          id: `google_pmax:${assetGroupId}`,
          nativeId: assetGroupId,
          platform: "google_pmax",
          company,
          campaignId: first.campaignId,
          campaignName: first.campaignName,
          campaignObjective: "PERFORMANCE_MAX",
          campaignStatus: mapGoogleStatus(first.campaignStatus),
          adGroupId: assetGroupId,
          adGroupName: first.assetName,
          status: mapGoogleStatus(first.campaignStatus),
          name: `${first.campaignName} — Asset Group`,
          headline: headline ?? longHeadline,
          primaryText: longHeadline,
          descriptions: descriptions.length ? descriptions : undefined,
          imageUrl: null, // asset image URLs require a separate `asset` resource lookup — not fetched in this pass
          assetAvailable: hasImageAsset,
          metrics,
          firstActiveDate: campaignMetrics?.firstActiveDate || dateRange.from,
          lastActiveDate: campaignMetrics?.lastActiveDate || dateRange.to,
          badges: computeCreativeBadges({ platform: "google_pmax", metrics }),
          raw: { subtype: "pmax_asset", assets: groupAssets },
        });
      }

      return { company, items };
    })
  );

  const items: CreativeItem[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
    } else {
      warnings.push(`google_pmax: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }
  return { items, warnings };
}

// ── Public entry point ──────────────────────────────────────

export async function getAdsContentItems(companies: Company[], dateRange: DateRange): Promise<FetchResult> {
  // 15/10/2026: đo từng nguồn — lần tải đầu (chưa cache) từng mất ~140 giây; log để biết nguồn nào chậm.
  const t0 = Date.now();
  const timed = <T,>(p: Promise<T>): Promise<[T, number]> => p.then((v) => [v, Date.now() - t0] as [T, number]);
  const [[fb, fbMs], [rsa, rsaMs], [pmax, pmaxMs]] = await Promise.all([
    timed(fetchFacebookCreatives(dateRange, companies)),
    timed(fetchGoogleSearchCreatives(dateRange, companies)),
    timed(fetchPmaxCreatives(dateRange, companies)),
  ]);
  console.info(`[ads-content] ${dateRange.from}→${dateRange.to} facebook ${fbMs}ms (${fb.items.length}) · google_search ${rsaMs}ms (${rsa.items.length}) · pmax ${pmaxMs}ms (${pmax.items.length})`);

  const items = [...fb.items, ...rsa.items, ...pmax.items].sort((a, b) =>
    b.lastActiveDate.localeCompare(a.lastActiveDate)
  );
  const warnings = [...fb.warnings, ...rsa.warnings, ...pmax.warnings];

  return { items, warnings };
}
