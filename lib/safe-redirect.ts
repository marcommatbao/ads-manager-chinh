// ============================================================
// Đường dẫn quay lại sau đăng nhập — chỉ cho phép CÙNG trang (audit bảo mật 30/09)
// ============================================================
// Trước đây chỉ kiểm `startsWith("/") && !startsWith("//")` → "/\evil.example" và "/<TAB>/evil.example" lọt qua,
// trình duyệt / router của Next chuẩn hoá thành //evil.example → chuyển người vừa đăng nhập sang trang lạ.
// Cách đúng: phân giải URL so với một gốc cố định rồi so origin; dấu "\" và ký tự điều khiển từ chối luôn.
const BASE = "http://same-origin.invalid"

export function safeCallbackPath(raw: string | null | undefined): string {
  const s = String(raw ?? "")
  if (!s.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(s)) return "/"
  try {
    const u = new URL(s, BASE)
    return u.origin === BASE ? `${u.pathname}${u.search}${u.hash}` : "/"
  } catch {
    return "/"
  }
}
