// PATCH /api/meta/campaigns/[id]/budget — đổi ngân sách/ngày (chiến dịch CBO hoặc nhóm quảng cáo ABO), VND.
// Logic ở lib/campaigns/mutations.ts (dùng chung với MCP cho Claude, có chạy thử).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/not-configured";
import { MutationError, setMetaBudget } from "@/lib/campaigns/mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const { dailyBudget } = await request.json() as { dailyBudget?: number };
    const r = await setMetaBudget(user, { id, dailyBudget: Number(dailyBudget) });
    return NextResponse.json({ success: true, newBudget: r.newBudget, previousBudget: r.previousBudget, conflictWarning: r.conflictWarning });
  } catch (error: unknown) {
    if (error instanceof MutationError) return NextResponse.json({ success: false, error: error.status === 500 ? friendlyError(error.message) : error.message }, { status: error.status });
    // Chiến dịch ABO (ngân sách ở nhóm) sẽ bị Meta từ chối với lỗi thật — trả nguyên văn, không đoán.
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
