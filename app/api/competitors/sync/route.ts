// POST /api/competitors/sync
// Real Facebook Ad Library sync via Apify (page-ID based) — this route
// never existed; the "Sync từ FB Ad Library" button 404'd silently for
// every competitor, always re-rendering stale data with no error shown.
//
// Actor + input shape verified live against the real Apify API before
// shipping (an earlier draft guessed a different actor name/input shape
// that turned out not to exist — 404 from Apify, would have silently
// failed the same way as the original bug). apify/facebook-ads-scraper is
// Apify's own official actor (12M+ runs), input is a Meta Ad Library
// search URL per page, not a keyword or raw page-ID param list.
import { NextResponse } from "next/server";
import { getCompetitors, upsertAd } from "@/lib/competitor-store";
import { getCurrentUser } from "@/lib/auth";
import type { CompetitorAd } from "@/lib/competitor-config";

const APIFY_ACTOR = "apify~facebook-ads-scraper";
const RESULTS_LIMIT_PER_PAGE = 30;

interface RawApifyCard {
  body?: string;
  title?: string | null;
  linkDescription?: string | null;
}

interface RawApifyAd {
  adArchiveId?: string;
  adId?: string;
  isActive?: boolean;
  startDateFormatted?: string;
  endDateFormatted?: string;
  // Meta's Ad Library API only exposes spend/impressions/targeting
  // demographics for political/social-issue ads — null for standard
  // commercial ads (confirmed live: every field below was null/absent for
  // a real Mắt Bão ad). Left honestly null rather than guessed.
  spend?: { lowerBound?: number; upperBound?: number } | null;
  impressionsWithIndex?: { impressionsText?: string } | null;
  snapshot?: {
    cards?: RawApifyCard[];
    body?: { text?: string } | string | null;
    linkUrl?: string | null;
  };
}

function buildAdLibraryUrl(pageId: string): string {
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: "VN",
    is_targeted_country: "false",
    search_type: "page",
    view_all_page_id: pageId,
  });
  return `https://www.facebook.com/ads/library/?${params}`;
}

async function fetchAdsForPage(pageId: string, token: string): Promise<RawApifyAd[]> {
  const input = {
    startUrls: [{ url: buildAdLibraryUrl(pageId) }],
    resultsLimit: RESULTS_LIMIT_PER_PAGE,
  };
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { success: false, error: "APIFY_API_TOKEN chưa được cấu hình — không thể đồng bộ FB Ad Library" },
      { status: 500 }
    );
  }

  const competitors = getCompetitors().filter((c) => c.isActive && c.fbPageId);
  if (competitors.length === 0) {
    return NextResponse.json(
      { success: false, error: "Chưa có đối thủ nào có Facebook Page ID để đồng bộ" },
      { status: 400 }
    );
  }

  let totalSynced = 0;
  const errors: string[] = [];

  for (const comp of competitors) {
    try {
      const rawAds = await fetchAdsForPage(comp.fbPageId, token);
      const now = new Date().toISOString();

      for (const raw of rawAds) {
        const fbAdId = String(raw.adArchiveId ?? raw.adId ?? "");
        if (!fbAdId) continue;

        const card = raw.snapshot?.cards?.[0];
        const bodyText = card?.body
          ?? (typeof raw.snapshot?.body === "string" ? raw.snapshot.body : raw.snapshot?.body?.text)
          ?? null;

        const ad: CompetitorAd = {
          id: `${comp.id}-${fbAdId}`,
          fbAdId,
          competitorId: comp.id,
          competitorName: comp.name,
          primaryText: bodyText,
          headline: card?.title ?? null,
          description: card?.linkDescription ?? null,
          snapshotUrl: `https://www.facebook.com/ads/library/?id=${fbAdId}`,
          // Not available from Meta's Ad Library API for standard
          // commercial ads (only political/social-issue ads expose this).
          targetAges: null,
          targetGender: null,
          languages: [],
          spendMin: raw.spend?.lowerBound ?? null,
          spendMax: raw.spend?.upperBound ?? null,
          impressionsMin: null,
          impressionsMax: null,
          startDate: raw.startDateFormatted ?? null,
          stopDate: raw.endDateFormatted ?? null,
          isActive: raw.isActive ?? true,
          // AI classification (aiHook/aiAngle/aiScore/aiInsight) is a
          // separate concern this sync doesn't run — left honestly null
          // (unanalyzed) rather than fabricated. The UI already handles
          // this state (only renders angle/hook badges when present).
          aiHook: null,
          aiAngle: null,
          aiScore: null,
          aiInsight: null,
          analyzedAt: null,
          fetchedAt: now,
        };
        await upsertAd(ad);
        totalSynced++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${comp.name}: ${message}`);
    }
  }

  return NextResponse.json({
    success: totalSynced > 0 || errors.length === 0,
    totalSynced,
    competitorsChecked: competitors.length,
    errors,
  });
}
