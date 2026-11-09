// ============================================================
// MCP cho Claude (task #7142, mini-spec docs/mini-specs/MCP-GD1.md) — kho khoá, cài đặt, nhật ký.
// Khoá dạng mcpk_<id 12>_<bí mật 43>; CHỈ lưu SHA-256 (data/mcp-keys.json). Mỗi khoá thuộc một người dùng, mang đúng
// vai trò/công ty của người đó (lib/mcp/auth.ts), mức "read" hoặc "write".
// ============================================================
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomic } from "@/lib/fs-atomic"

export type McpMode = "read" | "write"
export interface McpKey {
  id: string
  userId: string
  name: string
  mode: McpMode
  hash: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

const dataPath = (f: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", f)
const KEYS = () => dataPath("mcp-keys.json")
const SETTINGS = () => dataPath("mcp-settings.json")
const AUDIT = () => dataPath(path.join("audit", "mcp.json"))
const AUDIT_MAX = 5000

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const ID_RE = /^[a-z0-9]{12}$/

function readJson<T>(file: string, empty: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T } catch { return empty }
}

export function listKeys(): McpKey[] {
  return readJson<{ keys: McpKey[] }>(KEYS(), { keys: [] }).keys
}

async function mutateKeys<T>(fn: (keys: McpKey[]) => T): Promise<T> {
  return withFileLock(KEYS(), async () => {
    const data = readJson<{ keys: McpKey[] }>(KEYS(), { keys: [] })
    const out = fn(data.keys)
    fs.mkdirSync(path.dirname(KEYS()), { recursive: true })
    await writeFileAtomic(KEYS(), JSON.stringify(data, null, 2))
    return out
  })
}

/** Tạo khoá — trả khoá thô ĐÚNG MỘT LẦN. */
export async function createKey(input: { userId: string; name: string; mode: McpMode }): Promise<{ key: McpKey; secret: string }> {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
  const id = Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join("")
  const secret = `mcpk_${id}_${crypto.randomBytes(32).toString("base64url")}`
  const key: McpKey = { id, userId: input.userId, name: input.name.trim().slice(0, 60) || "Claude", mode: input.mode, hash: sha256(secret), createdAt: new Date().toISOString() }
  await mutateKeys((keys) => { keys.push(key) })
  return { key, secret }
}

export async function revokeKey(id: string, byUserId: string, isSuperAdmin: boolean): Promise<boolean> {
  return mutateKeys((keys) => {
    const k = keys.find((x) => x.id === id)
    if (!k || k.revokedAt || (!isSuperAdmin && k.userId !== byUserId)) return false
    k.revokedAt = new Date().toISOString()
    return true
  })
}

/** Khoá thô → bản ghi còn hiệu lực (so băm hằng thời gian). Sai dạng / thu hồi / không có → null. */
export function findKey(secret: string): McpKey | null {
  const m = /^mcpk_([a-z0-9]{12})_[A-Za-z0-9_-]{43}$/.exec(secret)
  if (!m || !ID_RE.test(m[1])) return null
  const k = listKeys().find((x) => x.id === m[1])
  if (!k || k.revokedAt) return null
  const a = Buffer.from(sha256(secret), "hex"), b = Buffer.from(k.hash, "hex")
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? k : null
}

export async function touchKey(id: string): Promise<void> {
  await mutateKeys((keys) => { const k = keys.find((x) => x.id === id); if (k) k.lastUsedAt = new Date().toISOString() }).catch(() => {})
}

// ── Cài đặt MCP (Cài đặt → Kết nối Claude) ──────────────────────────────
export interface McpSettings {
  /** Công tắc tổng cho mọi công cụ ghi. */
  writesEnabled: boolean
  maxWritesPerDay: number
  /** Trần ngân sách/ngày cho chiến dịch MỚI do Claude tạo (đơn vị tiền tài khoản). */
  newCampaignMaxDailyBudget: number
}

/** Mặc định: bản Mắt Bão (không chế độ cổng) BẬT ghi theo yêu cầu user 27/10; bản khách (chế độ cổng) TẮT. */
export function defaultSettings(): McpSettings {
  const customerInstall = !!(process.env.MB_CONNECT_URL ?? "").trim()
  return { writesEnabled: !customerInstall, maxWritesPerDay: 20, newCampaignMaxDailyBudget: 500_000 }
}

export function readSettings(): McpSettings {
  const d = defaultSettings()
  const s = readJson<Partial<McpSettings>>(SETTINGS(), {})
  return {
    writesEnabled: typeof s.writesEnabled === "boolean" ? s.writesEnabled : d.writesEnabled,
    maxWritesPerDay: Number.isInteger(s.maxWritesPerDay) && s.maxWritesPerDay! >= 0 && s.maxWritesPerDay! <= 200 ? s.maxWritesPerDay! : d.maxWritesPerDay,
    newCampaignMaxDailyBudget: Number.isFinite(s.newCampaignMaxDailyBudget) && s.newCampaignMaxDailyBudget! > 0 ? s.newCampaignMaxDailyBudget! : d.newCampaignMaxDailyBudget,
  }
}

export async function writeSettings(next: McpSettings): Promise<void> {
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true })
  await writeFileAtomic(SETTINGS(), JSON.stringify(next, null, 2))
}

// ── Nhật ký mọi lần gọi (không ghi nội dung trả về) ─────────────────────
export interface McpAuditEntry {
  at: string
  keyId: string
  userId: string
  tool: string
  args: unknown
  ok: boolean
  ms: number
  error?: string
  /** Lần ghi thật (apply_change thành công) — dùng đếm trần ghi/ngày. */
  write?: boolean
}

export function readAudit(): McpAuditEntry[] {
  return readJson<{ entries: McpAuditEntry[] }>(AUDIT(), { entries: [] }).entries
}

export async function appendAudit(e: McpAuditEntry): Promise<void> {
  await withFileLock(AUDIT(), async () => {
    const data = readJson<{ entries: McpAuditEntry[] }>(AUDIT(), { entries: [] })
    data.entries.push(e)
    if (data.entries.length > AUDIT_MAX) data.entries.splice(0, data.entries.length - AUDIT_MAX)
    fs.mkdirSync(path.dirname(AUDIT()), { recursive: true })
    await writeFileAtomic(AUDIT(), JSON.stringify(data))
  })
}

/** Số lần ghi thật của khoá trong ngày (giờ VN) — đếm từ nhật ký nên bền qua khởi động lại. */
export function writesToday(keyId: string, now = new Date()): number {
  const day = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
  const today = day(now)
  return readAudit().filter((e) => e.keyId === keyId && e.write && e.ok && day(new Date(e.at)) === today).length
}

// ── Giới hạn lượt gọi: 60/phút/khoá (trong bộ nhớ; một tiến trình) ──────
const hits = new Map<string, number[]>()
export function rateLimited(keyId: string, now = Date.now(), max = 60): boolean {
  const arr = (hits.get(keyId) ?? []).filter((t) => now - t < 60_000)
  arr.push(now)
  hits.set(keyId, arr)
  return arr.length > max
}
export function resetRateLimitForTests(): void { hits.clear() }
