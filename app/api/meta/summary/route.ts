import { NextRequest, NextResponse } from "next/server";
import { metaClient, initMetaClient } from "@/lib/meta-client";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

function sumPurchaseValues(
  actionValues: Array<{ action_type: string; value: string }> | null
): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => a.action_type === "purchase")
    .reduce((s, a) => s + parseFloat(a.value), 0);
}

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

    const info = await initMetaClient();
    const currency = info.currency;

    const current = await metaClient.getAccountSummary({ from, to });

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
      previous = await metaClient.getAccountSummary({ from: prevFrom, to: prevTo });
    } catch {
      previous = null;
    }

    const totalSpend = parseFloat(current.spend ?? "0");
    const totalRevenue = sumPurchaseValues(current.action_values);
    const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const totalImpressions = parseInt(current.impressions ?? "0", 10);
    const totalClicks = parseInt(current.clicks ?? "0", 10);
    const avgCTR =
      totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    const activeCampaigns = (
      await metaClient.getCampaigns({ status: ["ACTIVE"] })
    ).length;

    let changes = { spend: 0, revenue: 0, roas: 0, ctr: 0, impressions: 0, clicks: 0 };
    if (previous) {
      const prevSpend = parseFloat(previous.spend ?? "0");
      const prevRevenue = sumPurchaseValues(previous.action_values);
      const prevROAS = prevSpend > 0 ? prevRevenue / prevSpend : 0;
      const prevImpressions = parseInt(previous.impressions ?? "0", 10);
      const prevClicks = parseInt(previous.clicks ?? "0", 10);
      const prevCTR =
        prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;

      changes = {
        spend:       pctChange(totalSpend, prevSpend),
        revenue:     pctChange(totalRevenue, prevRevenue),
        roas:        pctChange(avgROAS, prevROAS),
        ctr:         pctChange(avgCTR, prevCTR),
        impressions: pctChange(totalImpressions, prevImpressions),
        clicks:      pctChange(totalClicks, prevClicks),
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
      meta: { currency },
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
