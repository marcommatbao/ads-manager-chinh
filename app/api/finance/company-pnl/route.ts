// ============================================================
// Company P&L API
// GET /api/finance/company-pnl?month=YYYY-MM  (theo tháng)
//     /api/finance/company-pnl?week=YYYY-MM-DD (theo tuần, ngày bất kỳ trong tuần)
//     /api/finance/company-pnl?rolling=1     (28 ngày trọn gần nhất, kết thúc hôm qua)
//     thêm &compare=1 để so với kỳ trước (cùng số ngày đã trôi)
//   → chi phí QC (Google/FB/Tổng) + doanh thu/đơn + chỉ số hiệu quả
//     theo công ty (MBC/MBI), lọc theo quyền user. Cache 10 phút.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { getCompanyPnl, type CompanyPnlResult } from "@/lib/finance/company-pnl";
import { mondayOf } from "@/lib/finance/period";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const cache = new Map<string, { data: CompanyPnlResult; expires: number }>();
const TTL_MS = 10 * 60 * 1000;
/** Kết quả THIẾU số Facebook chỉ được giữ 60 giây: giữ đủ để không hỏi dồn khi
 *  Meta đang chặn, nhưng đủ ngắn để card hồi lại ngay khi Meta cho gọi lại —
 *  chứ không phải ngồi nhìn "không lấy được chi phí Facebook" thêm 10 phút. */
const TTL_DEGRADED_MS = 60 * 1000;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthParam = request.nextUrl.searchParams.get("month") ?? "";
  const weekParam = request.nextUrl.searchParams.get("week") ?? "";
  // Mỗi lần so là thêm một lượt Meta + Google cho kỳ trước. Dashboard này ai mở
  // cũng chạy, nên bật theo yêu cầu chứ không mặc định.
  const compare = request.nextUrl.searchParams.get("compare") === "1";
  const rolling = request.nextUrl.searchParams.get("rolling") === "1";
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return NextResponse.json({ error: "month phải dạng YYYY-MM" }, { status: 400 });
  }
  if (weekParam && !/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
    return NextResponse.json({ error: "week phải dạng YYYY-MM-DD" }, { status: 400 });
  }
  // Kỳ tương lai không có số để đo — chặn ở đây thay vì trả về một kỳ toàn số 0
  // trông như "tuần đó không chi đồng nào".
  if (weekParam) {
    const d = new Date(`${weekParam}T00:00:00`);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "week không phải ngày hợp lệ" }, { status: 400 });
    }
    if (mondayOf(d).getTime() > mondayOf(new Date()).getTime()) {
      return NextResponse.json({ error: "Chưa có số liệu cho tuần trong tương lai" }, { status: 400 });
    }
  }

  try {
    const base = rolling ? "r28" : weekParam ? `w:${weekParam}` : (monthParam || "current");
    const cacheKey = `${base}${compare ? "|cmp" : ""}`;
    const cached = cache.get(cacheKey);
    let data: CompanyPnlResult;
    if (cached && cached.expires > Date.now()) {
      data = cached.data;
    } else {
      data = await getCompanyPnl(
        rolling ? { rolling: true, compare }
        : weekParam ? { week: weekParam, compare }
        : { month: monthParam, compare },
      );
      // Dùng được số cũ thì KHÔNG phải trạng thái hụt số: giữ đủ 10 phút như
      // bình thường. Trước đây mọi lần Meta chặn đều rơi vào TTL 60 giây, tức
      // cứ mỗi phút lại chạy lại cả chuỗi đo — ở bậc development_access (~60
      // lượt/giờ) chính việc thử lại dồn dập đó nuôi sống lệnh chặn.
      const degraded = Boolean(data.MBC.spendFacebookError || data.MBI.spendFacebookError);
      cache.set(cacheKey, {
        data,
        expires: Date.now() + (degraded ? TTL_DEGRADED_MS : TTL_MS),
      });
    }

    // RBAC: chỉ trả công ty user được phép
    const allowed = new Set(getCompaniesForRole(user));
    return NextResponse.json({
      success: true,
      month: data.month,
      daysInMonth: data.daysInMonth,
      daysElapsed: data.daysElapsed,
      mode: data.mode,
      periodKey: data.periodKey,
      periodLabel: data.periodLabel,
      targets: data.targets,
      manualExcluded: data.manualExcluded,
      ...(data.comparison ? { comparison: data.comparison } : {}),
      companies: {
        ...(allowed.has("MBC") ? { MBC: data.MBC } : {}),
        ...(allowed.has("MBI") ? { MBI: data.MBI } : {}),
      },
      generatedAt: data.generatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/finance/company-pnl]", message);
    return NextResponse.json({ success: false, error: `Không tính được P&L: ${message}` }, { status: 502 });
  }
}
