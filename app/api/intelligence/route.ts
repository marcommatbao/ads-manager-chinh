import { NextResponse } from "next/server";
import { INTEL_COMPETITORS } from "@/lib/intelligence-config";
import { getCurrentUser } from "@/lib/auth";
import {
  getAllSWData,
  getAllFBKeywordAds,
  getAllGoogleAds,
  getAllTikTokAds,
  getAllChannelAnalysis,
  getMarketAnalysis,
  getAlerts,
  getLastSyncAt,
} from "@/lib/intelligence-store";
import { syncAllIntelligence } from "@/lib/intelligence-fetcher";
import { getSWCacheStatus } from "@/lib/similarweb";

// GET /api/intelligence — return all cached data
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const swData = getAllSWData();
  const fbAds = getAllFBKeywordAds();
  const googleAds = getAllGoogleAds();
  const tiktokAds = getAllTikTokAds();
  const analyses = getAllChannelAnalysis();
  const marketAnalysis = getMarketAnalysis();
  const alerts = getAlerts(15);
  const lastSyncAt = getLastSyncAt();
  const swCacheStatus = getSWCacheStatus();

  const competitors = INTEL_COMPETITORS.map((c) => {
    const sw = swData[c.domain];
    return {
      ...c,
      similarWeb: sw
        ? {
            ...sw,
            fetchedAt:
              sw.fetchedAt instanceof Date
                ? sw.fetchedAt.toISOString()
                : sw.fetchedAt,
          }
        : null,
      fbAds: fbAds[c.id] || [],
      googleAds: googleAds[c.domain] || null,
      tiktokAds: tiktokAds[c.id] || [],
      channelAnalysis: analyses[c.id] || null,
    };
  });

  return NextResponse.json({
    competitors,
    marketAnalysis,
    alerts,
    lastSyncAt,
    totalCompetitors: INTEL_COMPETITORS.length,
    swCacheStatus,
  });
}

// POST /api/intelligence — trigger full sync
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncAllIntelligence();

    return NextResponse.json({
      success: true,
      ...result,
      message:
        result.synced > 0
          ? `Đã sync thành công ${result.synced}/${INTEL_COMPETITORS.length} đối thủ`
          : "Không sync được đối thủ nào",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
