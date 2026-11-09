// GET /api/google/toolkit/rsa?company=MBC|MBI&adGroupId=X
// Current RSA content for one ad group — powers the RSA-EDIT-1 edit modal
// opened from Quality Score Toolkit. See docs/mini-specs/RSA-EDIT-1.md.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { googleSearchAdsClient } from "@/lib/google-search-ads-client";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const adGroupId = req.nextUrl.searchParams.get("adGroupId");
  if (!adGroupId || !/^\d+$/.test(adGroupId)) {
    return NextResponse.json({ success: false, error: "Missing or invalid adGroupId" }, { status: 400 });
  }

  try {
    const ads = await googleSearchAdsClient.getRsaContentForAdGroup(company, adGroupId);
    return NextResponse.json({ success: true, data: ads });
  } catch (err) {
    console.error("[rsa GET]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 502 });
  }
}
