import { NextRequest, NextResponse } from "next/server";
import { metaClient } from "@/lib/meta-client";
import { getCurrentUser } from "@/lib/auth";
import type { ReportData } from "@/types/ads.types";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

function sumPurchaseValues(
  actionValues: Array<{ action_type: string; value: string }> | null
): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => a.action_type === "purchase")
    .reduce((s, a) => s + parseFloat(a.value), 0);
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

    const insights = await metaClient.getAccountInsights({ from, to }, 1);

    const data: ReportData[] = insights.map((ins) => {
      const spend = parseFloat(ins.spend ?? "0");
      const revenue = sumPurchaseValues(ins.action_values);
      const impressions = parseInt(ins.impressions ?? "0", 10);
      const clicks = parseInt(ins.clicks ?? "0", 10);
      const roas = spend > 0 ? revenue / spend : 0;

      return {
        date: ins.date_start,
        platform: "facebook",
        spend,
        revenue,
        impressions,
        clicks,
        roas,
      };
    });

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
