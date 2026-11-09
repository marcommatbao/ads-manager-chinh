// ============================================================
// GET /api/audience/campaign-revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&company=MBC|MBI|ALL
//
// Doanh thu THẬT theo nhãn campaign, đọc thẳng Odoo. Không gọi Meta/Google.
//
// Đây là con số khác hẳn mọi thứ tool đang hiển thị: chi tiêu và conversion lâu
// nay đều do NỀN TẢNG QUẢNG CÁO tự khai. Đây là tiền vào tài khoản công ty.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { getCampaignRevenue } from "@/lib/campaign-revenue";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { from: first, to: today };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = defaultRange();
  const from = req.nextUrl.searchParams.get("from") ?? d.from;
  const to = req.nextUrl.searchParams.get("to") ?? d.to;
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
  }

  const requested = (req.nextUrl.searchParams.get("company") ?? "ALL") as string /* mã công ty hoặc "ALL" */;
  // Chặn theo quyền như mọi đường đọc số liệu công ty khác.
  const allowed = getCompaniesForRole(user);
  if (requested !== "ALL" && !allowed.includes(requested)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }
  const company = requested === "ALL" && allowed.length === 1 ? allowed[0] : requested;

  const report = await getCampaignRevenue(from, to, company);
  return NextResponse.json({
    success: report.error === null,
    report,
    /** Nhắc ngay trong phản hồi để không ai đọc sai bảng này. */
    limitations: [
      "Chỉ đo tới cấp NHÃN CAMPAIGN (domain_brand, cloud_hosting…) — Odoo không có trường chứa ad set/segment id.",
      "Đơn không có nhãn campaign phần lớn là gia hạn tự động, khách cũ, điện thoại — chưa bao giờ đi qua quảng cáo.",
      "Doanh thu ở đây là amount_untaxed của sale.order, khác cách tính doanh thu thuần theo hoá đơn của Report API.",
    ],
  });
}
