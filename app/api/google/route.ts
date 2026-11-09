// ============================================================
// Google Ads API Route Handler
// GET /api/google
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import type { Campaign, ReportData } from "@/types/ads.types";
import { isNotConfigured } from "@/lib/not-configured";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Platform": "google",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ??
      new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const to = searchParams.get("to") ??
      new Date().toISOString().split("T")[0];

    const dateRange = { from, to };

    // ── Fetch campaigns + insights in parallel ──
    const [rawCampaigns, rawInsights] = await Promise.all([
      googleAdsClient.getCampaigns(),
      googleAdsClient.getCampaignInsights(dateRange),
    ]);

    // ── Map raw campaigns → Campaign type ──
    const campaigns: Campaign[] = rawCampaigns.map((c) => {
      const campaignInsights = rawInsights.filter((i) => i.campaignId === c.id);
      const totalClicks      = campaignInsights.reduce((s, i) => s + i.clicks, 0);
      const totalImpressions = campaignInsights.reduce((s, i) => s + i.impressions, 0);
      const totalCostMicros  = campaignInsights.reduce((s, i) => s + i.costMicros, 0);
      const totalConv        = campaignInsights.reduce((s, i) => s + i.conversions, 0);
      const totalRevenue     = campaignInsights.reduce((s, i) => s + i.conversionsValue, 0);
      const spend            = convertMicros(totalCostMicros);
      const ctr              = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const cpc              = totalClicks > 0 ? spend / totalClicks : 0;
      const cpm              = totalImpressions > 0 ? (spend / totalImpressions) * 1000 : 0;
      const roas             = spend > 0 ? totalRevenue / spend : 0;

      return {
        id:          c.id,
        name:        c.name,
        platform:    "google",
        status:      c.status === "ENABLED" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED",
        objective:   c.advertisingChannelType ?? "",
        dailyBudget: convertMicros(c.dailyBudgetMicros),
        totalBudget: 0,
        startDate:   c.startDate ?? from,
        endDate:     c.endDate ?? null,
        metrics: {
          impressions: totalImpressions,
          clicks:      totalClicks,
          spend,
          ctr,
          cpc,
          cpm,
          roas:        Math.round(roas * 100) / 100,
          conversions: totalConv,
          revenue:     totalRevenue,
        },
      };
    });

    // ── Map daily insights → ReportData[] ──
    // Aggregate by date across all campaigns
    const byDate = new Map<string, ReportData>();
    for (const ins of rawInsights) {
      const spend   = convertMicros(ins.costMicros);
      const revenue = ins.conversionsValue;
      const existing = byDate.get(ins.date);
      if (existing) {
        existing.spend       += spend;
        existing.revenue     += revenue;
        existing.impressions += ins.impressions;
        existing.clicks      += ins.clicks;
      } else {
        byDate.set(ins.date, { date: ins.date, platform: "google", spend, revenue, impressions: ins.impressions, clicks: ins.clicks, roas: 0 });
      }
    }
    const reportData: ReportData[] = Array.from(byDate.values()).map((r) => ({
      ...r,
      roas: r.spend > 0 ? Math.round((r.revenue / r.spend) * 100) / 100 : 0,
    }));

    return NextResponse.json(
      { campaigns, reportData },
      { headers: RESPONSE_HEADERS }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Return empty data when credentials not configured (dev mode)
    if (isNotConfigured(message)) {
      return NextResponse.json(
        { campaigns: [], reportData: [] },
        { headers: RESPONSE_HEADERS }
      );
    }

    return NextResponse.json(
      { error: `Google Ads API error: ${message}` },
      { status: 500, headers: RESPONSE_HEADERS }
    );
  }
}
