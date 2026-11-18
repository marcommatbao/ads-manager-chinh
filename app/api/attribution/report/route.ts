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
  const now = new Date();
  const from = request.nextUrl.searchParams.get("from") ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get("to") ?? now.toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ success: false, error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
  }

  const report = await readAttributionReport(company, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`));
  return NextResponse.json({
    success: true,
    company,
    from,
    to,
    attributionLevel: "evidence_bounded",
    report,
    limitations: [
      "Chỉ gán doanh thu khi có click ID, UTM campaign hoặc campaign label khớp duy nhất.",
      "Email/SĐT chỉ dùng cho identity matching ở pipeline khác, không tự gán nguồn quảng cáo tại đây.",
      "Order không có bằng chứng hoặc evidence mơ hồ được trả về unmatched.",
    ],
  });
}
