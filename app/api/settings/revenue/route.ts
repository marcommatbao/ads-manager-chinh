// ============================================================
// GET /api/settings/revenue?month=YYYY-MM
//
// Read-only lookup used by the dashboard's start-of-month reminder banner
// ("Nhập doanh thu ERP tháng này"). The route was never implemented, so
// `r.json()` threw on the 404 page, the banner's .catch swallowed it, and
// the reminder never appeared at all.
//
// Source of truth is data/kpi-targets.json via lib/settings/kpi-store —
// the same store the /settings/revenue page writes and the banner's
// "Nhập ngay" button links to. That closes the loop: entering revenue there
// actually silences this banner.
//
// Deliberately NOT backed by lib/metrics-calculator's RevenueConfig store:
// nothing in the app writes it, so a banner keyed on it could never be
// satisfied.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMonthKpi } from "@/lib/settings/kpi-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthParam = request.nextUrl.searchParams.get("month");
  const now = new Date();

  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam) {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (!m) {
      return NextResponse.json({ error: "month phải có dạng YYYY-MM" }, { status: 400 });
    }
    year = Number(m[1]);
    month = Number(m[2]);
    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "month không hợp lệ" }, { status: 400 });
    }
  }

  const kpi = getMonthKpi(year, month);

  return NextResponse.json({
    success: true,
    month: `${year}-${String(month).padStart(2, "0")}`,
    data: {
      // Field name kept as the banner reads it.
      mbc_revenue: kpi.revenueMbc ?? 0,
      ad_spend_mbc: kpi.adSpendMbc ?? 0,
      ad_spend_mbi: kpi.adSpendMbi ?? 0,
      orders_mbi: kpi.ordersMbi ?? 0,
    },
  });
}
