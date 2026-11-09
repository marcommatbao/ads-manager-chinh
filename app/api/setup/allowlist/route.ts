// Đợt 21 A6 — PUT /api/setup/allowlist: tên miền / email được đăng nhập (data/login-allowlist.json, CỘNG với biến môi trường).
// Chặn tự khoá mình: danh sách mới phải còn cho email của người đang lưu đăng nhập.
import { NextRequest, NextResponse } from "next/server"
import { requireSetupAdmin } from "@/lib/setup/guard"
import { isEmailAllowedBy, normalizeAllowlist, saveLoginAllowlist, allowedLoginDomains, savedLoginAllowlist } from "@/lib/login-domain"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

const envList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)

export async function PUT(req: NextRequest) {
  const g = await requireSetupAdmin()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { domains?: unknown; emails?: unknown } | null
  if (!body) return NextResponse.json({ success: false, error: "Dữ liệu không hợp lệ" }, { status: 400 })
  const next = normalizeAllowlist(body)
  const envDomains = envList(process.env.ALLOWED_LOGIN_DOMAINS)
  const domains = !envDomains.length && !next.domains.length ? ["matbao.com"] : [...new Set([...envDomains, ...next.domains])]
  const emails = [...envList(process.env.ALLOWED_LOGIN_EMAILS), ...next.emails]
  if (!isEmailAllowedBy(g.user.email, domains, emails)) {
    return NextResponse.json({ success: false, error: `Danh sách mới sẽ khoá chính bạn (${g.user.email}) — thêm tên miền hoặc email của bạn vào.` }, { status: 422 })
  }
  const before = savedLoginAllowlist()
  await saveLoginAllowlist(next)
  await writeAuditEntry("users", g.user, "update", "login-allowlist", before, next, "ALL")
  return NextResponse.json({ success: true, saved: next, effectiveDomains: allowedLoginDomains() })
}
