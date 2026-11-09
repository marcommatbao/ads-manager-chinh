// ============================================================
// GET /api/google/keywords/performance?company=MBC&days=30
//
// Powers the "Hiệu suất từ khóa" section of the Google Automation tab,
// which has always called this route — it was never implemented, so both
// lists silently stayed empty and looked like "no keywords to act on".
//
// Real GAQL against keyword_view, reusing the exact query shape already
// proven in app/api/improvements/keywords. Classification is deterministic
// arithmetic on real metrics — nothing is generated or estimated.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { resolveMatchType } from "@/lib/google-ads-helpers";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { daysBackVN } from "@/lib/case/dates";
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// A keyword is only judged once it has spent enough to be meaningful —
// below this it is noise, not a decision.
const MIN_SPEND_TO_JUDGE = 500_000; // ₫
const MIN_CLICKS_TO_JUDGE = 20;

interface KeywordPerf {
  keyword: string;
  matchType: string;
  campaignName: string;
  campaignId: string;
  adGroupName: string;
  cost: number;
  conversions: number;
  cpl: number;
  cpc: number;
  clicks: number;
  ctr: string;
}

// Ngày theo giờ VN — bản cũ dùng toISOString() (UTC) nên 0h–7h sáng lùi mất một ngày.
function gaqlDates(daysBack: number): { from: string; to: string } {
  return daysBackVN(daysBack)
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const companyParam = (request.nextUrl.searchParams.get("company") ?? "MBC").toUpperCase();
  if (!isCompany(companyParam)) {
    return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 });
  }
  const company = companyParam as string;
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const days = Math.min(90, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 30));
  const dates = gaqlDates(days);

  try {
    const customer = getGoogleAdsCustomer(company);
    const rows: Row[] = await customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        campaign.id,
        campaign.name,
        ad_group.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions,
        metrics.average_cpc
      FROM keyword_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = false
        AND campaign.advertising_channel_type = 'SEARCH'
        AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
      LIMIT 1000
    `);

    const keywords: KeywordPerf[] = rows.map((r) => {
      const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
      const conversions = Number(r.metrics?.conversions ?? 0);
      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);
      return {
        keyword: r.ad_group_criterion?.keyword?.text ?? "",
        matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
        campaignName: r.campaign?.name ?? "",
        campaignId: String(r.campaign?.id ?? ""),
        adGroupName: r.ad_group?.name ?? "",
        cost,
        conversions,
        clicks,
        cpl: conversions > 0 ? cost / conversions : 0,
        cpc: Number(r.metrics?.average_cpc ?? 0) / 1_000_000,
        ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : "0.00",
      };
    });

    const judged = keywords.filter(
      (k) => k.cost >= MIN_SPEND_TO_JUDGE || k.clicks >= MIN_CLICKS_TO_JUDGE,
    );

    // Spent real money over the window and produced nothing.
    const shouldPause = judged
      .filter((k) => k.conversions === 0)
      .sort((a, b) => b.cost - a.cost);

    // Converting keywords, cheapest cost-per-lead first.
    const topPerformers = judged
      .filter((k) => k.conversions > 0)
      .sort((a, b) => a.cpl - b.cpl);

    return NextResponse.json({
      success: true,
      company,
      period: dates,
      data: {
        topPerformers,
        shouldPause,
        // Make the filtering visible so an empty list is never mistaken for
        // "no keywords exist".
        totalKeywords: keywords.length,
        judgedKeywords: judged.length,
        thresholds: { minSpend: MIN_SPEND_TO_JUDGE, minClicks: MIN_CLICKS_TO_JUDGE },
      },
    });
  } catch (err) {
    const message = googleAdsErrorMessage(err);
    console.error("[google/keywords/performance]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
