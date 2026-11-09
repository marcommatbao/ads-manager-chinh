// GET /api/policy-radar/source-health — registered sources + curated-item counts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { POLICY_RADAR_SOURCES } from "@/lib/policy-radar/source-registry";
import { getAllItems } from "@/lib/policy-radar/store";
import { getLastScanAt } from "@/lib/policy-radar/scanner";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const [items, lastSyncAt] = await Promise.all([getAllItems(), getLastScanAt()]);
  const data = POLICY_RADAR_SOURCES.map((source) => ({
    ...source,
    itemCount: items.filter((i) => i.platform === source.platform && i.sourceUrl.startsWith(new URL(source.url).origin)).length,
  }));

  return NextResponse.json({
    success: true,
    data,
    // Slice 2 (2026-07-28): the autoFetchable sources (currently the 2
    // Google Ads ones) are scanned by cron/policy-radar-scan — "hybrid"
    // reflects that Meta's sources still require manual entry (their pages
    // return an empty JS-rendered shell, no headless browser in this app).
    syncMode: "hybrid",
    lastSyncAt,
  });
}
