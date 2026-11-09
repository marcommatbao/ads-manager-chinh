// Soát bảo mật 07/10 (MED-1) — chặn tiêu hao hạn mức Meta (~60 lượt/giờ cho CẢ app) / tiền Gemini từ các trang chỉ đọc.
//   • "Tải số mới" (force=1) chỉ cho người có quyền sửa, mỗi khoá tối đa 1 lần / 60 giây.
//   • Bộ đệm có trần số mục (khoá theo ngày người dùng chọn → không để phình vô hạn).
const lastForce = new Map<string, number>()
export const FORCE_COOLDOWN_MS = 60_000

/** true = được bỏ đệm lần này (và ghi nhận thời điểm). */
export function allowForce(key: string, canEdit: boolean, now = Date.now()): boolean {
  if (!canEdit) return false
  const t = lastForce.get(key)
  if (t !== undefined && now - t < FORCE_COOLDOWN_MS) return false
  setCapped(lastForce, key, now)
  return true
}

/** Map.set có trần: quá `max` mục thì bỏ mục CŨ NHẤT (Map giữ thứ tự chèn). */
export function setCapped<K, V>(m: Map<K, V>, key: K, value: V, max = 200): void {
  m.delete(key)
  m.set(key, value)
  while (m.size > max) { const first = m.keys().next().value as K; m.delete(first) }
}
