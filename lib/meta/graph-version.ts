// ============================================================
// Phiên bản Graph API của Meta — MỘT chỗ duy nhất cho cả app
// ============================================================
// Trước đây 45 chỗ ghi cứng "v19.0"; lên phiên bản mới phải sửa từng tệp và dễ sót.
// Đổi phiên bản: sửa DEFAULT ở đây, hoặc đặt META_GRAPH_API_VERSION (vd "v21.0") trên
// môi trường để thử trước mà không cần build lại. Giá trị sai định dạng bị bỏ qua.

// 15/10/2026: v19.0 → v25.0. v19 đã hết hạn — Meta âm thầm phục vụ mọi lời gọi v19 bằng v24.0 (header
// facebook-api-version) và cảnh báo các bản dưới v25. Đã so 14 truy vấn đọc app dùng (tài khoản, campaign/adset/ad+creative,
// insights ngày/7d_click+1d_view/age-gender/placement/region/hourly/maximum, pixel, custom conversion/audience): cùng field,
// cùng số. Lời gọi GHI chưa thử (giữ chỉ-đọc).
//
// 26/10/2026 (task #7099) — mốc hết hạn Marketing API (changelog Meta): v24.0 tới 10/11/2026, v25.0 tới 23/02/2027,
// v26.0 ra 29/07/2026. KHÔNG lùi về v24 nữa. Thử v26 trước bằng META_GRAPH_API_VERSION=v26.0 (không cần build lại);
// có lỗi thì bỏ biến đó để về v25. Đã sửa cho v26: bỏ loại trừ chi tiết, ABO khai is_adset_budget_sharing_enabled,
// vị trí theo phiên bản (applyPlacementRules, lib/case/meta-placements.ts), luôn gửi advantage_audience.
// Đo validate_only 26/10 trên v25 + v26: CBO, ABO (có cờ), nhóm mới đều được nhận; ABO thiếu cờ bị từ chối ở cả hai.
//
// 26/10/2026: user chốt chạy v26 luôn → DEFAULT = v26.0. Lùi: đặt META_GRAPH_API_VERSION=v25.0 (không cần build lại).
// Phần ĐỌC chưa so riêng trên v26 (đã so v19→v25); changelog v26 chỉ bỏ trường ước tính phân phối + chỉ số Trang mà app không dùng.
const DEFAULT = "v26.0"

function resolveVersion(): string {
  const v = process.env.META_GRAPH_API_VERSION?.trim()
  return v && /^v\d+\.\d+$/.test(v) ? v : DEFAULT
}

export const META_GRAPH_VERSION = resolveVersion()
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`
