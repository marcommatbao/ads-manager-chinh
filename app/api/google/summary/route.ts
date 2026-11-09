import { NextRequest, NextResponse } from "next/server";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from")!;
    const to = searchParams.get("to")!;

    const current = await googleAdsClient.getAccountSummary({ from, to });

    const durationMs =
      new Date(to).getTime() - new Date(from).getTime();
    const prevTo = new Date(new Date(from).getTime() - 86400000)
      .toISOString()
      .split("T")[0];
    const prevFrom = new Date(new Date(prevTo).getTime() - durationMs)
      .toISOString()
      .split("T")[0];

    let previous = null;
    try {
      previous = await googleAdsClient.getAccountSummary({ from: prevFrom, to: prevTo });
    } catch {
      previous = null;
    }

    const totalSpend = convertMicros(current.costMicros);
    const totalRevenue = current.conversionsValue;
    const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const avgCTR = current.ctr;
    const totalImpressions = current.impressions;
    const totalClicks = current.clicks;

    const allCampaigns = await googleAdsClient.getCampaigns();
    const activeCampaigns = allCampaigns.filter((c) => c.status === "ENABLED").length;

    let changes = { spend: 0, revenue: 0, roas: 0, ctr: 0, impressions: 0, clicks: 0 };
    if (previous) {
      const prevSpend = convertMicros(previous.costMicros);
      const prevRevenue = previous.conversionsValue;
      const prevROAS = prevSpend > 0 ? prevRevenue / prevSpend : 0;

      changes = {
        spend:       pctChange(totalSpend, prevSpend),
        revenue:     pctChange(totalRevenue, prevRevenue),
        roas:        pctChange(avgROAS, prevROAS),
        ctr:         pctChange(avgCTR, previous.ctr),
        impressions: pctChange(totalImpressions, previous.impressions),
        clicks:      pctChange(totalClicks, previous.clicks),
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalSpend,
          totalRevenue,
          avgROAS,
          avgCTR,
          totalImpressions,
          totalClicks,
          activeCampaigns,
          periodLabel: `${from} → ${to}`,
        },
        changes,
        periodLabel: `${from} → ${to}`,
        previousPeriodLabel: `${prevFrom} → ${prevTo}`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isNotConfigured(message)) {
      return NextResponse.json({ success: false, data: null });
    }
    return NextResponse.json(
      { success: false, error: friendlyError(message) },
      { status: 500 }
    );
  }
}
