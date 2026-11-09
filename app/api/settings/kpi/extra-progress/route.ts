// GET /api/settings/kpi/extra-progress?month=YYYY-MM
// 12/10/2026 (task #6285): khoản chi bổ sung loại "Sản phẩm mới" của tháng đã tiêu bao nhiêu — lọc chiến dịch theo chữ
// trong tên (lib/finance/extra-spend-progress.ts). Mọi người đã đăng nhập xem được, như GET /api/settings/kpi.
// Thuộc gói Mắt Bão (lib/companies/modules.ts: tiền tố /api/settings/kpi).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMonthKpi } from "@/lib/settings/kpi-store";
import { extraSpendProgress } from "@/lib/finance/extra-spend-progress";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return NextResponse.json({ success: false, error: "month phải dạng YYYY-MM" }, { status: 400 });
  try {
    const items = await extraSpendProgress(month, getMonthKpi(Number(m[1]), Number(m[2])).extraSpend);
    return NextResponse.json({ success: true, month, items });
  } catch (err) {
    return NextResponse.json({ success: false, error: friendlyError(err) }, { status: 500 });
  }
}
