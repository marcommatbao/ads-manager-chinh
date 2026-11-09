// ============================================================
// GTM qua Tag Manager API (C1 đọc · C2 ghi) — tài khoản dịch vụ GTM_SERVICE_ACCOUNT_JSON
// ============================================================
// gtm.js công khai (lib/measure/gtm.ts) chỉ cho biết thẻ gửi TÊN gì, không cho biết thẻ
// bắn KHI NÀO. Đo 28/09 qua API: thẻ Google Purchase 249 và Meta Purchase 142 cùng chờ
// sự kiện dataLayer "purchase" mà pixel 26–27/09 nhận 0 lượt Purchase chuẩn → trang không
// đẩy sự kiện đó; thẻ 254 "Google Ads - Add_to_cart" lại bắn theo begin_checkout. Cả hai
// chỉ thấy được khi đọc trigger — nên có API thì đọc API, không có thì lùi về gtm.js.
//
// Khoá chỉ nằm trong biến môi trường; token OAuth giữ trong bộ nhớ ≤ 50 phút, không ghi đĩa.

import crypto from "crypto"
import { gtmServiceAccountSource } from "@/lib/connections/extra-connections"
import type { GtmContainer, GtmPixelTag } from "./gtm"

const API = "https://tagmanager.googleapis.com/tagmanager/v2/"
export const SCOPE_READ = "https://www.googleapis.com/auth/tagmanager.readonly"
export const SCOPE_WRITE = [
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  // Xoá workspace tạm sau "Kiểm trước" — đo 28/09: thiếu scope này thì DELETE bị từ chối, workspace sót lại.
  "https://www.googleapis.com/auth/tagmanager.delete.containers",
].join(" ")

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export class GtmApiError extends Error { constructor(message: string, public status = 0) { super(message) } }

interface ServiceAccount { client_email: string; private_key: string }
/** Khoá lấy từ biến môi trường GTM_SERVICE_ACCOUNT_JSON, không có thì từ Cài đặt → Kết nối (mã hoá). */
export function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount> & { type?: string }
    return sa.client_email && sa.private_key && sa.private_key.includes("PRIVATE KEY") ? { client_email: sa.client_email, private_key: sa.private_key } : null
  } catch { return null }
}
function serviceAccount(): ServiceAccount | null {
  const raw = gtmServiceAccountSource().json
  if (!raw) return null
  return parseServiceAccount(raw)
}
export const gtmApiConfigured = () => serviceAccount() !== null
export const gtmServiceEmail = () => serviceAccount()?.client_email ?? null

const tokens = new Map<string, { token: string; exp: number }>()
async function accessToken(scope: string, override?: ServiceAccount): Promise<string> {
  const sa = override ?? serviceAccount()
  if (!sa) throw new GtmApiError("Chưa kết nối Google Tag Manager — vào Cài đặt → Kết nối → Google Tag Manager")
  const cacheKey = `${sa.client_email}|${scope}` // đổi khoá → không dùng token của khoá cũ
  const hit = tokens.get(cacheKey)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`
  const jwt = `${unsigned}.${crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })
  const j = (await res.json().catch(() => ({}))) as Json
  if (!res.ok || !j.access_token) throw new GtmApiError(`Google không cấp token GTM: ${j.error_description ?? j.error ?? res.status}`, res.status)
  tokens.set(cacheKey, { token: String(j.access_token), exp: Date.now() + 50 * 60_000 })
  return String(j.access_token)
}

/** Token của CÙNG service account cho API Google khác (vd GA4 Data API — Đợt 10c). Chưa kết nối → GtmApiError. */
export const serviceAccountToken = (scope: string) => accessToken(scope)

