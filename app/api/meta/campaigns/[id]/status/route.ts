// POST /api/meta/campaigns/[id]/status — bật/tắt chiến dịch hoặc nhóm quảng cáo Meta.
// Logic ở lib/campaigns/mutations.ts (dùng chung với MCP cho Claude, có chạy thử).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/not-configured";
import { MutationError, setMetaStatus } from "@/lib/campaigns/mutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { action, campaignId, level } = await request.json() as {
      action: "PAUSE" | "ACTIVATE";
      campaignId: string;
      /** 26d: "adset" → ghi nhật ký ở cấp nhóm quảng cáo (sự kiện adset.pause/resume, gắn chiến dịch cha). */
      level?: "adset";
    };
    const id = (await params).id;
    // Audit 30/09: không cho body.campaignId ghi đè id trên đường dẫn.
    if (campaignId && campaignId !== id) {
      return NextResponse.json({ success: false, error: "campaignId không khớp đường dẫn" }, { status: 400 });
    }
    const r = await setMetaStatus(user, { id, action: action === "PAUSE" ? "PAUSE" : "ACTIVATE", level });
    return NextResponse.json({
      success: true,
      newStatus: r.newStatus,
      message: r.newStatus === "PAUSED" ? "⏸ Đã tạm dừng chiến dịch" : "▶ Đã kích hoạt chiến dịch",
    });
  } catch (error: unknown) {
    if (error instanceof MutationError) return NextResponse.json({ success: false, error: error.status === 500 ? friendlyError(error.message) : error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
