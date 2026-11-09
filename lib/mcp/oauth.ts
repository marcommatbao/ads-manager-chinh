// ============================================================
// OAuth 2.1 cho MCP (task #7142 GĐ2) — để nối AdsCommand từ claude.ai (Connectors) và Claude Code/Desktop không cần dán khoá.
// Chuẩn: RFC 9728 (protected resource metadata) + RFC 8414 (authorization server metadata) + RFC 7591 (đăng ký client động)
// + PKCE S256 bắt buộc. Mã uỷ quyền 10 phút, dùng 1 lần. "Access token" cấp ra CHÍNH LÀ một khoá MCP (lib/mcp/store) mang
// đúng quyền người bấm Đồng ý + mức Chỉ đọc / Đọc+Ghi họ chọn → hiện ở Cài đặt → Claude, thu hồi được như khoá thường.
// ============================================================
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomic } from "@/lib/fs-atomic"
import { createKey, type McpMode } from "./store"

export interface OAuthClient { client_id: string; client_name: string; redirect_uris: string[]; createdAt: string }
interface OAuthCode { hash: string; clientId: string; userId: string; mode: McpMode; redirectUri: string; challenge: string; expiresAt: string; usedAt?: string }
interface Data { clients: OAuthClient[]; codes: OAuthCode[] }

const CODE_TTL_MS = 10 * 60_000
const FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "mcp-oauth.json")
const read = (): Data => { try { const d = JSON.parse(fs.readFileSync(FILE(), "utf8")) as Data; return { clients: d.clients ?? [], codes: d.codes ?? [] } } catch { return { clients: [], codes: [] } } }
async function mutate<T>(fn: (d: Data) => T): Promise<T> {
  return withFileLock(FILE(), async () => {
    const d = read()
    const now = Date.now()
    d.codes = d.codes.filter((c) => Date.parse(c.expiresAt) > now - 3600_000)
    const out = fn(d)
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    await writeFileAtomic(FILE(), JSON.stringify(d))
    return out
  })
}
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

// Dynamic client registration is public by design, but must not be an unbounded
// disk-write endpoint. This is intentionally process-local; the reverse proxy
// should provide the outer protection in a multi-instance deployment.
const registrationHits = new Map<string, number[]>()
function registrationRateLimited(ip: string, now = Date.now()): boolean {
  const hits = (registrationHits.get(ip) ?? []).filter((t) => now - t < 60 * 60_000)
  hits.push(now)
  registrationHits.set(ip, hits)
  return hits.length > 10
}

export function resetRegistrationRateLimitForTests(): void { registrationHits.clear() }

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

/** Chỉ cho chuyển hướng về Claude (claude.ai / claude.com, https) hoặc máy của chính người dùng (localhost — Claude Code/Desktop). */
export function redirectAllowed(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.hash) return false
  if (u.protocol === "https:" && (u.hostname === "claude.ai" || u.hostname === "claude.com" || u.hostname.endsWith(".claude.ai") || u.hostname.endsWith(".claude.com"))) return true
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")
}

export async function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }, ip = "unknown"): Promise<OAuthClient> {
  if (registrationRateLimited(ip)) throw new OAuthError("temporarily_unavailable", "Too many client registrations; try again later", 429)
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : []
  if (!uris.length || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "redirect_uris required (1–10)")
  const bad = uris.find((u) => !redirectAllowed(u))
  if (bad) throw new OAuthError("invalid_redirect_uri", `redirect_uri not allowed: ${bad} (only claude.ai / claude.com https or localhost)`)
  const c: OAuthClient = {
    client_id: `mcpc_${crypto.randomBytes(12).toString("base64url")}`,
    client_name: String(input.client_name ?? "Claude").slice(0, 80) || "Claude",
    redirect_uris: uris, createdAt: new Date().toISOString(),
  }
  await mutate((d) => { d.clients.push(c); if (d.clients.length > 500) d.clients.splice(0, d.clients.length - 500) })
  return c
}

export function getClient(id: string): OAuthClient | null {
  return read().clients.find((c) => c.client_id === id) ?? null
}

export interface AuthorizeParams { clientId: string; redirectUri: string; state: string; codeChallenge: string; method: string; responseType: string }

/** Kiểm tham số /oauth/authorize. Lỗi client_id/redirect_uri KHÔNG được chuyển hướng (chống chuyển hướng mở) → hiện lỗi tại trang. */
export function validateAuthorize(p: AuthorizeParams): OAuthClient {
  const c = getClient(p.clientId)
  if (!c) throw new OAuthError("invalid_client", "Unknown client_id")
  if (!c.redirect_uris.includes(p.redirectUri)) throw new OAuthError("invalid_request", "redirect_uri not registered for this client")
  if (p.responseType !== "code") throw new OAuthError("unsupported_response_type", "response_type must be code")
  if (p.method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(p.codeChallenge)) throw new OAuthError("invalid_request", "PKCE S256 code_challenge required")
  return c
}

export async function issueCode(p: AuthorizeParams, userId: string, mode: McpMode, now = Date.now()): Promise<string> {
  validateAuthorize(p)
  const code = `mcpa_${crypto.randomBytes(24).toString("base64url")}`
  await mutate((d) => { d.codes.push({ hash: sha256(code), clientId: p.clientId, userId, mode, redirectUri: p.redirectUri, challenge: p.codeChallenge, expiresAt: new Date(now + CODE_TTL_MS).toISOString() }) })
  return code
}

/** code + code_verifier → khoá MCP mới (access token). Mã dùng đúng 1 lần; sai PKCE / hết hạn / khác client → invalid_grant. */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }, now = Date.now()): Promise<{ accessToken: string; mode: McpMode }> {
  const rec = await mutate((d) => {
    const c = d.codes.find((x) => x.hash === sha256(input.code))
    if (!c || c.usedAt || Date.parse(c.expiresAt) <= now) return null
    if (c.clientId !== input.clientId || c.redirectUri !== input.redirectUri) throw new OAuthError("invalid_grant", "client_id / redirect_uri mismatch")
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new OAuthError("invalid_grant", "PKCE verification failed")
    const challenge = crypto.createHash("sha256").update(input.verifier).digest("base64url")
    if (challenge !== c.challenge) throw new OAuthError("invalid_grant", "PKCE verification failed")
    c.usedAt = new Date(now).toISOString()
    return { ...c }
  })
  if (!rec) throw new OAuthError("invalid_grant", "Authorization code invalid, expired or already used")
  const client = getClient(rec.clientId)
  const { secret } = await createKey({ userId: rec.userId, name: `${client?.client_name ?? "Claude"} (OAuth)`, mode: rec.mode })
  return { accessToken: secret, mode: rec.mode }
}
