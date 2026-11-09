// PATCH /api/google/campaigns/[id]/budget — đổi ngân sách/ngày chiến dịch Google Ads (VND).
// Logic ở lib/campaigns/mutations.ts (dùng chung với MCP cho Claude, có chạy thử).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { friendlyError } from "@/lib/not-configured";
import { MutationError, setGoogleCampaignBudget } from "@/lib/campaigns/mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const { dailyBudget, company } = await request.json() as { dailyBudget?: number; company?: string };
    const r = await setGoogleCampaignBudget(user, { company, campaignId: id, dailyBudget: Number(dailyBudget) });
    return NextResponse.json({
      success: true,
      newBudget: r.newBudget,
      previousBudget: r.previousBudget,
      // Cảnh báo hậu kiểm: đã ghi rồi mới nói, vì đây là quyết định của người —
      // nhưng phải nói, để họ biết mình vừa ghi đè lên thay đổi của hệ thống khác.
      conflictWarning: r.conflictWarning,
    });
  } catch (error: unknown) {
    if (error instanceof MutationError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: friendlyError(googleAdsErrorMessage(error)) }, { status: 500 });
  }
}
