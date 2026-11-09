// ============================================================
// Audience Library API — List / Create / Delete
// GET  /api/audience-library
// POST /api/audience-library
// DELETE /api/audience-library?id=xxx
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getAllSegments,
  getSegmentById,
  saveSegment,
  deleteSegment,
  type AudienceSegmentRecord,
} from "@/lib/audience-tracker";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, getCompaniesForRole } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";

function err(msg: string, code = 400) {
  return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: code });
}

// ─── GET — list segments with filters ───
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company");
  const funnel = searchParams.get("funnel");
  const search = searchParams.get("search") || "";
  const sortBy = searchParams.get("sort") || "usageCount";

  const allowed = getCompaniesForRole(user);
  let segments = getAllSegments().filter((s) => allowed.includes(s.company as string));

  // Filters
  if (company && company !== "all") {
    segments = segments.filter((s) => s.company === company);
  }
  if (funnel && funnel !== "all") {
    segments = segments.filter((s) => s.funnelStage === funnel);
  }
  if (search) {
    const q = search.toLowerCase();
    segments = segments.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.product.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  // Sort
  switch (sortBy) {
    case "performance":
      segments.sort((a, b) => (a.avgCpl ?? 999999) - (b.avgCpl ?? 999999));
      break;
    case "recent":
      segments.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      break;
    case "winRate":
      segments.sort((a, b) => {
        const rateA =
          a.totalCampaigns > 0 ? a.winCount / a.totalCampaigns : 0;
        const rateB =
          b.totalCampaigns > 0 ? b.winCount / b.totalCampaigns : 0;
        return rateB - rateA;
      });
      break;
    default: // usageCount
      segments.sort((a, b) => b.usageCount - a.usageCount);
  }

  // Stats
  const totalUsages = segments.reduce((s, seg) => s + seg.usageCount, 0);
  const estimatedHoursSaved = totalUsages * 0.25; // ~15min per analysis

  return NextResponse.json({
    success: true,
    data: segments,
    summary: {
      total: segments.length,
      totalUsages,
      estimatedHoursSaved: Math.round(estimatedHoursSaved * 10) / 10,
      byFunnel: {
        TOFU: segments.filter((s) => s.funnelStage === "TOFU").length,
        MOFU: segments.filter((s) => s.funnelStage === "MOFU").length,
        BOFU: segments.filter((s) => s.funnelStage === "BOFU").length,
      },
    },
  });
}

// ─── POST — save segment from Step 2 ───
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON body");
  }

  // Map from AudienceSegment (Step 2 shape) to AudienceSegmentRecord
  const seg = body as Record<string, unknown>;
  const requestedCompany = (seg.company as string) || "MBC";
  if (!canAccessCompany(user, requestedCompany)) {
    return err("Access denied for this company", 403);
  }

  const record = saveSegment({
    name: (seg.segmentName as string) || (seg.name as string) || "Unnamed",
    company: requestedCompany,
    product: (seg.product as string) || "",
    funnelStage:
      (seg.funnelStage as "TOFU" | "MOFU" | "BOFU") || "TOFU",
    objective: (seg.objective as string) || "OUTCOME_SALES",

    demographics: (seg.demographics as AudienceSegmentRecord["demographics"]) || {
      age: "",
      gender: "",
      location: [],
      income: "",
    },
    interests:
      (seg.interests as string[]) ??
      ((seg.facebookTargeting as Record<string, unknown>)?.interests as string[]) ??
      ((seg.psychographics as Record<string, unknown>)?.interests as string[]) ??
      [],
    behaviors:
      (seg.behaviors as string[]) ??
      ((seg.facebookTargeting as Record<string, unknown>)?.behaviors as string[]) ??
      ((seg.psychographics as Record<string, unknown>)?.behaviors as string[]) ??
      [],
    jobTitles:
      (seg.jobTitles as string[]) ??
      ((seg.demographics as Record<string, unknown>)?.jobTitles as string[]) ??
      ((seg.psychographics as Record<string, unknown>)?.jobTitles as string[]) ??
      [],
    exclusions:
      (seg.exclusions as string[]) ??
      ((seg.facebookTargeting as Record<string, unknown>)?.excludeAudiences as string[]) ??
      [],
    painPoints: (seg.painPoints as string[]) ?? [],
    buyingTriggers: (seg.buyingTriggers as string[]) ?? [],
    messageHook: (seg.messageHook as string) || "",
    triggerMoment: (seg.triggerMoment as string) || "",
    estimatedSize:
      (seg.estimatedSize as string) ||
      (seg.estimatedAudienceSize as string) ||
      (seg.size as string) ||
      "",
    emotionalDriver: (seg.emotionalDriver as string) || undefined,
    recommendedTones: (seg.recommendedTones as string[]) || undefined,
    whyThisSegment: (seg.whyThisSegment as string) || undefined,
    competitionLevel: (seg.competitionLevel as "low" | "medium" | "high") || undefined,
    messagingAngle: (seg.messagingAngle as string) || undefined,
    sampleAd: seg.sampleAd as AudienceSegmentRecord["sampleAd"],

    predictedCtr: (seg.estimatedCTR as string) || "",
    predictedCpl: (seg.predictedCpl as number) || null,

    createdBy: "super_admin",
    tags: (seg.tags as string[]) ?? [],
    priority: (seg.priority as number) ?? 2,
    segmentScore: (seg.segmentScore as number) ?? 0,
  });

  return NextResponse.json({ success: true, data: record });
}

// ─── DELETE — remove segment ───
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("id is required");
  const existing = getSegmentById(id);
  if (!existing) return err("Segment not found", 404);
  if (!canAccessCompany(user, existing.company as string)) {
    return err("Access denied for this company", 403);
  }
  const ok = deleteSegment(id);
  if (!ok) return err("Segment not found", 404);
  return NextResponse.json({ success: true });
}
