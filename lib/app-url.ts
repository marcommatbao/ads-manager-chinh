// Địa chỉ công khai của CHÍNH bản cài này — để dựng liên kết trong thông báo (Telegram/Teams/email).
// Mỗi bản cài tự đặt APP_URL; không bao giờ cài cứng tên miền của một bản cụ thể (bản khách sẽ trỏ nhầm về bản khác).
// Thiếu cả ba biến → "" (nơi gọi bỏ dòng liên kết, không đoán).
export function publicAppUrl(): string {
  for (const k of ["APP_URL", "NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"]) {
    const v = (process.env[k] ?? "").trim()
    if (!v) continue
    try { return new URL(v).origin } catch { /* sai dạng → thử biến kế */ }
  }
  return ""
}

/** Liên kết tuyệt đối tới một trang của bản cài; "" khi không biết địa chỉ. */
export function appLink(pathname: string): string {
  const base = publicAppUrl()
  return base ? `${base}${pathname.startsWith("/") ? "" : "/"}${pathname}` : ""
}
