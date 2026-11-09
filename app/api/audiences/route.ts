// ============================================================
// GET /api/audiences?company=MBC&limit=30
//
// Segment picker feed for the Creative Brief builder, which has always
// called this route — it was never implemented, so step 2 of the wizard
// showed an empty segment list with no error and users had to describe
// the audience by hand every time.
//
// Reads the real Audience Library (lib/audience-tracker), the same store
// the /audiences page manages, and maps each saved record into the
// AudienceSegment shape the brief builder consumes. Nothing is invented:
// fields the library does not track are simply omitted.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { getAllSegments, type AudienceSegmentRecord } from "@/lib/audience-tracker";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function toBriefSegment(r: AudienceSegmentRecord, priority: number) {
  return {
    segmentName: r.name,
    size: r.estimatedSize ?? "",
    priority,
    funnelStage: r.funnelStage,
    demographics: {
      age: r.demographics?.age ?? "",
      gender: r.demographics?.gender ?? "",
      location: r.demographics?.location ?? [],
      income: r.demographics?.income ?? "",
      jobTitles: r.demographics?.jobTitles ?? r.jobTitles ?? [],
    },
    psychographics: {
      interests: r.interests ?? [],
      behaviors: r.behaviors ?? [],
      jobTitles: r.jobTitles ?? [],
    },
    facebookTargeting: {
      interests: r.interests ?? [],
      behaviors: r.behaviors ?? [],
      jobTitles: r.jobTitles ?? [],
      excludeAudiences: r.exclusions ?? [],
    },
    estimatedAudienceSize: r.estimatedSize ?? undefined,
    painPoints: r.painPoints ?? [],
    buyingTriggers: r.buyingTriggers ?? [],
    messageHook: r.messageHook ?? undefined,
    // Real measured performance, not a prediction — null when the segment
    // has not run yet, so the UI can tell "untested" from "performed badly".
    performance: {
      totalCampaigns: r.totalCampaigns ?? 0,
      avgCpl: r.avgCpl ?? null,
      avgCtr: r.avgCtr ?? null,
    },
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const allowed = getCompaniesForRole(user);
  const companyParam = request.nextUrl.searchParams.get("company");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || DEFAULT_LIMIT),
  );

  if (companyParam && companyParam !== "all" && !allowed.includes(companyParam as string)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    let segments = getAllSegments().filter((s) => allowed.includes(s.company as string));
    if (companyParam && companyParam !== "all") {
      segments = segments.filter((s) => s.company === companyParam);
    }

    // Proven segments first: ones that actually ran, cheapest CPL first,
    // then everything untested.
    const proven = segments
      .filter((s) => (s.totalCampaigns ?? 0) > 0 && s.avgCpl !== null && s.avgCpl !== undefined)
      .sort((a, b) => (a.avgCpl as number) - (b.avgCpl as number));
    const untested = segments.filter((s) => !proven.includes(s));

    const ordered = [...proven, ...untested].slice(0, limit);

    return NextResponse.json({
      success: true,
      data: {
        segments: ordered.map((r, i) => toBriefSegment(r, i + 1)),
        total: segments.length,
        returned: ordered.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không đọc được thư viện đối tượng";
    console.error("[audiences]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
