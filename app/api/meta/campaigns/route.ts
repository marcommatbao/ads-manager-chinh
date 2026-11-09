import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMetaCampaignPerformance } from "@/lib/campaigns/performance";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

// Logic số liệu ở lib/campaigns/performance.ts (dùng chung với MCP cho Claude).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const r = await getMetaCampaignPerformance(user, {
      status: searchParams.get("status"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    // Nói ra cho giao diện biết cột "Kết quả"/CPL lần này đáng ngờ, thay vì
    // để người dùng tin một con số sai mà không có dấu hiệu gì.
    return NextResponse.json({
      success: true,
      data: r.campaigns,
      meta: { currency: r.currency },
      conversionGoalsUnavailable: r.conversionGoalsUnavailable,
    });
  } catch (error: unknown) {
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
