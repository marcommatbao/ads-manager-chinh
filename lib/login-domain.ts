// ============================================================
// Chỉ email công ty được đăng nhập (user yêu cầu 01/10, trước khi mở public)
// ============================================================
// Mặc định: @matbao.com. Đổi danh sách tên miền: ALLOWED_LOGIN_DOMAINS="matbao.com,matbao.net".
// Ngoại lệ từng email (vd tài khoản quản trị cũ dùng gmail): ALLOWED_LOGIN_EMAILS="a@gmail.com,b@x.vn".
// Áp ở: đăng nhập (cả fallback SEO), tạo tài khoản, và mỗi yêu cầu (getCurrentUser) — phiên cũ của email ngoài danh sách
// hết hiệu lực ngay khi deploy.
//
// Đợt 21 A6: bản cài khách thêm danh sách ở trình thiết lập → data/login-allowlist.json { domains, emails }, CỘNG với biến môi
// trường. Tệp có tên miền → bỏ mặc định "matbao.com" (khách không cần nhân viên Mắt Bão đăng nhập), trừ khi biến môi trường ghi.
// Bản Mắt Bão không có tệp → y như cũ.
import fs from "fs"
import path from "path"

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)

export interface LoginAllowlist { domains: string[]; emails: string[] }

const FILE = () => path.join(process.cwd(), "data", "login-allowlist.json")
let cache: { file: string; mtime: number; value: LoginAllowlist } | null = null
const EMPTY: LoginAllowlist = { domains: [], emails: [] }

const DOMAIN_RE = /^(?=.{3,120}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/
const EMAIL_RE = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** Chuẩn hoá danh sách người dùng nhập — HÀM THUẦN. Mục sai dạng bị bỏ. */
export function normalizeAllowlist(v: { domains?: unknown; emails?: unknown }): LoginAllowlist {
  const arr = (x: unknown) => (Array.isArray(x) ? x : typeof x === "string" ? x.split(/[,\s]+/) : []).map((s) => String(s).trim().toLowerCase().replace(/^@/, "")).filter(Boolean)
  return {
    domains: [...new Set(arr(v.domains).filter((d) => DOMAIN_RE.test(d)))].slice(0, 50),
    emails: [...new Set(arr(v.emails).filter((e) => EMAIL_RE.test(e)))].slice(0, 500),
  }
}

export function savedLoginAllowlist(): LoginAllowlist {
  const f = FILE()
  try {
    const mtime = fs.statSync(f).mtimeMs
    if (cache && cache.file === f && cache.mtime === mtime) return cache.value
    const value = normalizeAllowlist(JSON.parse(fs.readFileSync(f, "utf8")))
    cache = { file: f, mtime, value }
    return value
  } catch {
    return EMPTY
  }
}

export async function saveLoginAllowlist(v: LoginAllowlist): Promise<void> {
  const { writeFileAtomic } = await import("@/lib/fs-atomic")
  await writeFileAtomic(FILE(), JSON.stringify(v, null, 2))
}

export function allowedLoginDomains(): string[] {
  const env = list(process.env.ALLOWED_LOGIN_DOMAINS)
  const saved = savedLoginAllowlist().domains
  if (!env.length && !saved.length) return ["matbao.com"]
  return [...new Set([...env, ...saved])]
}

/** Kiểm email với một danh sách CHO TRƯỚC (dùng khi xem thử danh sách mới trước khi lưu). */
export function isEmailAllowedBy(email: string | null | undefined, domains: string[], emails: string[]): boolean {
  const e = String(email ?? "").trim().toLowerCase()
  const at = e.lastIndexOf("@")
  if (at <= 0 || at === e.length - 1) return false
  if (emails.includes(e)) return true
  return domains.includes(e.slice(at + 1))
}

export function isAllowedLoginEmail(email: string | null | undefined): boolean {
  return isEmailAllowedBy(email, allowedLoginDomains(), [...list(process.env.ALLOWED_LOGIN_EMAILS), ...savedLoginAllowlist().emails])
}

export const loginDomainMessage = () => `Chỉ tài khoản email ${allowedLoginDomains().map((d) => "@" + d).join(", ")} được đăng nhập.`
