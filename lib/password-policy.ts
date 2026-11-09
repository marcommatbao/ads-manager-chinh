// Soát bảo mật Đợt 21 B (03/10) — MỘT luật mật khẩu cho mọi nơi đặt mật khẩu: tự đổi, Super Admin tạo / đặt lại hộ.
// Chuẩn hoá NFC trước khi băm: cùng một mật khẩu gõ từ bàn phím / bộ gõ khác nhau (dấu tiếng Việt dựng sẵn vs tổ hợp)
// mới khớp nhau. Đăng nhập thử cả dạng gõ nguyên lẫn dạng NFC để mật khẩu đã băm trước đây vẫn dùng được.
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 200

export const normalizePassword = (p: string): string => p.normalize("NFC")

/** Lỗi đọc được, null = hợp lệ. `email` để chặn dùng email làm mật khẩu. */
export function passwordProblem(password: unknown, email?: string): string | null {
  if (typeof password !== "string" || !password) return "Thiếu mật khẩu."
  const p = normalizePassword(password)
  const len = [...p].length
  if (!p.trim()) return "Mật khẩu không được chỉ có khoảng trắng."
  if (len < PASSWORD_MIN) return `Mật khẩu tối thiểu ${PASSWORD_MIN} ký tự.`
  if (len > PASSWORD_MAX) return `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`
  if (email && p.trim().toLowerCase() === email.trim().toLowerCase()) return "Không dùng email làm mật khẩu."
  return null
}
