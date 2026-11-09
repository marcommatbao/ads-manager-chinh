// ============================================================
// Google Ads PMax Client — AdsCommand
// ============================================================
import { enums } from "google-ads-api";
import googleAdsClientInstance, { getGoogleAdsCustomer } from "./google-ads-client";
import { enumName } from "./google-ads-enums";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
export interface PMaxAssetPerf {
  assetId: string;
  assetName: string;
  fieldType: string; // HEADLINE, DESCRIPTION, LOGO, MARKETING_IMAGE...
  // Google Ads API removed asset_group_asset.performance_label (the old
  // BEST/GOOD/LOW/LEARNING/PENDING quality rating) from this resource in
  // the API version this app queries — querying it throws "Unrecognized
  // field" and silently zeroed out every PMax asset fetch. Always
  // "UNKNOWN" until this is replaced with a real reporting-view query;
  // see the primaryStatus field below for eligibility instead.
  performanceLabel: string;
  primaryStatus: string; // ELIGIBLE, PAUSED, REMOVED, PENDING, LIMITED, NOT_ELIGIBLE
  policySummary: string;
  // Campaign linkage (additive — used by Ads Content to group assets under their campaign)
  campaignId: string;
  campaignName: string;
  campaignStatus: string; // ENABLED | PAUSED | REMOVED
  assetGroupId: string;
}

export interface PMaxSearchCategory {
  campaignId: string;
  campaignName: string;
  categoryLabel: string;
  impressions: number;
  clicks: number;
  /** null = Google không lộ chi phí ở mức category này. KHÔNG phải 0 đồng. */
  costMicros: number | null;
  conversions: number;
  /** null vì không có chi phí để chia ra ROAS. */
  roas: number | null;
}

export interface PMaxChannelBreakdown {
  campaignId: string;
  campaignName: string;
  channels: Record<string, { costMicros: number; impressions: number }>;
}

export interface PMaxDateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates/defaults `from`/`to` query params into a safe PMaxDateRange.
 * Both values get string-interpolated straight into a GAQL query
 * (getCampaignMetrics) — this is the one gate standing between an
 * arbitrary query param and that interpolation, so it rejects anything
 * that isn't strictly YYYY-MM-DD (with from <= to) rather than trying to
 * sanitize. Falls back to the last 30 days, matching this page's old
 * fixed-window default.
 */
export function parsePMaxDateRange(from: string | null, to: string | null): PMaxDateRange {
  if (from && to && ISO_DATE_RE.test(from) && ISO_DATE_RE.test(to) && from <= to) {
    return { from, to };
  }
  const today = new Date();
  const toStr = today.toISOString().split("T")[0];
  const fromStr = new Date(today.getTime() - 29 * 86400000).toISOString().split("T")[0];
  return { from: fromStr, to: toStr };
}

/** Lỗi của lần gọi getAssetPerformance gần nhất — null nghĩa là đọc được. */
let lastAssetError: string | null = null;
export function getLastAssetError(): string | null { return lastAssetError; }

export interface PMaxCampaignMetrics {
  campaignId: string;
  campaignName: string;
  campaignStatus: string; // ENABLED | PAUSED | REMOVED
  // "Total" = the whole selected [from, to] range. "Recent" = the more
  // recent (roughly) half of that range — the two are non-overlapping
  // ("Recent" + "Prior" = "Total"), so trend comparisons in scoring.ts
  // never compare a window against a baseline that already contains it
  // (see scoring.ts's computeOverviewMetrics for why that matters).
  totalDays: number; recentDays: number;
  spendRecent: number; spendTotal: number;
  clicksRecent: number; clicksTotal: number;
  impressionsRecent: number; impressionsTotal: number;
  conversionsRecent: number; conversionsTotal: number;
  // "revenue" here is Google Ads' own tracked conversion value — real
  // advertiser-side tracking data, but NOT reconciled against Odoo. PMax
  // Insights has no per-campaign Odoo revenue attribution today (that's a
  // separate, not-yet-built integration — see lib/finance/company-pnl.ts,
  // which only aggregates at company level). Surfaced honestly in the UI
  // as "doanh thu ước tính theo tracking" rather than presented as
  // reconciled real revenue.
  revenueRecent: number; revenueTotal: number;
  /** Ngân sách ngày hiện tại (VND). `null` = KHÔNG đọc được — không dùng 0 thay
   *  thế, vì 0 sẽ khiến mọi phép tính "tăng bao nhiêu %" ra số vô nghĩa. */
  dailyBudgetVnd: number | null;
}

