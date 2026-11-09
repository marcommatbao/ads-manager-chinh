// ============================================================
// GET /api/decision-memory/pending
// Returns entries with overdue evaluation windows (công ty được giao).
// Used by morning briefing and cron health dashboard.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, getCompaniesForRole } from "@/lib/permissions";
import { getPendingEvaluations } from "@/lib/decision-memory/query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role) /* Đợt 21 A4: can_view_credentials nay CHỈ super_admin (xem khoá). Tính năng này không phải khoá → giữ phạm vi cũ admin+. */) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Đợt 21 A5b: chỉ công ty được giao (trước đây ghim MBC + MBI cho mọi admin, kể cả admin một công ty).
  const data: Record<string, unknown> = {};
  let total = 0;
  for (const c of getCompaniesForRole(user)) {
    const entries = getPendingEvaluations(c);
    data[c] = { entries, count: entries.length };
    total += entries.length;
  }
  return NextResponse.json({ success: true, data: { ...data, total } });
}
