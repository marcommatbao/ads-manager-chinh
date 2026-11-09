// Đợt 21 A3b (tách ra Đợt 25 để dùng chung dashboard + trang đăng nhập) — nạp cấu hình công ty của BẢN CÀI vào trình duyệt
// TRƯỚC khi React chạy. Bản Mắt Bão: cấu hình = mặc định → chỉ chèn mã công khai (pixel/GA4). `<` thoát thành <.
import { companiesConfig } from "@/lib/companies"
import { DEFAULT_COMPANIES } from "@/lib/companies/defaults"
import { publicIdsFromEnv } from "@/lib/companies/public-ids"

export function companiesBootScript(opts: { publicIds?: boolean } = {}): string | null {
  const cfg = companiesConfig()
  const esc = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c")
  let out = ""
  if (JSON.stringify(cfg) !== JSON.stringify(DEFAULT_COMPANIES)) out += `window.__adsCompanies=${esc({ current: cfg, refresh: null })};`
  // 15/10/2026: mã công khai chèn CẢ ở bản Mắt Bão. Trước đây bản cấu hình mặc định trả null → máy chủ vẽ mã đọc từ biến
  // lúc chạy, trình duyệt (bản build không mang sẵn NEXT_PUBLIC_*) vẽ rỗng → React #418 ở Cài đặt / Tracking.
  if (opts.publicIds !== false) {
    const ids = publicIdsFromEnv()
    if (Object.keys(ids).length) out += `window.__adsPublicIds=${esc(ids)};`
  }
  return out || null
}
