// GET/POST /api/cron/budget-redistribute
// This route never existed — the dashboard's BudgetRedistributionCard
// widget always 404'd, swallowed the error (`.catch(() => {})`), and
// silently vanished (`if (logs.length === 0) return null`) with no
// indication the feature was broken. lib/budget-redistributor.ts (the
// scoring/log/undo logic) is real and complete, just never had a route.
//
// Scope note: nothing anywhere in this codebase actually calls
// computeRedistribution()/saveLog() on a schedule — there is no real
// nightly trigger that populates a redistribution log, so today-logs will
// honestly return empty until that trigger exists (a separate, larger
// feature, not a bug fix). This route restores the read path so the
// widget gets a real 200 instead of a silent 404, and exposes undo only
// for whenever real logs do exist — it does not fabricate an "undo
// succeeded" response, since BudgetChange doesn't carry which platform
// (Meta vs Google) each change belongs to, so a safe real reversal can't
// be constructed without that.
import { NextRequest, NextResponse } from "next/server";
import { getTodayLogs, undoRedistribution } from "@/lib/budget-redistributor";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const action = request.nextUrl.searchParams.get("action");
  if (action === "today-logs") {
    const data = await getTodayLogs();
    return NextResponse.json({ success: true, data });
  }
  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action === "undo-all") {
    const logId = body.logId as string | undefined;
    if (!logId) {
      return NextResponse.json({ success: false, error: "Thiếu logId" }, { status: 400 });
    }
    const reverseChanges = await undoRedistribution(logId);
    if (reverseChanges.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Không có thay đổi nào để hoàn tác cho log này",
      }, { status: 404 });
    }
    // Reverse changes aren't applied to real Meta/Google campaigns here —
    // BudgetChange doesn't record which platform each change belongs to,
    // so this can't safely route to the right mutation API. Surfaced
    // honestly rather than claiming a fake success.
    return NextResponse.json({
      success: false,
      error: `${reverseChanges.length} thay đổi cần hoàn tác nhưng chưa hỗ trợ tự động — cần xử lý thủ công qua Campaigns`,
      reverseChanges,
    }, { status: 501 });
  }
  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}
