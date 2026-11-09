// GET  /api/google/pmax/drafts?company=MBC|MBI — list draft actions
// POST /api/google/pmax/drafts — generate a new draft (search_themes | creative_brief)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { buildCampaignOverviews, buildAssetGroupOverviews } from "@/lib/pmax-insights/build-overview";
import { generateDraftSearchThemes, generateDraftCreativeBrief } from "@/lib/pmax-insights/draft-actions";
import { addDraftAction, getDraftActions, updateRecommendationState, getRecommendationById } from "@/lib/pmax-insights/store";
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

  const drafts = await getDraftActions(company);
  return NextResponse.json({ success: true, data: drafts });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const company = pickCompany(body.company);
  const type = body.type as "search_themes" | "creative_brief";
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;
  const assetGroupId = typeof body.assetGroupId === "string" ? body.assetGroupId : null;
  const recommendationId = typeof body.recommendationId === "string" ? body.recommendationId : null;
  // The page sends the range the recommendation was scored on, so a draft
  // never proposes search themes measured over a period the card the user
  // clicked never looked at. Falls back to the last 30 days when absent.
  const range = parsePMaxDateRange(
    typeof body.from === "string" ? body.from : null,
    typeof body.to === "string" ? body.to : null,
  );

  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  if (!campaignId || (type !== "search_themes" && type !== "creative_brief")) {
    return NextResponse.json({ success: false, error: "Missing campaignId or invalid type" }, { status: 400 });
  }

  try {
    const campaigns = await buildCampaignOverviews(company, range);
    const campaign = campaigns.find((c) => c.campaignId === campaignId);
    if (!campaign) return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });

    let content;
    if (type === "search_themes") {
      // campaign_search_term_insight is campaign-level, not per-asset-group
      // (Google's API has no finer granularity here) — build-overview.ts
      // attaches the same campaign-wide list to every asset group in that
      // campaign, so any one group's list already has the full picture;
      // no need to merge/dedupe across groups.
      const assetGroups = await buildAssetGroupOverviews(company, campaignId, range);
      const categories = assetGroupId
        ? assetGroups.find((g) => g.assetGroupId === assetGroupId)?.searchCategories ?? []
        : assetGroups[0]?.searchCategories ?? [];
      content = await generateDraftSearchThemes(campaign, categories);
    } else {
      const assetGroups = await buildAssetGroupOverviews(company, campaignId, range);
      const assetGroup = assetGroupId ? assetGroups.find((g) => g.assetGroupId === assetGroupId) ?? null : null;
      content = await generateDraftCreativeBrief(campaign, assetGroup);
    }

    const draft = await addDraftAction({
      company,
      recommendationId,
      type,
      content,
      createdBy: user.email,
    });

    if (recommendationId) {
      const rec = await getRecommendationById(recommendationId);
      if (rec && rec.company === company) {
        await updateRecommendationState(recommendationId, "drafted", user.email);
      }
    }

    return NextResponse.json({ success: true, data: draft });
  } catch (err) {
    console.error("[pmax/drafts POST]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 });
  }
}
