// Đợt 25 — chữ thương hiệu trên trang đăng nhập / đổi mật khẩu theo BẢN CÀI (tệp thuần, dùng ở trình duyệt).
// Bản Mắt Bão (không đặt orgName) → y nguyên chữ cũ.
import { companiesConfig } from "./registry"

export function brandText(): { tagline: string; footer: string } {
  const org = companiesConfig().orgName?.trim()
  if (!org) return { tagline: "MBC & MBI Ad Management Platform", footer: "© 2026 AdsCommand · Powered by MBC & MBI" }
  return { tagline: `Nền tảng quản lý quảng cáo · ${org}`, footer: `© 2026 AdsCommand · ${org}` }
}
