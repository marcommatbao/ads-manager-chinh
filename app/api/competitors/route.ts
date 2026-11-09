import { NextRequest, NextResponse } from "next/server";
import {
  getCompetitors,
  getAllAds,
  getAdsByCompetitor,
  getAdCounts,
  addCompetitor,
  removeCompetitor,
  getLatestInsight,
} from "@/lib/competitor-store";
import { extractFBPageId } from "@/lib/competitor-config";
import { getCurrentUser } from "@/lib/auth";

// GET /api/competitors
// ?id=pa          → ads for specific competitor
// ?summary=true   → just competitor list + counts
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const summary = searchParams.get("summary");
  const angle = searchParams.get("angle");
  const activeOnly = searchParams.get("activeOnly") !== "false";
  const dateRange = searchParams.get("dateRange") || "30d";

  const competitors = getCompetitors();
  const counts = getAdCounts();

  if (summary === "true") {
    return NextResponse.json({
      competitors: competitors.map((c) => ({
        ...c,
        adCount: counts[c.id]?.total || 0,
        newAds7d: counts[c.id]?.new7d || 0,
      })),
    });
  }

  // Get ads
  let ads = id ? getAdsByCompetitor(id) : getAllAds();

  // Filters
  if (activeOnly) {
    ads = ads.filter((a) => a.isActive);
  }
  if (angle && angle !== "all") {
    ads = ads.filter((a) => a.aiAngle === angle);
  }

  // Date range filter
  const now = Date.now();
  if (dateRange === "7d") {
    ads = ads.filter((a) => a.fetchedAt && now - new Date(a.fetchedAt).getTime() < 7 * 86400000);
  } else if (dateRange === "30d") {
    ads = ads.filter((a) => a.fetchedAt && now - new Date(a.fetchedAt).getTime() < 30 * 86400000);
  }

  // Sort by fetchedAt desc
  ads.sort((a, b) => (b.fetchedAt || "").localeCompare(a.fetchedAt || ""));

  // Get latest insight
  const insight = getLatestInsight(id || "all");

  return NextResponse.json({
    competitors: competitors.map((c) => ({
      ...c,
      adCount: counts[c.id]?.total || 0,
      newAds7d: counts[c.id]?.new7d || 0,
    })),
    ads,
    insight,
    totalAds: ads.length,
    lastSyncAt: new Date().toISOString(),
  });
}

// POST /api/competitors — add new competitor
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, domain, fbPageUrl, category, trackingFor } = body;

    if (!name || !domain) {
      return NextResponse.json({ error: "Tên và domain là bắt buộc" }, { status: 400 });
    }

    const fbPageId = fbPageUrl ? extractFBPageId(fbPageUrl) : "";

    const comp = await addCompetitor({
      name,
      domain,
      fbPageId,
      category: category || "general",
      trackingFor: trackingFor || ["MBC"],
    });

    return NextResponse.json({ success: true, competitor: comp });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE /api/competitors?id=xxx
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const removed = await removeCompetitor(id);
  return NextResponse.json({ success: removed });
}
