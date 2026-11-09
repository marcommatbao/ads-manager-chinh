// Đợt 21 B — POST /api/auth/change-password { currentPassword, newPassword }: người dùng tự đổi mật khẩu của mình.
// Đổi xong: bỏ cờ "phải đổi", mọi phiên KHÁC hết hiệu lực (session_version tăng), phiên hiện tại được cấp lại để không bị đá ra.
// Tài khoản đăng nhập qua công cụ SEO (id "seo_…") không có mật khẩu cục bộ → đổi ở công cụ SEO.
import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSessionToken, getCurrentUser, getSessionCookieHeader, hashPassword, verifyPassword } from "@/lib/auth"
import { getMember, updateMember } from "@/lib/team"
import { rateLimit } from "@/lib/rate-limit"
import { writeAuditEntry } from "@/lib/settings/audit"
import { normalizePassword, passwordProblem } from "@/lib/password-policy"

export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status })

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return fail("Phiên đăng nhập đã hết — vui lòng đăng nhập lại.", 401)
  if (user.id.startsWith("seo_")) return fail("Tài khoản này đăng nhập qua công cụ SEO — đổi mật khẩu ở công cụ SEO.")

  const key = `change-password:${crypto.createHash("sha256").update(user.id).digest("hex").slice(0, 32)}`
  if (!(await rateLimit(key, 10, 15 * 60_000)).allowed) return fail("Thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.", 429)

  const body = (await req.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : ""
  const next = typeof body?.newPassword === "string" ? body.newPassword : ""
  if (!current || !next) return fail("Nhập mật khẩu hiện tại và mật khẩu mới.")
  const problem = passwordProblem(next, user.email)
  if (problem) return fail(problem)
  if (normalizePassword(next) === normalizePassword(current)) return fail("Mật khẩu mới phải khác mật khẩu hiện tại.")

  const member = await getMember(user.id)
  if (!member) return fail("Không tìm thấy tài khoản.", 401)
  if (!verifyPassword(current, member.password_hash) && !verifyPassword(normalizePassword(current), member.password_hash)) return fail("Mật khẩu hiện tại không đúng.")

  const updated = await updateMember(user.id, { password_hash: hashPassword(normalizePassword(next)), must_change_password: false })
  if (!updated) return fail("Không tìm thấy tài khoản.", 401)
  await writeAuditEntry("users", user, "update", `user:${user.email} → [password (tự đổi)]`, null, null, "ALL")

  const token = createSessionToken({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, companies: updated.company_access }, updated.session_version ?? 0)
  const res = NextResponse.json({ success: true })
  res.headers.set("Set-Cookie", getSessionCookieHeader(token))
  return res
}
