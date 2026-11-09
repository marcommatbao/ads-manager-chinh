// ============================================================
// KPI actuals API — Thực tế theo tháng (MBC/MBI) cho cả năm.
// GET /api/dashboard/kpi-actuals?year=YYYY
// Dùng cho Dashboard tab "KPI Tổng Quan" để đối chiếu với mục tiêu
// (/api/settings/kpi). Gọi live getCompanyPnl() mỗi tháng (không cache) —
// chỉ fetch các tháng đã/đang diễn ra, bỏ qua tháng tương lai.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompanyPnl, type ChannelSpend } from "@/lib/finance/company-pnl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseYear(v: string | null): number {
  const y = Number(v);
  const now = new Date().getFullYear();
  return Number.isInteger(y) && y >= 2020 && y <= now + 5 ? y : now;
}

export interface MonthActual {
  month: number;
  // revenueSourceError=true: count-revenue (Report API) fetch lỗi/timeout tháng
  // này — revenue/orders bên dưới đã bị coerce về 0, KHÔNG phải doanh thu thật.
  mbc: { revenue: number; orders: number; totalSpend: number; spendManual: number; manualBreakdown: Array<{ channel: string; label: string; amount: number }>; spendByChannel: ChannelSpend; revenueSourceError?: boolean; googleSpendError?: boolean; facebookSpendError?: boolean };
  // ordersSourceError=true: count-sale-order-paid (Report API) fetch lỗi/timeout
  // tháng này — orders bên dưới đã bị coerce về 0, KHÔNG phải đơn hàng thật.
  mbi: { orders: number; totalSpend: number; spendManual: number; manualBreakdown: Array<{ channel: string; label: string; amount: number }>; spendByChannel: ChannelSpend; ordersSourceError?: boolean; googleSpendError?: boolean; facebookSpendError?: boolean };
}

// Chi phí lấy hụt (Meta/Google chặn, thiếu cấu hình…) thì spendByChannel và
// totalSpend của tháng đó BỊ THIẾU phần ấy. Không đánh dấu thì "0đ" của một kênh
// đọc y như "tháng này kênh đó không tiêu đồng nào" — và một dòng "Google 0đ /
// trần 4.000.000đ" sẽ trông như đang rất an toàn trong khi thực ra chưa đo được.
export interface KpiActualsResponse {
  success: true;
  year: number;
  months: (MonthActual | null)[]; // index 0..11 = tháng 1..12, null = chưa tới/lỗi
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year = parseYear(request.nextUrl.searchParams.get("year"));

  const now = new Date();
  const lastMonthToFetch =
    year < now.getFullYear() ? 12 :
    year === now.getFullYear() ? now.getMonth() + 1 :
    0;

  const monthsToFetch = Array.from({ length: lastMonthToFetch }, (_, i) => i + 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  const results = await Promise.all(
    monthsToFetch.map(async (m): Promise<MonthActual | null> => {
      try {
        const pnl = await getCompanyPnl(`${year}-${pad(m)}`);
        return {
          month: m,
          mbc: {
            revenue: pnl.MBC.revenue,
            orders: pnl.MBC.orders,
            totalSpend: pnl.MBC.totalSpend,
            spendManual: pnl.MBC.spendManual,
            manualBreakdown: pnl.MBC.manualBreakdown,
            spendByChannel: pnl.MBC.spendByChannel,
            revenueSourceError: pnl.MBC.revenueSourceError,
            googleSpendError: Boolean(pnl.MBC.spendGoogleError),
            facebookSpendError: Boolean(pnl.MBC.spendFacebookError),
          },
          mbi: {
            orders: pnl.MBI.orders,
            totalSpend: pnl.MBI.totalSpend,
            spendManual: pnl.MBI.spendManual,
            manualBreakdown: pnl.MBI.manualBreakdown,
            spendByChannel: pnl.MBI.spendByChannel,
            ordersSourceError: pnl.MBI.ordersSourceError,
            googleSpendError: Boolean(pnl.MBI.spendGoogleError),
            facebookSpendError: Boolean(pnl.MBI.spendFacebookError),
          },
        };
      } catch {
        return null;
      }
    })
  );

  const months: (MonthActual | null)[] = Array.from({ length: 12 }, (_, i) => results[i] ?? null);

  const response: KpiActualsResponse = { success: true, year, months };
  return NextResponse.json(response);
}
