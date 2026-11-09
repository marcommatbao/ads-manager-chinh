// ============================================================
// CPL Root-Cause Diagnosis
// GET /api/cpl/root-cause?campaign_id=X
// Computes fresh (lib/root-cause.ts) and attaches to the campaign's latest
// unresolved cpl_critical/cpl_warning alert, if any — same source used by
// the auto-generation path in lib/alert-engine.ts's runAlertEngine().
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { canAccessCompany } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth";
import { generateRootCause } from "@/lib/root-cause";
import { attachRootCauseByCampaign } from "@/lib/alert-engine";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const campaignId = request.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) {
    return NextResponse.json({ success: false, error: "Missing campaign_id" }, { status: 400 });
  }

  try {
    const result = await generateRootCause(campaignId);
    if (!result) {
      return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
    }

    // canAccessCompany(role, …) chấm theo VAI TRÒ. Bản cũ chấm theo
    // user.companies — trường đó là PHẠM VI và đang mang ["ALL"] cho MỌI tài
    // khoản (kiểm data/team-members.json 16/09/2026, kể cả viewer_mbc), nên
    // mọi phép kiểm quyền công ty ở đây LUÔN ĐÚNG cho tất cả mọi người.
    if (!canAccessCompany(user, result.company as string)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    await attachRootCauseByCampaign(campaignId, result);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[CPL root-cause GET]", err);
    return NextResponse.json({ success: false, error: "System Error" }, { status: 500 });
  }
}
