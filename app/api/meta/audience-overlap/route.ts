// GET /api/meta/audience-overlap
// Targeting-similarity proxy for currently-active Meta ad sets — real
// data (Meta's own targeting spec per ad set), not a fake "overlap %".
// See lib/audience-overlap.ts for why this isn't a literal Audience
// Overlap API call (that endpoint doesn't exist in the public Marketing
// API anymore).
import { NextResponse } from "next/server";
import { metaClient } from "@/lib/meta-client";
import { findOverlappingAdSetPairs } from "@/lib/audience-overlap";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { detectCompany } from "@/lib/company-detect";
import { friendlyError, isNotConfigured } from "@/lib/not-configured";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const allAdSets = await metaClient.getActiveAdSetsWithTargeting();

    // Tài khoản Meta dùng chung cho cả hai công ty, nên phải lọc theo quyền —
    // bản cũ trả toàn bộ ad set kèm targeting cho bất kỳ ai đăng nhập.
    // Lọc TRƯỚC khi ghép cặp: ghép trước rồi lọc sau vẫn để lộ qua con số tổng,
    // và còn sinh ra cặp MBC×MBI vô nghĩa với người chỉ xem được một bên.
    const allowed = getCompaniesForRole(user) as string[];
    const adSets = allAdSets.filter(a => allowed.includes(detectCompany(a.campaign?.name ?? a.name ?? "")));

    const { pairs, totalQualifyingPairs } = findOverlappingAdSetPairs(adSets);
    return NextResponse.json({
      success: true,
      configured: true,
      totalActiveAdSets: adSets.length,
      pairs,
      totalQualifyingPairs,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Chưa cấu hình Meta thì KHÔNG trả về mảng rỗng kèm số 0. Bản cũ trả
    // { success: false, totalActiveAdSets: 0, pairs: [] } mà không kèm `error`,
    // nên điều kiện `!json.success && json.error` ở trang không nổ, và giao diện
    // hiện "Không có cặp ad set nào tương đồng cao — đã kiểm tra 0 ad set":
    // một lời trấn an dựng từ việc chưa hề chạy được. Nói thẳng là chưa cấu hình.
    if (isNotConfigured(message)) {
      return NextResponse.json({
        success: false,
        configured: false,
        error: "Chưa kết nối Facebook — công cụ chưa đọc được ad set nào, đây KHÔNG phải kết quả 'không có trùng lặp'.",
      }, { status: 503 });
    }
    return NextResponse.json({ success: false, configured: true, error: friendlyError(message) }, { status: 500 });
  }
}
