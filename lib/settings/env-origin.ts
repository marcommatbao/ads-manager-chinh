// Đợt 24a — biến môi trường nào do CHÍNH Cài đặt nạp vào (lúc khởi động hoặc ngay khi bấm Lưu).
// Lỗi trước đây: lưu lần 1 vá process.env → lần lưu 2 thấy biến "đã có" nên KHÔNG vá (phải khởi động lại mới có tác dụng) và còn
// báo nhầm "biến môi trường Coolify đang ưu tiên". Nay: biến có trong tập này là của Cài đặt → được ghi đè; biến ngoài tập (đặt ở
// Coolify trước khi khởi động) vẫn THẮNG như cũ.
const G = globalThis as { __adsSettingsEnv?: Set<string> }
const names = (): Set<string> => (G.__adsSettingsEnv ??= new Set())

export function markFromSettings(name: string): void { names().add(name) }
export function isFromSettings(name: string): boolean { return names().has(name) }
/** Biến này đang do hạ tầng (Coolify) đặt — Cài đặt không được ghi đè. */
export function setByInfra(name: string, env: Record<string, string | undefined> = process.env): boolean {
  return !!env[name] && !isFromSettings(name)
}
/** Vá một biến từ giá trị vừa lưu ở Cài đặt (trừ khi hạ tầng đang đặt). Trả true nếu đã vá. */
export function patchFromSettings(name: string, value: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!value || setByInfra(name, env)) return false
  env[name] = value
  markFromSettings(name)
  return true
}
