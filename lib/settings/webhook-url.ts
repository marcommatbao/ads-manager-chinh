// Soát bảo mật 07/10 (LOW-1, SSRF): máy chủ sẽ POST vào URL webhook → chỉ nhận https tới TÊN MIỀN công khai.
// Chặn địa chỉ IP (v4/v6, gồm 169.254.x metadata, 10.x…), localhost / *.local / *.internal / tên không có dấu chấm, cổng lạ, user:pass@.
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== "https:" || u.username || u.password) return false
  if (u.port && u.port !== "443") return false
  const h = u.hostname.toLowerCase().replace(/\.$/, "")
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h) || h.includes(":")) return false
  if (h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) return false
  return true
}
