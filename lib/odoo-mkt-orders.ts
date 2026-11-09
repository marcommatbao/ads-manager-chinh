// ============================================================
// Đơn hàng do MARKETING mang về — MBI
// ------------------------------------------------------------
// VÌ SAO CÓ TỆP NÀY: bảng "Chi Phí SP" lấy doanh thu từ mb.sale.report với
// đúng một điều kiện — ngày hoá đơn trong tháng. Không lọc công ty, không lọc
// nguồn. Nên ô "TỔNG DOANH THU" của MBI hiện 13.371.866.950đ trong khi cộng
// các dòng sản phẩm MBI lại chỉ ra 660.768.400đ: 95% con số đó không phải của
// MBI, phần lớn là telesales (TV-CC, TV-C88, TV-Bựa…) và cộng tác viên.
//
// Chia ra thì ROAS = 13,37 tỷ ÷ 49,96 triệu = 267,7x. Con số đó không có thật,
// và nó nguy hiểm chính vì QUÁ ĐẸP ĐỂ BỊ NGHI NGỜ.
//
// Đo lại theo đúng cách ghi nhận của phòng MKT (tháng 9/2026):
//     doanh thu MKT  41.268.450đ · 49 đơn
//     chi phí QC     49.958.795đ
//     ROAS THẬT      0,83x  ← đang LỖ, không phải lãi 267 lần
//
// ------------------------------------------------------------
// BỐN ĐIỀU KIỆN dưới đây lấy từ bộ lọc phòng MKT đang dùng trên Odoo
// (màn "Modify Condition"), không phải tôi tự nghĩ ra.
// ============================================================

/** Loại đơn KHÔNG tính: đơn kỹ thuật do hệ thống sinh, không phải đơn bán. */
export const MKT_EXCLUDED_ORDER_TYPES = ["Đơn đồng bộ", "Đồng bộ dịch vụ V10"];

/** Chỉ tính đơn đã thu được tiền. */
export const MKT_PAYMENT_STATES = ["in_payment", "paid"];

/** Đội marketing — tên đội bắt đầu bằng "M-" (M-3B, M-69, M-Agency MBI…). */
export const MKT_TEAM_PREFIX = "M-";

/**
 * Sáu nguồn được phòng MKT tính là đơn của marketing.
 *
 * ĐỌC Ở TRƯỜNG `customer_source`, KHÔNG PHẢI `source_id`. Hai trường này khác
 * nhau thật, đo ngày 21/09/2026 trên tháng 9:
 *
 *                            source_id          customer_source
 *     Kênh chat              21.898.100đ/22     30.414.700đ/34
 *     matbao.in                 634.000đ/ 3      2.013.200đ/ 4
 *     Đơn hàng ID                     0đ/ 0      3.074.400đ/ 1   ← source_id KHÔNG có
 *     ────────────────────────────────────────────────────────
 *     TỔNG                   28.298.250đ/35     41.268.450đ/49
 *
 * `customer_source` bao trùm `source_id`. Dùng `source_id` sẽ bỏ sót 14 đơn và
 * 13 triệu — trong đó mất trắng cả nguồn "Đơn hàng ID".
 */
export const MKT_SOURCES = [
  "Đơn hàng MBI online",
  "Điện thoại vào công ty",
  "Kênh chat",
  "Yêu cầu phòng ban",
  "matbao.in",
  "Đơn hàng ID",
];

/** Điều kiện lọc trên `sale.order`. */
export function mktOrderDomain(start: string, end: string): unknown[][] {
  return [
    ["type_id.name", "not in", MKT_EXCLUDED_ORDER_TYPES],
    ["invoice_ids.payment_state", "in", MKT_PAYMENT_STATES],
    ["team_id.name", "like", MKT_TEAM_PREFIX],
    ["amount_untaxed", ">=", 1],
    ["customer_source.name", "in", MKT_SOURCES],
    // Theo NGÀY ĐẶT HÀNG. Bảng gốc của MKT nhóm theo tháng và tôi chưa khớp
    // được đúng số đơn của họ (339 theo ngày đặt vs 288 trên ảnh, 255 theo
    // ngày tạo) — chưa rõ họ lọc thêm gì. Người dùng đã xác nhận số tháng 9
    // đo theo cách này là đúng để dùng; ghi lại chỗ lệch để không ai tưởng
    // hai bảng phải trùng tuyệt đối.
    ["date_order", ">=", start],
    ["date_order", "<=", `${end} 23:59:59`],
  ];
}

/** Cùng điều kiện, nhưng áp lên DÒNG đơn hàng — để gom được theo sản phẩm.
 *  Đã đối chiếu: tổng theo dòng khớp CHÍNH XÁC tổng theo đơn (41.268.450đ). */
export function mktOrderLineDomain(start: string, end: string): unknown[][] {
  return mktOrderDomain(start, end).map((cond) => {
    const [field, ...rest] = cond as [string, ...unknown[]];
    return [`order_id.${field}`, ...rest];
  });
}
