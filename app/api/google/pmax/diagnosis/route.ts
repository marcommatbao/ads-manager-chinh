// GET /api/google/pmax/diagnosis?company=MBC|MBI&campaignId=X&assetGroupId=Y(optional)
// Lazy AI diagnosis — called when the user drills into a campaign or
// asset group, never on page load (Gemini calls are real cost — see
// lib/pmax-insights/diagnosis.ts's design note).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { buildCampaignOverviews, buildAssetGroupOverviews } from "@/lib/pmax-insights/build-overview";
import { generateCampaignDiagnosis, generateAssetGroupDiagnosis } from "@/lib/pmax-insights/diagnosis";
import { parsePMaxDateRange } from "@/lib/google-pmax-client";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const campaignId = req.nextUrl.searchParams.get("campaignId");
  const assetGroupId = req.nextUrl.searchParams.get("assetGroupId");
  if (!campaignId) {
    return NextResponse.json({ success: false, error: "Missing campaignId" }, { status: 400 });
  }
  const range = parsePMaxDateRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));

  try {
    const campaigns = await buildCampaignOverviews(company, range);
    const campaign = campaigns.find((c) => c.campaignId === campaignId);
    if (!campaign) {
      return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
    }

    if (assetGroupId) {
      const assetGroups = await buildAssetGroupOverviews(company, campaignId, range);
      const assetGroup = assetGroups.find((g) => g.assetGroupId === assetGroupId);
      if (!assetGroup) {
        return NextResponse.json({ success: false, error: "Asset group not found" }, { status: 404 });
      }
      const diagnosis = await generateAssetGroupDiagnosis(assetGroup, {
        campaignName: campaign.campaignName,
        scores: campaign.scores,
      });
      return NextResponse.json({ success: true, data: diagnosis });
    }

    // campaign_search_term_insight is campaign-level, not per-asset-group
    // (Google's API has no finer granularity here) — buildAssetGroupOverviews
    // already attaches the full campaign-wide category list to every asset
    // group it returns, so any one of them has the complete picture (same
    // reasoning already applied in app/api/google/pmax/drafts/route.ts).
    const assetGroupsForCategories = await buildAssetGroupOverviews(company, campaignId, range);
    // Xếp theo impressions: Google không lộ chi phí ở mức search-category
    // (xem lib/google-pmax-client.ts), nên costMicros nay là null thay vì một
    // số 0 giả khiến thứ tự sắp xếp vô nghĩa.
    const topCategories = [...(assetGroupsForCategories[0]?.searchCategories ?? [])]
      .sort((a, b) => b.impressions - a.impressions);

    const diagnosis = await generateCampaignDiagnosis(campaign, topCategories);
    return NextResponse.json({ success: true, data: diagnosis });
  } catch (err) {
    console.error("[pmax/diagnosis]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 });
  }
}
