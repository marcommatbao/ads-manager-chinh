import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { CompanyAccessError, getGoogleCampaignPerformance } from "@/lib/campaigns/performance";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

// Logic số liệu ở lib/campaigns/performance.ts (dùng chung với MCP cho Claude).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const r = await getGoogleCampaignPerformance(user, {
      company: searchParams.get("company"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    // uniqueUsersError đi kèm để giao diện nói được VÌ SAO cột trống, thay vì
    // để người dùng đoán giữa "không ai xem" và "không lấy được".
    return NextResponse.json({ success: true, data: r.campaigns, uniqueUsersError: r.uniqueUsersError });
  } catch (error: unknown) {
    if (error instanceof CompanyAccessError) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isNotConfigured(message)) {
      return NextResponse.json({ success: false, data: [] });
    }
    return NextResponse.json(
      { success: false, error: friendlyError(message) },
      { status: 500 }
    );
  }
}
