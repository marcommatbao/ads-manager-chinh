// ============================================================
// GET  /api/audience/interest-performance?days=90   — đọc bản đã lưu
// POST /api/audience/interest-performance            — dựng lại (CÓ gọi Meta)
//
// Tách GET/POST cùng lý do như Policy Radar: mở màn hình phải KHÔNG BAO GIỜ tự
// gọi Meta. Hạn mức Meta của tài khoản này đã gây sự cố một lần rồi.
//
// Chi phí khi dựng lại: ĐÚNG HAI lượt gọi cho toàn bộ tài khoản (ad set +
// targeting, và insight cấp ad set), có phân trang, không phải mỗi sở thích một
// lượt. Cache 6 giờ.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buildAudiencePerformance, readCachedPerformance } from "@/lib/audience-performance";

export const dynamic = "force-dynamic";

function parseDays(raw: string | null): number {
  const n = Number(raw ?? 90);
  if (!Number.isFinite(n)) return 90;
  return Math.min(180, Math.max(7, Math.round(n)));
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = parseDays(req.nextUrl.searchParams.get("days"));

  // ?build=yes — HÀNH ĐỘNG của người vận hành, không phải lượt mở màn hình.
  //
  // Không phá lời hứa "mở màn hình không gọi Meta": bất biến đó nói về LƯỢT TẢI
  // TRANG, mà lượt tải trang không bao giờ gửi build=yes. Đường này tồn tại vì
  // trình duyệt không POST được từ thanh địa chỉ, và người dùng cần nhìn thấy
  // số thật trước khi tôi thiết kế chỗ hiển thị.
  if (req.nextUrl.searchParams.get("build") === "yes") {
    if (!hasPermission(user.role, "can_edit")) {
      return NextResponse.json({ error: "Cần quyền chỉnh sửa để dựng báo cáo (gọi Meta API)" }, { status: 403 });
    }
    const built = await buildAudiencePerformance(days, true);
    return NextResponse.json({ success: built.error === null, report: built, built: true, error: built.error });
  }

  // CHỈ đọc file đã lưu. Dùng readCachedPerformance chứ không phải
  // buildAudiencePerformance(days, false) — hàm kia vẫn gọi Meta khi cache hết
  // hạn, tức lời hứa "mở màn hình không gọi Meta" sẽ sai đúng vào lúc người
  // dùng cần nó nhất.
  const { report, stale } = await readCachedPerformance(days);
  return NextResponse.json({
    success: true,
    report,
    stale,
    neverBuilt: report === null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json(
      { error: "Cần quyền chỉnh sửa để dựng lại báo cáo (thao tác này gọi Meta API)" },
      { status: 403 },
    );
  }

  let days = 90;
  try {
    const body = (await req.json()) as { days?: number };
    if (body?.days) days = parseDays(String(body.days));
  } catch {
    /* không có body cũng được */
  }

  const report = await buildAudiencePerformance(days, true);
  return NextResponse.json({ success: report.error === null, report, error: report.error });
}