export class GooglePMaxClient {
  /**
   * Fetch asset performance labels for all PMax campaigns.
   *
   * Defaults to ENABLED campaigns only (existing behavior, relied on by
   * the PMax Insights page). Ads Content passes includeStatuses with
   * PAUSED included too — it needs assets for any campaign that had
   * spend in the selected month, regardless of the campaign's *current*
   * status (a campaign can be paused today but still have real spend
   * earlier in the month — same principle Facebook/RSA already follow,
   * where inclusion is driven by historical daily insight rows, not
   * current status).
   */
  async getAssetPerformance(
    customerId: string,
    opts?: { includeStatuses?: ("ENABLED" | "PAUSED")[] }
  ): Promise<PMaxAssetPerf[]> {
    const customer = getGoogleAdsCustomer(customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBC ? "MBC" : "MBI");
    lastAssetError = null;
    const statuses = opts?.includeStatuses ?? ["ENABLED"];
    const statusList = statuses.map((s) => `'${s}'`).join(", ");

    const query = `
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group_asset.asset,
        asset_group_asset.field_type,
        asset_group_asset.primary_status,
        asset_group_asset.policy_summary.approval_status,
        campaign.id,
        campaign.name,
        campaign.status
      FROM asset_group_asset
      WHERE asset_group.status IN (${statusList})
        AND campaign.status IN (${statusList})
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
    `;

    try {
      const rows = await customer.query(query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((row: any) => ({
        assetId: String(row.asset_group_asset?.asset ?? ""),
        assetName: row.asset_group?.name ?? "Unknown",
        fieldType: enumName(enums.AssetFieldType, row.asset_group_asset?.field_type),
        performanceLabel: "UNKNOWN",
        primaryStatus: enumName(enums.AssetLinkPrimaryStatus, row.asset_group_asset?.primary_status),
        policySummary: enumName(enums.PolicyApprovalStatus, row.asset_group_asset?.policy_summary?.approval_status),
        campaignId: String(row.campaign?.id ?? ""),
        campaignName: row.campaign?.name ?? "Unknown",
        campaignStatus: enumName(enums.CampaignStatus, row.campaign?.status),
        assetGroupId: String(row.asset_group?.id ?? ""),
      }));
    } catch (e) {
      // Trả [] ở đây từng bị hiểu nhầm thành "campaign không có asset nào":
      // computeAssetCoverage([]) sinh ra 4 lỗ hổng giả (thiếu headline,
      // description, ảnh, video), kéo Expansion Readiness của một campaign
      // perf 70 từ 85 xuống 61 — tụt dưới ngưỡng 65 nên trạng thái lật từ
      // "mở rộng được" sang "giữ hiệu quả", nút ngân sách biến mất và AI đi
      // khuyên làm lại creative không cần làm lại. Ghi lỗi ra ngoài để người
      // gọi phân biệt được "không có asset" với "không đọc được".
      lastAssetError = googleAdsErrorMessage(e);
      console.error("[PMaxClient] Error fetching asset performance:", e);
      return [];
    }
  }

  /**
   * Fetch Search Term Categories that triggered PMax
   */
  async getSearchCategories(customerId: string, range?: PMaxDateRange): Promise<PMaxSearchCategory[]> {
    const customer = getGoogleAdsCustomer(customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBC ? "MBC" : "MBI");

    // Was hardcoded to LAST_30_DAYS while campaign metrics followed the
    // page's date picker, so one recommendation card mixed two different
    // windows — "ROAS 8 ngày 6.94x" sitting next to a search-category /
    // channel split silently measured over 30 days, and the advisor prompt
    // was fed both as if they described the same period. `range` comes from
    // parsePMaxDateRange (ISO-validated), so it is safe to interpolate.
    const dateFilter = range
      ? `segments.date BETWEEN '${range.from}' AND '${range.to}'`
      : "segments.date DURING LAST_30_DAYS";

    // Google KHÔNG lộ chi phí ở mức insight-category: resource
    // campaign_search_term_insight chỉ có clicks, conversions,
    // conversions_from_interactions_rate, conversions_value, ctr, impressions,
    // search_volume. Hỏi metrics.cost_micros khiến GAQL từ chối CẢ câu, và
    // `catch → return []` bên dưới biến nó thành "không có gì" — thẻ Search
    // Categories luôn trống, nhìn như tài khoản sạch.
    // Xếp theo impressions vì đó là chỉ số quy mô CÓ THẬT ở resource này.
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign_search_term_insight.category_label,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign_search_term_insight
      WHERE ${dateFilter}
      ORDER BY metrics.impressions DESC
      LIMIT 50
    `;

    try {
      const rows = await customer.query(query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((row: any) => {
        // Không có chi phí ở resource này → null, không hạ về 0.
        const cost: number | null = null;
        void row.metrics?.conversions_value;
        return {
          campaignId: String(row.campaign?.id ?? ""),
          campaignName: row.campaign?.name ?? "Unknown",
          categoryLabel: row.campaign_search_term_insight?.category_label ?? "Unknown",
          impressions: Number(row.metrics?.impressions ?? 0),
          clicks: Number(row.metrics?.clicks ?? 0),
          costMicros: cost,
          conversions: Number(row.metrics?.conversions ?? 0),
          roas: null,
        };
      });
    } catch (e) {
      console.error("[PMaxClient] Error fetching search categories:", e);
      return [];
    }
  }

  /**
   * Real channel breakdown via segments.ad_network_type per PMax campaign,
   * over the caller's date range (defaults to the last 30 days when the
   * caller has no range of its own) — see getSearchCategories for why this
   * stopped being hardcoded.
   */
  async getChannelBreakdown(customerId: string, range?: PMaxDateRange): Promise<PMaxChannelBreakdown[]> {
    const customer = getGoogleAdsCustomer(customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBC ? "MBC" : "MBI");

    const dateFilter = range
      ? `segments.date BETWEEN '${range.from}' AND '${range.to}'`
      : "segments.date DURING LAST_30_DAYS";

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.ad_network_type,
        metrics.cost_micros,
        metrics.impressions
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND ${dateFilter}
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await customer.query(query);

      // Real Google Ads AdNetworkType enum (verified against the installed
      // google-ads-api library): UNSPECIFIED=0, UNKNOWN=1, SEARCH=2,
      // SEARCH_PARTNERS=3, CONTENT=4, MIXED=7, YOUTUBE=8, GOOGLE_TV=9,
      // GOOGLE_OWNED_CHANNELS=10, GMAIL=11, DISCOVER=12, MAPS=13 — note 5
      // and 6 don't exist. The previous hand-rolled numeric table here was
      // shifted by one for every value ≥8 (8 labeled "Google TV" when 8 is
      // really YOUTUBE, 9 labeled "Discovery" when 9 is really GOOGLE_TV,
      // etc.) — a PMax campaign genuinely spending on YouTube showed up as
      // "Google TV" in the channel breakdown. Using enumName() (the same
      // shared decoder already relied on elsewhere in this codebase)
      // instead of a hand-maintained table removes this whole class of
      // drift risk if Google adds/reorders values again.
      const NETWORK_LABELS: Record<string, string> = {
        SEARCH:                "Google Search",
        SEARCH_PARTNERS:       "Search Partners",
        CONTENT:                "Display Network",
        MIXED:                  "Mixed",
        YOUTUBE:                "YouTube",
        GOOGLE_TV:              "Google TV",
        GOOGLE_OWNED_CHANNELS:  "Google Owned Channels",
        GMAIL:                  "Gmail",
        DISCOVER:               "Discover",
        MAPS:                   "Maps",
        UNKNOWN:                "Khác",
        UNSPECIFIED:            "Không xác định",
      };

      const campaignMap: Record<string, PMaxChannelBreakdown> = {};
      for (const row of rows) {
        const id = String(row.campaign?.id ?? "");
        const name = row.campaign?.name ?? "Unknown";
        const rawNetwork = enumName(enums.AdNetworkType, row.segments?.ad_network_type);
        const network = NETWORK_LABELS[rawNetwork] ?? rawNetwork;
        const cost = Number(row.metrics?.cost_micros ?? 0);
        const impressions = Number(row.metrics?.impressions ?? 0);

        if (!campaignMap[id]) {
          campaignMap[id] = { campaignId: id, campaignName: name, channels: {} };
        }
        if (!campaignMap[id].channels[network]) {
          campaignMap[id].channels[network] = { costMicros: 0, impressions: 0 };
        }
        campaignMap[id].channels[network].costMicros += cost;
        campaignMap[id].channels[network].impressions += impressions;
      }

      return Object.values(campaignMap);
    } catch (e) {
      console.error("[PMaxClient] Error fetching channel breakdown:", e);
      return [];
    }
  }

  /**
   * Real per-campaign spend/conversions/revenue for PMax campaigns across
   * a caller-supplied date range (segmented by date, aggregated
   * client-side) — powers the Tổng quan tab's trend comparison and the
   * Performance Score in lib/pmax-insights/scoring.ts.
   *
   * "Recent" = the more recent half of the range (rounded up), "Total" =
   * the whole range — non-overlapping, so trend math never compares a
   * window against a baseline that already contains it.
   */
  async getCampaignMetrics(customerId: string, range: PMaxDateRange): Promise<PMaxCampaignMetrics[]> {
    const customer = getGoogleAdsCustomer(customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBC ? "MBC" : "MBI");

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros,
        segments.date,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND segments.date BETWEEN '${range.from}' AND '${range.to}'
    `;

    try {
      const rows = await customer.query(query);

      const fromMs = new Date(`${range.from}T00:00:00Z`).getTime();
      const toMs = new Date(`${range.to}T00:00:00Z`).getTime();
      const totalDays = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
      const recentDays = Math.max(1, Math.round(totalDays / 2));
      const recentFrom = new Date(toMs - (recentDays - 1) * 86400000).toISOString().split("T")[0];

      const map: Record<string, PMaxCampaignMetrics> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of rows as any[]) {
        const id = String(row.campaign?.id ?? "");
        if (!map[id]) {
          map[id] = {
            campaignId: id,
            campaignName: row.campaign?.name ?? "Unknown",
            campaignStatus: enumName(enums.CampaignStatus, row.campaign?.status),
            totalDays, recentDays,
            spendRecent: 0, spendTotal: 0,
            clicksRecent: 0, clicksTotal: 0,
            impressionsRecent: 0, impressionsTotal: 0,
            conversionsRecent: 0, conversionsTotal: 0,
            revenueRecent: 0, revenueTotal: 0,
            dailyBudgetVnd: null,
          };
        }
        const m = map[id];
        // Ngân sách là thuộc tính hiện tại của campaign, không phải số theo ngày
        // — mọi dòng đều mang cùng giá trị, ghi một lần là đủ.
        if (m.dailyBudgetVnd === null) {
          const micros = Number(row.campaign_budget?.amount_micros ?? 0);
          if (micros > 0) m.dailyBudgetVnd = Math.round(micros / 1_000_000);
        }
        const date: string = row.segments?.date ?? "";
        const spend = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
        const clicks = Number(row.metrics?.clicks ?? 0);
        const impressions = Number(row.metrics?.impressions ?? 0);
        const conversions = Number(row.metrics?.conversions ?? 0);
        const revenue = Number(row.metrics?.conversions_value ?? 0);

        m.spendTotal += spend; m.clicksTotal += clicks; m.impressionsTotal += impressions;
        m.conversionsTotal += conversions; m.revenueTotal += revenue;

        if (date >= recentFrom) {
          m.spendRecent += spend; m.clicksRecent += clicks; m.impressionsRecent += impressions;
          m.conversionsRecent += conversions; m.revenueRecent += revenue;
        }
      }

      return Object.values(map);
    } catch (e) {
      console.error("[PMaxClient] Error fetching campaign metrics:", e);
      return [];
    }
  }
}

export const googlePMaxClient = new GooglePMaxClient();
