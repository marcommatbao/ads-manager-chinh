import { NextRequest, NextResponse } from "next/server";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import { getCurrentUser } from "@/lib/auth";
import type { ReportData } from "@/types/ads.types";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from")!;
    const to = searchParams.get("to")!;

    const rawInsights = await googleAdsClient.getCampaignInsights({ from, to });

    const byDate = new Map<string, { spend: number; revenue: number; impressions: number; clicks: number }>();
    for (const ins of rawInsights) {
      const spend = convertMicros(ins.costMicros);
      const revenue = ins.conversionsValue;
      const existing = byDate.get(ins.date);
      if (existing) {
        existing.spend       += spend;
        existing.revenue     += revenue;
        existing.impressions += ins.impressions;
        existing.clicks      += ins.clicks;
      } else {
        byDate.set(ins.date, { spend, revenue, impressions: ins.impressions, clicks: ins.clicks });
      }
    }

    const data: ReportData[] = Array.from(byDate.entries()).map(([date, agg]) => ({
      date,
      platform: "google",
      spend:       agg.spend,
      revenue:     agg.revenue,
      impressions: agg.impressions,
      clicks:      agg.clicks,
      roas:        agg.spend > 0 ? agg.revenue / agg.spend : 0,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isNotConfigured(message)) {
      return NextResponse.json({ success: false, data: [] });
    }
    return NextResponse.json(
      { success: false, error: friendlyError(message) },
      { status: 500 }
    );
  }
}
