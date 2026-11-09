// ============================================================
// Chặn CSRF cho /api (audit bảo mật 30/09)
// ============================================================
// Trước đây mọi route ghi chỉ dựa vào cookie SameSite=Lax. Lax chặn POST từ trang KHÁC SITE, nhưng không chặn trang
// CÙNG SITE (app khác dưới cùng tên miền gốc, vd *.dev.matbao.ai) — chúng gửi form / fetch kèm cookie đăng nhập được.
// Quy tắc (hàm thuần, middleware gọi):
//   • GET/HEAD/OPTIONS: cho qua (không đổi trạng thái — route GET nào đổi trạng thái là lỗi riêng của route đó).
//   • Có Sec-Fetch-Site (trình duyệt hiện đại): chỉ nhận "same-origin" / "none".
//   • Không có nhưng có Origin: host của Origin phải trùng Host (hoặc X-Forwarded-Host do proxy đặt).
//   • Không có cả hai: không phải trình duyệt (cron, webhook CRM, gọi máy-máy) → cho qua; các route đó có xác thực riêng.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

export interface CsrfInput { method: string; origin: string | null; secFetchSite: string | null; host: string | null; forwardedHost: string | null }

export function csrfRejectReason(x: CsrfInput): string | null {
  if (SAFE.has(x.method.toUpperCase())) return null
  if (x.secFetchSite) return x.secFetchSite === "same-origin" || x.secFetchSite === "none" ? null : `Sec-Fetch-Site=${x.secFetchSite}`
  if (!x.origin) return null
  if (x.origin === "null") return "Origin=null"
  let originHost: string
  try { originHost = new URL(x.origin).host.toLowerCase() } catch { return "Origin không hợp lệ" }
  const expected = (x.forwardedHost?.split(",")[0].trim() || x.host || "").toLowerCase()
  return expected && originHost === expected ? null : `Origin ${originHost} khác ${expected || "(không có Host)"}`
}
