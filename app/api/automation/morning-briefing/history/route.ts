// ============================================================
// GET /api/automation/morning-briefing/history?limit=30
// Lịch sử bản tin buổi sáng (mới nhất trước) — mỗi bản kèm evidence
// (nguồn, khoảng ngày, thời điểm đọc) để đối chiếu kết luận cũ.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBriefingHistory } from "@/lib/morning-briefing-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const raw = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return NextResponse.json({ success: true, data: getBriefingHistory(limit) });
}
