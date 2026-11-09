// POST /api/google/campaigns/[id]/status — bật/tắt chiến dịch Google Ads.
// Logic ở lib/campaigns/mutations.ts (dùng chung với MCP cho Claude, có chạy thử).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { friendlyError } from "@/lib/not-configured";
import { MutationError, setGoogleCampaignStatus } from "@/lib/campaigns/mutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const { action, company } = await request.json() as { action?: "PAUSE" | "ACTIVE"; company?: string };
    const r = await setGoogleCampaignStatus(user, { company, campaignId: id, action: action === "PAUSE" ? "PAUSE" : "ACTIVE" });
    return NextResponse.json({
      success: true,
      newStatus: r.newStatus,
      message: r.newStatus === "PAUSED" ? "⏸ Đã tạm dừng chiến dịch" : "▶ Đã kích hoạt chiến dịch",
    });
  } catch (error: unknown) {
    if (error instanceof MutationError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: friendlyError(googleAdsErrorMessage(error)) }, { status: 500 });
  }
}
