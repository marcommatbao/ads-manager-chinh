// GET /api/google/pmax/overview?company=MBC|MBI
// Tổng quan tab — real campaign metrics, deterministic scores, no AI calls
// (AI summary line is lazy — see /api/google/pmax/diagnosis).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { buildCampaignOverviews } from "@/lib/pmax-insights/build-overview";
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
  const range = parsePMaxDateRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));

  try {
    const campaigns = await buildCampaignOverviews(company, range);
    return NextResponse.json({ success: true, data: campaigns });
  } catch (err) {
    console.error("[pmax/overview]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 });
  }
}
