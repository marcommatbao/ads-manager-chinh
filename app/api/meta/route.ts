// ============================================================
// Meta (Facebook) Graph API Route Handler
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { metaClient } from "@/lib/meta-client";
import type { Campaign, ReportData } from "@/types/ads.types";
import { getCurrentUser } from "@/lib/auth";
import { isNotConfigured } from "@/lib/not-configured";

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

    // ── Fetch in parallel ──
    const [rawCampaigns, dailyInsights] = await Promise.all([
      metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED", "ARCHIVED"] }),
      metaClient.getAccountInsights(dateRange, 1),
    ]);

    // ── Map raw campaigns → Campaign type ──
    const campaigns: Campaign[] = rawCampaigns.map((c) => ({
      id:          c.id,
      name:        c.name,
      platform:    "facebook",
      status:      (c.status === "ACTIVE" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED"),
      objective:   c.objective ?? "",
      dailyBudget: parseInt(c.daily_budget ?? "0", 10), // raw value — division handled in formatCurrency
      totalBudget: parseInt(c.lifetime_budget ?? "0", 10), // raw value — division handled in formatCurrency
      startDate:   c.start_time?.split("T")[0] ?? from,
      endDate:     c.stop_time ? c.stop_time.split("T")[0] : null,
      metrics: {
        impressions: 0,
        clicks:      0,
        spend:       0,
        ctr:         0,
        cpc:         0,
        cpm:         0,
        roas:        0,
        conversions: 0,
        revenue:     0,
      },
    }));

    // ── Map daily insights → ReportData[] ──
    const reportData: ReportData[] = dailyInsights.map((ins) => {
      const spend   = parseFloat(ins.spend ?? "0");
      const revenue = ins.action_values
        ?.filter((a) => a.action_type === "purchase")
        .reduce((s, a) => s + parseFloat(a.value), 0) ?? 0;

      return {
        date:        ins.date_start,
        platform:    "facebook",
        spend,
        revenue,
        roas:        spend > 0 ? revenue / spend : 0,
        impressions: parseInt(ins.impressions ?? "0", 10),
        clicks:      parseInt(ins.clicks ?? "0", 10),
      };
    });

    return NextResponse.json({ campaigns, reportData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Return empty data if credentials not configured (dev mode)
    if (isNotConfigured(message)) {
      return NextResponse.json({ campaigns: [], reportData: [] });
    }
    return NextResponse.json(
      { error: `Meta API error: ${message}` },
      { status: 500 }
    );
  }
}
