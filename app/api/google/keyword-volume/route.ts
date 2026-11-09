// ============================================================
// POST /api/google/keyword-volume
// { company, keywords: string[] }
//
// Đổi bộ từ khoá từ "AI đoán" sang "đo được".
// ------------------------------------------------------------
// Nhãn HIGH/MED/LOW hiện tại là mức độ ý định mua do Gemini TỰ CHẤM. Đường này
// hỏi chính Google: mỗi tháng có bao nhiêu người gõ, cạnh tranh tới đâu, người
// khác đang trả bao nhiêu cho vị trí đầu trang.
//
// Không tính vào hạn mức Meta — đây là API của Google.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { measureKeywords } from "@/lib/google-keyword-planner";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { company?: string; keywords?: string[] };
  const company = pickCompany(body.company);
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return NextResponse.json({ success: false, error: "Thiếu danh sách keywords" }, { status: 400 });
  }

  const result = await measureKeywords(company, body.keywords);
  if (result.error) {
    return NextResponse.json(
      { success: false, error: `Không đo được lượng tìm kiếm: ${result.error}` },
      { status: 502 },
    );
  }

  const measured = result.requested.filter((r) => r.avgMonthlySearches !== null);
  const unmeasured = result.requested.filter((r) => r.avgMonthlySearches === null);

  return NextResponse.json({
    success: true,
    company,
    ...result,
    summary: {
      total: result.requested.length,
      measured: measured.length,
      unmeasured: unmeasured.length,
      totalMonthlySearches: measured.reduce((n, r) => n + (r.avgMonthlySearches ?? 0), 0),
    },
    note:
      unmeasured.length > 0
        ? `${unmeasured.length}/${result.requested.length} từ khoá Google KHÔNG có dữ liệu — thường là cụm quá dài hoặc quá hiếm. ` +
          `Không có nghĩa là sai, chỉ là không đo được lượng tìm.`
        : null,
  });
}