/** Gọi API; 429/5xx thử lại 1 lần. Lỗi → GtmApiError với câu của Google (không kèm token). */
export async function gtmCall<T = Json>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: object, scope = SCOPE_READ, override?: ServiceAccount): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(API + path, {
        method, signal: AbortSignal.timeout(60_000), cache: "no-store",
        headers: { Authorization: `Bearer ${await accessToken(scope, override)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      // Lỗi mạng (đo 28/09: "fetch failed" lúc tạo workspace). GET/DELETE thử lại an toàn; POST/PUT thử lại 1 lần
      // vì nơi gọi luôn đọc lại trạng thái sau đó (workspace sót được xoá / kiểm lại bản live).
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 2000)); continue }
      const cause = (e as { cause?: { code?: string; message?: string } }).cause
      throw new GtmApiError(`Không kết nối được Tag Manager API (${method} ${path.split("/").slice(-2).join("/")}): ${cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e))}`)
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 2000)); continue }
    const text = await res.text()
    const j = text ? (JSON.parse(text) as Json) : {}
    if (!res.ok) {
      const msg = String(j.error?.message ?? res.statusText)
      throw new GtmApiError(res.status === 403 ? `Tài khoản dịch vụ thiếu quyền trên GTM (${msg})` : `GTM API ${res.status}: ${msg}`, res.status)
    }
    return j as T
  }
}

// ── Cấu hình đang chạy (bản live) ───────────────────────────
export interface GtmTrigger { id: string; name: string; type: string; condition: string; customEvent: string | null }
export interface GtmTag {
  id: string; name: string; type: string; paused: boolean; fingerprint: string
  params: Record<string, string>
  firingTriggerIds: string[]
}
export interface GtmLive {
  publicId: string
  path: string // accounts/<a>/containers/<c>
  versionId: string
  versionName: string
  tags: GtmTag[]
  triggers: GtmTrigger[]
}

const pathCache = new Map<string, string>()
/** GTM-XXXX → accounts/<a>/containers/<c> trong các tài khoản tài khoản dịch vụ thấy được. */
export async function containerPath(publicId: string): Promise<string | null> {
  if (pathCache.has(publicId)) return pathCache.get(publicId)!
  const acc = await gtmCall<{ account?: Json[] }>("GET", "accounts")
  for (const a of acc.account ?? []) {
    const cs = await gtmCall<{ container?: Json[] }>("GET", `accounts/${a.accountId}/containers`)
    for (const c of cs.container ?? []) pathCache.set(String(c.publicId), `accounts/${a.accountId}/containers/${c.containerId}`)
  }
  return pathCache.get(publicId) ?? null
}

const argOf = (f: Json, k: string) => String((f.parameter ?? []).find((p: Json) => p.key === k)?.value ?? "")
export function triggerOf(t: Json): GtmTrigger {
  const conds = [...(t.customEventFilter ?? []), ...(t.filter ?? [])] as Json[]
  const ev = (t.customEventFilter ?? []).find((f: Json) => argOf(f, "arg0") === "{{_event}}" && f.type === "equals")
  return {
    id: String(t.triggerId), name: String(t.name ?? ""), type: String(t.type ?? ""),
    condition: conds.map((f) => `${argOf(f, "arg0")} ${f.type} “${argOf(f, "arg1")}”`).join(" và ") || (t.type === "pageview" ? "mọi trang" : ""),
    customEvent: t.type === "customEvent" && ev ? argOf(ev, "arg1") : null,
  }
}
export function tagOf(t: Json): GtmTag {
  const params: Record<string, string> = {}
  for (const p of (t.parameter ?? []) as Json[]) if (p.value !== undefined) params[String(p.key)] = String(p.value)
  return {
    id: String(t.tagId), name: String(t.name ?? ""), type: String(t.type ?? ""), paused: !!t.paused, fingerprint: String(t.fingerprint ?? ""),
    params, firingTriggerIds: ((t.firingTriggerId ?? []) as unknown[]).map(String),
  }
}

export async function readLive(publicId: string): Promise<GtmLive> {
  const p = await containerPath(publicId)
  if (!p) throw new GtmApiError(`Tài khoản dịch vụ ${gtmServiceEmail() ?? ""} không thấy ${publicId} — thêm email này vào container trong GTM`, 403)
  const v = await gtmCall("GET", `${p}/versions:live`)
  return {
    publicId, path: p, versionId: String(v.containerVersionId), versionName: String(v.name ?? ""),
    tags: ((v.tag ?? []) as Json[]).map(tagOf), triggers: ((v.trigger ?? []) as Json[]).map(triggerOf),
  }
}

// ── Đổi sang dạng bác sĩ gắn thẻ đang dùng (GtmContainer) — hàm thuần ──
const FB_TEMPLATE = /^cvt_\d+_\d+$/
export const isFbTemplate = (t: GtmTag) => FB_TEMPLATE.test(t.type) && "pixelId" in t.params && "eventName" in t.params

export function liveToContainer(live: GtmLive): GtmContainer {
  const trig = new Map(live.triggers.map((t) => [t.id, t]))
  const pixelTags: GtmPixelTag[] = []
  const googleAdsLabels: GtmContainer["googleAdsLabels"] = []
  const tagsDetail: NonNullable<GtmContainer["tagsDetail"]> = []
  for (const t of live.tags) {
    const triggers = t.firingTriggerIds.map((id) => trig.get(id)).filter((x): x is GtmTrigger => !!x)
    if (isFbTemplate(t)) {
      const kind = t.params.eventName === "standard" ? "standard" : "custom"
      const name = kind === "standard" ? t.params.standardEventName : t.params.customEventName
      if (name && !t.paused) pixelTags.push({ tagId: t.id, pixelId: t.params.pixelId ?? null, kind, eventName: name, hasEventId: !!t.params.eventId, source: "template" })
    } else if (t.type === "html" && /fbq\(/.test(t.params.html ?? "") && !t.paused) {
      for (const f of (t.params.html ?? "").matchAll(/fbq\(\s*['"](track|trackCustom)['"]\s*,\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)) {
        pixelTags.push({ tagId: t.id, pixelId: null, kind: f[1] === "trackCustom" ? "custom" : "standard", eventName: f[2], hasEventId: /eventID/.test(t.params.html ?? ""), source: "html" })
      }
    } else if (t.type === "awct" && t.params.conversionId && t.params.conversionLabel && !t.paused) {
      googleAdsLabels.push({ tagId: t.id, sendTo: `AW-${t.params.conversionId}/${t.params.conversionLabel}` })
    }
    if (isFbTemplate(t) || t.type === "awct") {
      tagsDetail.push({
        tagId: t.id, name: t.name, type: isFbTemplate(t) ? "meta" : "google", paused: t.paused,
        eventName: isFbTemplate(t) ? (t.params.eventName === "standard" ? t.params.standardEventName : t.params.customEventName) ?? null : null,
        sendTo: t.type === "awct" ? `AW-${t.params.conversionId}/${t.params.conversionLabel}` : null,
        triggers: triggers.map((x) => ({ id: x.id, name: x.name, condition: x.condition, customEvent: x.customEvent })),
      })
    }
  }
  return {
    id: live.publicId, version: live.versionId, pixelTags, googleAdsLabels,
    source: "api", versionName: live.versionName, tagsDetail,
    triggers: live.triggers.map((x) => ({ id: x.id, name: x.name, condition: x.condition, customEvent: x.customEvent })),
  }
}

/** Kiểm một khoá (mới dán hoặc đang dùng) — CHỈ ĐỌC: liệt kê container thấy được. Không lưu gì. */
export async function testGtmKey(raw?: string): Promise<{ ok: boolean; email: string | null; containers: { publicId: string; name: string; account: string }[]; error?: string }> {
  const sa = raw === undefined ? serviceAccount() : parseServiceAccount(raw)
  if (!sa) return { ok: false, email: null, containers: [], error: raw === undefined ? "Chưa kết nối" : "Không phải tệp JSON khoá tài khoản dịch vụ (thiếu client_email / private_key)" }
  try {
    const acc = await gtmCall<{ account?: Json[] }>("GET", "accounts", undefined, SCOPE_READ, sa)
    const containers: { publicId: string; name: string; account: string }[] = []
    for (const a of acc.account ?? []) {
      const cs = await gtmCall<{ container?: Json[] }>("GET", `accounts/${a.accountId}/containers`, undefined, SCOPE_READ, sa)
      for (const c of cs.container ?? []) containers.push({ publicId: String(c.publicId), name: String(c.name ?? ""), account: String(a.name ?? "") })
    }
    return { ok: containers.length > 0, email: sa.client_email, containers, ...(containers.length ? {} : { error: `Khoá hợp lệ nhưng ${sa.client_email} chưa được thêm vào container GTM nào` }) }
  } catch (e) {
    return { ok: false, email: sa.client_email, containers: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** Gọi khi khoá đổi trong Cài đặt — bỏ đệm đường dẫn container. */
export function resetGtmCaches(): void { pathCache.clear(); tokens.clear() }
