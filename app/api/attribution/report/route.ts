import { aggregateAttribution } from "@/lib/attribution/aggregate";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { readAttributionReport } from "@/lib/attribution/report";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const requested = request.nextUrl.searchParams.get("company") ?? "ALL";
  const allowed = getCompaniesForRole(user);
  if (requested !== "ALL" && !allowed.includes(requested)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const company = requested === "ALL" && allowed.length === 1 ? allowed[0] : requested;
  if (company === "ALL") return NextResponse.json({ success: false, error: "Select one company" }, { status: 400 });
  const now = new Date();
  const range = request.nextUrl.searchParams.get("range");
  const days = range === "LAST_30_DAYS" ? 30 : range === "LAST_60_DAYS" ? 60 : range === "LAST_90_DAYS" ? 90 : null;
  if (range && !days) return NextResponse.json({ success: false, error: "Invalid range" }, { status: 400 });
  const daysAgo = (n: number) => { const date = new Date(now); date.setDate(date.getDate() - n); return date.toISOString().slice(0, 10); };
  const from = request.nextUrl.searchParams.get("from") ?? (days ? daysAgo(days) : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const to = request.nextUrl.searchParams.get("to") ?? (days ? daysAgo(1) : now.toISOString().slice(0, 10));
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ success: false, error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
  }

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || +start > +end) {
    return NextResponse.json({ success: false, error: "Invalid date range" }, { status: 400 });
  }
  const report = await readAttributionReport(company, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`));
  return NextResponse.json({
    success: true,
    company,
    from,
    to,
    attributionLevel: "evidence_bounded",
    report: request.nextUrl.searchParams.get("aggregate") === "1" ? aggregateAttribution(report) : report,
    limitations: [
      "Chỉ gán doanh thu khi có click ID, UTM campaign hoặc campaign label khớp duy nhất.",
      "Email/SĐT chỉ dùng cho identity matching ở pipeline khác, không tự gán nguồn quảng cáo tại đây.",
      "Đối soát lead/đơn không xác lập provider/account/campaign; source.readAt là lúc đọc kho, không chứng minh dữ liệu upstream mới hoặc đầy đủ.",
      "Order không có bằng chứng hoặc evidence mơ hồ được trả về unmatched.",
    ],
  });
}
