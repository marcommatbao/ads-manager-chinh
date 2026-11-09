// ============================================================
// Record Campaign Performance for an Audience Segment
// POST /api/audience-library/[id]/performance
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordCampaignUsage, getSegmentById } from "@/lib/audience-tracker";
import { canAccessCompany } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";

function err(msg: string, code = 400) {
  return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: code });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const seg = getSegmentById(id);
  if (!seg) return err("Segment not found", 404);
  if (!canAccessCompany(user, seg.company as string)) {
    return err("Access denied for this company", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON body");
  }

  const usage = await recordCampaignUsage({
    segmentId: id,
    campaignId: (body.campaignId as string) || "",
    campaignName: (body.campaignName as string) || "",
    cpl: (body.cpl as number) ?? null,
    ctr: (body.ctr as number) ?? null,
    spend: (body.spend as number) ?? null,
    impressions: (body.impressions as number) ?? null,
    leads: (body.leads as number) ?? null,
    frequency: (body.frequency as number) ?? null,
    metKpi: (body.metKpi as boolean) ?? false,
  });

  return NextResponse.json({ success: true, data: usage });
}
