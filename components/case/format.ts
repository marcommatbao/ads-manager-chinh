// ============================================================
// Format nhỏ dùng chung cho các trang "Xử lý chiến dịch"
// ------------------------------------------------------------
// KHÔNG đặt trong lib/case/ — thư mục đó là backend đã khoá (xem AGENTS.md
// của phần việc này). Đây chỉ là format hiển thị, không phải nghiệp vụ.
// ============================================================

// Tham số cuối `intlLocale` (tuỳ chọn) = mã Intl của ngôn ngữ đang chọn (useIntlLocale()). Không truyền → vi-VN như cũ
// (nơi gọi phía máy chủ giữ nguyên). Múi giờ luôn Asia/Ho_Chi_Minh — số liệu kinh doanh tính theo giờ Việt Nam.
export const vnd = (n: number | null | undefined, intlLocale = "vi-VN"): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : `₫${Math.round(n).toLocaleString(intlLocale)}`;

export const num = (n: number | null | undefined, opts?: Intl.NumberFormatOptions, intlLocale = "vi-VN"): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString(intlLocale, opts);

export const pct = (n: number | null | undefined, decimals = 1, intlLocale = "vi-VN"): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—"
    : `${(n * 100).toLocaleString(intlLocale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;

export const roas = (n: number | null | undefined, intlLocale = "vi-VN"): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—"
    : `${n.toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

/** "2026-09-25" → "25/09/2026" (vi) / "Sep 25, 2026" (en). Không tự đổi múi giờ — chuỗi ngày đã là YYYY-MM-DD của server. */
export function ddmmyyyy(ymd: string | null | undefined, intlLocale = "vi-VN"): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  if (!intlLocale.startsWith("vi")) {
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString(intlLocale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    }
  }
  return `${d}/${m}/${y}`;
}

export function datetimeVN(iso: string | null | undefined, intlLocale = "vi-VN"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlLocale, { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
}
