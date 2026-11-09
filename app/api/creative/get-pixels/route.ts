import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
// Real Pixel IDs (not fabricated), used as a fallback ONLY when the live
// /adspixels fetch fails or env vars are missing — `source` tells the
// caller this is a known-pixels fallback, not a fresh fetch. Lives in
// lib/meta-client.ts (single source of truth also used by
// resolveCompanyPixelId(), which app/api/audiences/create-website-audience
// depends on) so the two never drift apart.
import { FALLBACK_PIXELS } from "@/lib/meta-client";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) {
    return NextResponse.json({ pixels: FALLBACK_PIXELS, source: "fallback" });
  }
  try {
    const res = await fetch(`${META_GRAPH_BASE}/act_${adAccountId}/adspixels?fields=id,name&access_token=${token}`);
    const data = await res.json();
    if (data.data?.length > 0) {
      return NextResponse.json({
        pixels: data.data.map((p: {id: string; name: string}) => ({ id: p.id, name: p.name })),
        source: "live",
      });
    }
    console.warn("[creative/get-pixels] /adspixels returned no pixels — using fallback list");
  } catch (err) {
    console.warn("[creative/get-pixels] /adspixels fetch failed — using fallback list:", err);
  }
  return NextResponse.json({ pixels: FALLBACK_PIXELS, source: "fallback" });
}
