// ============================================================
// Google Search Ads (RSA) Client — Ads Content
// ============================================================
// Ad-level Responsive Search Ad content + spend/clicks for the
// selected month, via GAQL against ad_group_ad. Unlike PMax assets,
// RSA ad_group_ad rows DO carry real metrics.

import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "./google-ads-client";
import { convertMicros } from "./google-client";

// ── Current content of one RSA ad — for the edit modal, not the Ads
// Content list (that's RsaAsset below, which needs a date range + real
// spend/clicks). This is spend-agnostic — an ad with a low Quality Score
// this week can still have zero clicks in an arbitrary date window, and
// getRsaCreatives() would filter it out entirely (spend>0||clicks>0).
export interface RsaContent {
  adId: string;
  adResourceName: string;
  adGroupId: string;
  status: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
}

export interface RsaAsset {
  adId: string;
  adName: string;
  status: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignStartDate: string;
  campaignEndDate: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  firstActiveDate: string;
  lastActiveDate: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textAssets(list: any[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((a) => a?.text).filter((t): t is string => typeof t === "string" && t.length > 0);
}

function extractGoogleError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class GoogleSearchAdsClient {
  /**
   * Fetch RSA ad-level content + aggregated metrics for one company's
   * account, for the given date range. GAQL returns one row per
   * day per ad — this aggregates them into one row per ad.
   */
  async getRsaCreatives(
    company: string,
    dateRange: { from: string; to: string }
  ): Promise<RsaAsset[]> {
    const customer = getGoogleAdsCustomer(company);

    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        segments.date
      FROM ad_group_ad
      WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        AND segments.date BETWEEN '${dateRange.from}' AND '${dateRange.to}'
      ORDER BY segments.date
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await customer.query(query);

      const byAdId = new Map<string, RsaAsset>();

      for (const row of rows) {
        const adId = String(row.ad_group_ad?.ad?.id ?? "");
        if (!adId) continue;

        const date = row.segments?.date ?? "";
        const clicks = Number(row.metrics?.clicks ?? 0);
        const impressions = Number(row.metrics?.impressions ?? 0);
        const spend = convertMicros(Number(row.metrics?.cost_micros ?? 0));

        const existing = byAdId.get(adId);
        if (existing) {
          existing.clicks += clicks;
          existing.impressions += impressions;
          existing.spend += spend;
          if (date > existing.lastActiveDate) existing.lastActiveDate = date;
          continue;
        }

        byAdId.set(adId, {
          adId,
          adName: row.ad_group_ad?.ad?.name ?? "",
          status: row.ad_group_ad?.status ?? "UNKNOWN",
          headlines: textAssets(row.ad_group_ad?.ad?.responsive_search_ad?.headlines),
          descriptions: textAssets(row.ad_group_ad?.ad?.responsive_search_ad?.descriptions),
          finalUrls: Array.isArray(row.ad_group_ad?.ad?.final_urls) ? row.ad_group_ad.ad.final_urls : [],
          adGroupId: String(row.ad_group?.id ?? ""),
          adGroupName: row.ad_group?.name ?? "",
          campaignId: String(row.campaign?.id ?? ""),
          campaignName: row.campaign?.name ?? "",
          campaignStatus: row.campaign?.status ?? "UNKNOWN",
          // campaign.start_date/end_date are NOT recognized fields in this
          // API version — see lib/google-client.ts for the same revert.
          campaignStartDate: "",
          campaignEndDate: null,
          impressions,
          clicks,
          spend,
          ctr: 0, // recomputed below from aggregated totals
          firstActiveDate: date,
          lastActiveDate: date,
        });
      }

      const results = Array.from(byAdId.values());
      for (const r of results) {
        r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
      }

      // Only ads with spend this month, per Ads Content data scope.
      return results.filter((r) => r.spend > 0 || r.clicks > 0);
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleSearchAdsClient] getRsaCreatives[${company}] error:`, message);
      throw new Error(`Google Search Ads getRsaCreatives[${company}] failed: ${message}`);
    }
  }

  /**
   * Current content of every RSA in one ad group — regardless of recent
   * spend/clicks (see RsaContent doc comment). Powers the RSA-EDIT-1 edit
   * modal: a Quality Score problem is about the ad's CONTENT, not whether
   * it happened to get clicks in whatever date range is currently selected.
   */
  async getRsaContentForAdGroup(company: string, adGroupId: string): Promise<RsaContent[]> {
    const customer = getGoogleAdsCustomer(company);

    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.status,
        ad_group.id
      FROM ad_group_ad
      WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        AND ad_group.id = ${Number(adGroupId)}
        AND ad_group_ad.status != 'REMOVED'
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await customer.query(query);
      const customerId = GOOGLE_CUSTOMER_IDS[company];

      return rows.map((row): RsaContent => {
        const adId = String(row.ad_group_ad?.ad?.id ?? "");
        return {
          adId,
          // Ad resource names are always "customers/{customer_id}/ads/{ad_id}"
          // — stable, documented format. Constructed rather than queried:
          // ad_group_ad.ad.resource_name isn't confirmed selectable via GAQL
          // and this repo has no way to live-verify against the real API
          // before shipping, so building from the known-stable format is the
          // lower-risk choice over a field that might throw "Unrecognized
          // field" on the very first real call.
          adResourceName: `customers/${customerId}/ads/${adId}`,
          adGroupId: String(row.ad_group?.id ?? adGroupId),
          status: row.ad_group_ad?.status ?? "UNKNOWN",
          headlines: textAssets(row.ad_group_ad?.ad?.responsive_search_ad?.headlines),
          descriptions: textAssets(row.ad_group_ad?.ad?.responsive_search_ad?.descriptions),
          finalUrls: Array.isArray(row.ad_group_ad?.ad?.final_urls) ? row.ad_group_ad.ad.final_urls : [],
        };
      });
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleSearchAdsClient] getRsaContentForAdGroup[${company}][${adGroupId}] error:`, message);
      throw new Error(`Google Search Ads getRsaContentForAdGroup[${company}] failed: ${message}`);
    }
  }

  /**
   * Updates an existing RSA's headlines/descriptions in place.
   *
   * MUST go through AdService (customer.ads.update), NOT AdGroupAdService
   * (customer.adGroupAds.update) — updating
   * "ad_group_ad.ad.responsive_search_ad.headlines" via AdGroupAdService
   * throws IMMUTABLE_FIELD (confirmed against Google's own API docs/forum
   * before implementing — see docs/mini-specs/RSA-EDIT-1.md's Audit
   * section). RSAs are edited via the Ad resource directly.
   */
  async updateRsaContent(
    company: string,
    adId: string,
    headlines: string[],
    descriptions: string[]
  ): Promise<void> {
    const customer = getGoogleAdsCustomer(company);
    const customerId = GOOGLE_CUSTOMER_IDS[company];
    const resourceName = `customers/${customerId}/ads/${adId}`;

    try {
      await customer.ads.update([{
        resource_name: resourceName,
        responsive_search_ad: {
          headlines: headlines.map((text) => ({ text })),
          descriptions: descriptions.map((text) => ({ text })),
        },
      }]);
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleSearchAdsClient] updateRsaContent[${company}][${adId}] error:`, message);
      throw new Error(`Google Ads update RSA failed: ${message}`);
    }
  }
}

export const googleSearchAdsClient = new GoogleSearchAdsClient();
