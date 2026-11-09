// ============================================================
// Đợt 22b — "chưa kết nối / chưa dán khoá" ≠ sự cố. Nhận biết + câu tiếng Việt dễ hiểu.
// ============================================================
// Vì sao: các route nhận biết "chưa cấu hình" bằng chữ "not configured" trong câu lỗi, nhưng thư viện Google Ads báo
// "No refresh token or refresh handler callback is set." và mã của ta báo "No Google Ads customer IDs configured." —
// không có chữ đó → bản cài mới (chưa dán khoá) nhận lỗi 500 + câu kỹ thuật thay vì trạng thái "chưa kết nối".
// GIỮ NGUYÊN câu lỗi gốc ở nơi ném (nhiều chỗ còn dò theo chữ); chỉ ĐỔI lúc trả ra giao diện. Lỗi khác: đi qua y nguyên.

const PATTERNS: RegExp[] = [
  /not configured/i,
  /no refresh token/i,
  /customer ids? (?:not )?configured/i,
  /credentials not configured/i,
  // Đợt 25: câu tiếng Việt của chính ta — "<TÊN_BIẾN> chưa cấu hình" (vd META_AD_ACCOUNT_ID chưa cấu hình).
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+ chưa cấu hình/,
]

export function isNotConfigured(message: unknown): boolean {
  return typeof message === "string" && PATTERNS.some((re) => re.test(message))
}

const SETTINGS = "Super Admin vào Cài đặt → API Keys"

/** Câu dễ hiểu cho lỗi "chưa kết nối"; mọi giá trị khác trả lại NGUYÊN (giữ kiểu). */
export function friendlyError<T>(message: T): T {
  if (typeof message !== "string" || !isNotConfigured(message)) return message
  const m = message.toLowerCase()
  let out: string
  if (m.includes("gemini")) out = `Chưa có khoá Gemini (AI) — ${SETTINGS} để dán khoá.`
  else if (m.includes("meta") || m.includes("facebook")) out = `Chưa kết nối Meta (thiếu Access Token hoặc Ad Account ID) — ${SETTINGS} để dán khoá.`
  else if (m.includes("customer id")) out = `Chưa có mã khách hàng Google Ads cho công ty này — ${SETTINGS} → "Mã theo từng công ty".`
  else if (m.includes("ga4") || m.includes("analytics")) out = `Chưa kết nối Google Analytics — ${SETTINGS} → GA4.`
  else out = `Chưa kết nối Google Ads (thiếu khoá hoặc chưa cấp quyền OAuth) — ${SETTINGS} để dán khoá rồi bấm "Authorize via OAuth".`
  return out as T
}
