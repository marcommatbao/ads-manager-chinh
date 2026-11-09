// Trang công khai (Google OAuth verification: trang chủ + chính sách quyền riêng tư) — middleware cho qua khi CHƯA đăng nhập.
// Tệp thuần, không import gì: middleware dùng được.
export const PUBLIC_PAGES = ["/about", "/privacy"]
export const isPublicPage = (pathname: string): boolean =>
  PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))
