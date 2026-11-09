// GET /api/google/pmax/asset-groups?company=MBC|MBI&campaignId=X(optional)&from=&to=
// Khám phá Asset & Search Theme tab — Campaign → Asset Group → Search Category drill-down.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { buildAssetGroupOverviews } from "@/lib/pmax-insights/build-overview";
import { parsePMaxDateRange } from "@/lib/google-pmax-client";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const campaignId = req.nextUrl.searchParams.get("campaignId") || undefined;
  // This tab ignored the page's date picker entirely — its search categories
  // were always the last 30 days no matter what range was on screen.
  const range = parsePMaxDateRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));

  try {
    const assetGroups = await buildAssetGroupOverviews(company, campaignId, range);
    return NextResponse.json({ success: true, data: assetGroups });
  } catch (err) {
    console.error("[pmax/asset-groups]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 });
  }
}
