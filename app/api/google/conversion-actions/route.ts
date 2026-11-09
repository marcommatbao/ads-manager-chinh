// ============================================================
// GET /api/google/conversion-actions?company=MBC
//
// Liệt kê hành động chuyển đổi của tài khoản Google Ads, để người dùng CHỌN
// campaign sắp tạo tối ưu cho cái nào.
// ------------------------------------------------------------
// Vì sao cần: đường launch đang dùng `maximize_conversions` mà KHÔNG chỉ định
// hành động chuyển đổi nào. Google khi đó tối ưu theo TOÀN BỘ hành động đang
// bật ở cấp tài khoản — có thể là đơn hàng thật, mà cũng có thể là "xem trang
// liên hệ" hay "gọi điện". Tức đang để Google tự quyết tiền chảy về đâu.
//
// Đây cũng chính là gốc của chuyện đã ghi ở /api/dashboard/unified: Facebook
// đếm hành động dạng lead, còn Google đếm MỌI conversion action đang bật — hai
// mẫu số khác nhau nên CPL hai bên không so trực tiếp được.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { resolveConversionCategory, resolveConversionOrigin, CONVERSION_CATEGORY_VI } from "@/lib/google-ads-helpers";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";

export interface ConversionActionRow {
  resourceName: string;
  id: string;
  name: string;
  /** PURCHASE, SUBMIT_LEAD_FORM, PAGE_VIEW, PHONE_CALL_LEAD… */
  category: string;
  status: string;
  /** Có được tính vào cột "Conversions" của tài khoản không. `false` = Google
   *  vẫn ghi nhận nhưng KHÔNG dùng để tối ưu giá thầu. */
  countsAsConversion: boolean;
  /** Nguồn: WEBSITE, APP, CALL_FROM_ADS… */
  origin: string;
  /** Tên nhóm bằng tiếng Việt, để không bắt người đọc dịch enum. */
  categoryVi: string;
  /** Số chuyển đổi 30 ngày gần nhất.
   *  `0` = tín hiệu ĐANG CHẾT — tối ưu theo nó là bảo Google đuổi theo thứ chưa
   *  từng xảy ra. `null` = CHƯA ĐO ĐƯỢC (truy vấn chỉ số hỏng) — hoàn toàn khác
   *  nghĩa, và gộp hai cái làm một là nói dối bằng con số 0. */
  conversions30d: number | null;
  conversionValue30d: number | null;
  /** Nên chọn mặc định: đúng loại đơn hàng và có dữ liệu thật. */
  recommended: boolean;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    // Hai truy vấn tách riêng CÓ CHỦ ĐÍCH:
    //  - Danh sách hành động: từ `conversion_action`, không có chỉ số theo ngày.
    //  - Số chuyển đổi 30 ngày: phải đi qua `campaign` + segments.conversion_action,
    //    vì `conversion_action` không mang metrics theo khoảng thời gian.
    // Gộp làm một sẽ mất những hành động chưa có chuyển đổi nào — mà đó lại là
    // nhóm đáng cảnh báo nhất.
    const [actionRows, metricRows] = await Promise.all([
      customer.query(`
        SELECT
          conversion_action.resource_name,
          conversion_action.id,
          conversion_action.name,
          conversion_action.category,
          conversion_action.status,
          conversion_action.include_in_conversions_metric,
          conversion_action.origin
        FROM conversion_action
        WHERE conversion_action.status = 'ENABLED'
        ORDER BY conversion_action.name
      `),
      customer.query(`
        SELECT
          segments.conversion_action,
          metrics.all_conversions,
          metrics.all_conversions_value
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
      `).then((r) => ({ ok: true as const, rows: r as unknown[] }))
       .catch((e) => ({ ok: false as const, rows: [] as unknown[], err: describeGoogleAdsError(e) })),
    ]);

    // Truy vấn chỉ số hỏng thì MỌI hành động thành "0 chuyển đổi 30 ngày" —
    // đọc thành "tín hiệu đang chết", trong khi sự thật là CHƯA ĐO ĐƯỢC. Hậu
    // quả thật: Purchase mất nhãn NÊN CHỌN và không được tự tích, người dùng
    // tưởng tài khoản không có chuyển đổi nào.
    const metricsOk = metricRows.ok;

    const byAction = new Map<string, { conv: number; value: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of metricRows.rows as any[]) {
      const rn = String(r.segments?.conversion_action ?? "");
      if (!rn) continue;
      const cur = byAction.get(rn) ?? { conv: 0, value: 0 };
      cur.conv += Number(r.metrics?.all_conversions ?? 0);
      cur.value += Number(r.metrics?.all_conversions_value ?? 0);
      byAction.set(rn, cur);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: ConversionActionRow[] = (actionRows as any[]).map((r) => {
      const ca = r.conversion_action ?? {};
      const rn = String(ca.resource_name ?? "");
      const m = byAction.get(rn) ?? { conv: 0, value: 0 };
      // Google trả enum dưới dạng SỐ (category 4 = PURCHASE). Không đổi ra tên
      // thì UI hiện "4 · 2" và luật gợi ý mặc định không bao giờ khớp.
      const category = resolveConversionCategory(ca.category);
      const counts = ca.include_in_conversions_metric !== false;
      return {
        resourceName: rn,
        id: String(ca.id ?? ""),
        name: String(ca.name ?? ""),
        category,
        status: String(ca.status ?? ""),
        countsAsConversion: counts,
        origin: resolveConversionOrigin(ca.origin),
        categoryVi: CONVERSION_CATEGORY_VI[category] ?? category,
        // Không đo được thì trả null, KHÔNG trả 0. UI phân biệt được
        // "chưa đo" với "đo rồi và bằng không".
        conversions30d: metricsOk ? Math.round(m.conv * 100) / 100 : null,
        conversionValue30d: metricsOk ? Math.round(m.value) : null,
        // "Nên chọn" = đúng loại đơn hàng, được tính vào Conversions, VÀ có dữ
        // liệu thật trong 30 ngày. Thiếu vế cuối thì không gợi ý: tối ưu theo
        // một tín hiệu chưa từng bắn là bảo Google đuổi theo thứ không tồn tại.
        // Không đo được thì gợi ý theo LOẠI thôi, và nói rõ là chưa xác nhận
        // bằng dữ liệu — thà gợi ý dè dặt còn hơn không gợi ý gì.
        recommended: /PURCHASE/i.test(category) && counts && (metricsOk ? m.conv > 0 : true),
      };
    });

    // Đơn hàng lên đầu, rồi tới cái có dữ liệu nhiều nhất.
    rows.sort((a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      (b.conversions30d ?? -1) - (a.conversions30d ?? -1),
    );

    return NextResponse.json({
      success: true,
      company,
      actions: rows,
      metricsAvailable: metricsOk,
      metricsError: metricRows.ok ? null : metricRows.err,
      note:
        (metricsOk ? "" : "⚠️ KHÔNG đọc được số chuyển đổi 30 ngày — các mục bên dưới hiện 'chưa đo được', không phải 'bằng không'. ") +
        "Chỉ liệt kê hành động đang BẬT. Con số là 30 ngày gần nhất của toàn tài khoản. " +
        "Hành động 0 chuyển đổi = tín hiệu đang chết, đừng chọn để tối ưu.",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không đọc được danh sách hành động chuyển đổi", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
