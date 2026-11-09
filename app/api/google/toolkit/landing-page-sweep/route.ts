// ============================================================
// GET /api/google/toolkit/landing-page-sweep?company=MBC|MBI&days=30
// ============================================================
// P3 — quét lại trang đích của TOÀN BỘ quảng cáo đang chạy.
//
// Vì sao cần: trang đích trước nay chỉ được kiểm đúng một lần, lúc tạo chiến
// dịch (`launch/precheck`). Trang sống lúc tạo rồi chết sau đó thì không ai
// biết. Theo số đo 21/09, 91% quảng cáo bị từ chối là do trang đích chết và
// 0% do câu chữ — nên đây là chỗ đáng quét nhất.
//
// CHỈ ĐỌC VÀ BÁO CÁO. Endpoint này không tạm dừng, không sửa bất cứ thứ gì.
// Mọi việc sửa vẫn phải đi qua đường có kiểm quyền + ghi vết như cũ.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/translate";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { checkCronAuth } from "@/lib/cron-auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { sweepLandingPages, fetchDisapprovedAds, classifyDisapprovedHosts } from "@/lib/google-landing-pages";
import { isCompany } from "@/lib/companies/registry";

export const dynamic = "force-dynamic";
// Quét hàng trăm URL thật, mỗi URL tới 12 giây chờ — cần trần thời gian rộng.
export const maxDuration = 300;

/** Chỉ nhận đúng các khoảng Google chấp nhận; không ghép chuỗi người dùng vào GAQL. */
const RANGES: Record<string, string> = {
  "7": "LAST_7_DAYS",
  "14": "LAST_14_DAYS",
  "30": "LAST_30_DAYS",
};

export async function GET(req: NextRequest) {
  // Cùng khuôn xác thực hai đường với các route toolkit khác: chỉ xét
  // checkCronAuth khi thật sự có header Authorization, để phiên đăng nhập
  // thường không bao giờ chạm vào nhánh ghi log từ chối của nó.
  const hasAuthHeader = req.headers.has("authorization");
  const user: SessionUser | null = hasAuthHeader && checkCronAuth(req, "landing-page-sweep/service-read").ok
    ? { id: "cron", name: "Cron", email: "cron@internal", role: "super_admin", companies: ["ALL"] }
    : await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Lượt cron (service-to-service) giữ tiếng Việt; người dùng giao diện theo cookie ngôn ngữ.
  const t = user.id === "cron" ? makeT("vi") : await getT();

  const { searchParams } = new URL(req.url);
  const company = (searchParams.get("company") || "MBC") as string;
  if (!isCompany(company)) {
    return NextResponse.json({ error: t("libgoogle.lps.noCompany") }, { status: 400 });
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: t("libgoogle.lps.noView") }, { status: 403 });
  }

  const dateRange = RANGES[searchParams.get("days") ?? "30"] ?? RANGES["30"];
  // `includePaused=1` để quét cả chiến dịch đã dừng. Không bật mặc định: chỗ
  // đang tiêu tiền mới là chỗ cần canh hằng ngày, còn chiến dịch đã dừng là
  // việc dọn dẹp định kỳ và tốn nhiều lượt gọi hơn hẳn.
  const includePaused = searchParams.get("includePaused") === "1";

  try {
    const customer = getGoogleAdsCustomer(company);
    const run = (gaql: string) => customer.query(gaql) as Promise<unknown[]>;

    // Hai nguồn, cố ý chạy cùng lúc — chúng nhìn thấy hai tập KHÁC NHAU:
    //  · sweepLandingPages đi từ landing_page_view (theo SỐ LIỆU) → chỉ thấy
    //    URL có lưu lượng trong kỳ. Đây là chỗ đang tiêu tiền.
    //  · fetchDisapprovedAds đi từ ad_group_ad (theo ĐỊNH NGHĨA) → thấy cả
    //    quảng cáo đã ngừng chạy. Đo 24/09: nguồn 1 báo 0 trang chết ở cả hai
    //    tài khoản, trong khi nguồn 2 tìm ra 5 (MBC) và 96 (MBI) quảng cáo bị
    //    từ chối. Thiếu nguồn 2 là mù đúng chỗ có vấn đề.
    const [result, disapproved] = await Promise.all([
      sweepLandingPages(run, { dateRange, includePaused, t }),
      fetchDisapprovedAds(run),
    ]);

    // Chỉ mở thử tên miền của phần CÒN LẠI sau khi bỏ qua — không tốn lượt
    // gọi cho thứ đã biết và đã chấp nhận.
    const hostStatus = disapproved.ok ? await classifyDisapprovedHosts(disapproved) : [];

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error ?? t("libgoogle.lps.noList") },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      company,
      dateRange,
      includePaused,
      summary: {
        urlsChecked: result.checked,
        rowsBeforeMerge: result.totalRows,
        alive: result.aliveCount,
        dead: result.dead.length,
        inconclusive: result.inconclusive.length,
        deadSpendVnd: result.deadSpendVnd,
      },
      // `dead` = trang thật sự trả lỗi HTTP. Đây là thứ đáng sửa.
      dead: result.dead,
      // `inconclusive` = KHÔNG nhận được phản hồi nào (hết giờ, mạng phía máy
      // chủ). Tách riêng chứ không trộn vào `dead`: gọi nhầm một trang đang
      // sống là chết sẽ khiến người ta đi sửa thứ không hỏng, và lần sau không
      // còn tin bản báo cáo này nữa.
      inconclusive: result.inconclusive,
      downgradeReason: result.downgradeReason,
      // Quảng cáo Google ĐANG từ chối — nguồn độc lập với phép quét URL ở trên.
      disapproved: disapproved.ok
        ? {
            count: disapproved.rows.length,
            byTopic: disapproved.byTopic,
            // Tên miền kèm trạng thái SỐNG/CHẾT — tách "trang hỏng thật, phải
            // sửa" khỏi "lỗi cũ, chỉ cần xin duyệt lại". Hai việc khác hẳn nhau.
            byHost: hostStatus,
            rows: disapproved.rows.slice(0, 200),
            // Nêu rõ phần đã bỏ qua theo cấu hình, không giấu.
            ignoredCount: disapproved.ignoredCount,
            ignoredHosts: disapproved.ignoredHosts,
          }
        : { count: 0, byTopic: [], byHost: [], rows: [], ignoredCount: 0, ignoredHosts: [], error: disapproved.error },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: googleAdsErrorMessage(err) },
      { status: 500 },
    );
  }
}
