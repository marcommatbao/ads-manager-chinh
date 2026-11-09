// ============================================================
// Đợt 8 (D) — đọc link + nội dung của quảng cáo BÀI VIẾT bằng token Trang
// ============================================================
// Quảng cáo dựng từ bài có sẵn chỉ mang effective_object_story_id "<pageId>_<postId>"; link nằm trong
// bài. Đọc bài phải dùng TOKEN TRANG (token người dùng hệ thống bị từ chối "Invalid OAuth 2.0" — đo 28/09).
// Nguồn token, theo thứ tự: biến môi trường META_PAGE_TOKENS → Cài đặt → Kết nối → token Trang lấy qua
// /me/accounts của người dùng hệ thống (META_PAGE_ACCESS_TOKEN). Gọi bằng token Trang ăn hạn mức của
// TRANG, không ăn ~60 lượt/giờ của app.
// Đo 28/09: 151 quảng cáo bài viết / 3 Trang; 2 Trang có token đọc được link 6/6 mỗi Trang.

import fs from "fs"
import path from "path"
import { configuredPageTokens } from "@/lib/connections/extra-connections"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { sendTeamsAlert } from "@/lib/teams-alert"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"

const BASE = META_GRAPH_BASE
const CACHE = path.join(process.cwd(), "data", "meta-post-links.json")
const CACHE_DAYS = 7
const MAX_CACHE = 5000
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PostContent { link: string | null; message: string | null; title: string | null }
export interface PostReadStats {
  postAds: number
  read: number
  /** Trang chưa có token → số quảng cáo không đọc được. */
  noToken: { pageId: string; ads: number }[]
  /** Trang có token nhưng token hỏng/hết hiệu lực. */
  tokenErrors: { pageId: string; name: string | null; error: string }[]
}

// ── Hàm thuần ───────────────────────────────────────────────
/** l.facebook.com/l.php?u=<link thật> → link thật. */
export function unwrapFbLink(u: string): string {
  try {
    const x = new URL(u)
    if (/(^|\.)facebook\.com$/.test(x.hostname) && x.pathname === "/l.php" && x.searchParams.get("u")) return x.searchParams.get("u")!
    return u
  } catch { return u }
}
/** Link đích của bài: nút CTA trước, rồi tệp đính kèm. */
export function postContentOf(p: Row): PostContent {
  const att = (p.attachments?.data ?? []) as Row[]
  const raw = p.call_to_action?.value?.link ?? att.map((a) => a.unshimmed_url ?? a.url).find(Boolean) ?? null
  return {
    link: raw ? unwrapFbLink(String(raw)) : null,
    message: p.message ? String(p.message).slice(0, 500) : null,
    title: att.map((a) => a.title).find(Boolean) ?? null,
  }
}
export const storyIdOf = (ad: Row): string | null => {
  const id = ad.creative?.effective_object_story_id ?? ad.creative?.object_story_id
  return id && /^\d+_\d+$/.test(String(id)) ? String(id) : null
}
export const pageOfStory = (storyId: string) => storyId.split("_")[0]

// ── Token Trang ─────────────────────────────────────────────
async function graph(pathQ: string, token: string): Promise<Row> {
  const res = await fetch(`${BASE}/${pathQ}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), cache: "no-store" })
  const j = (await res.json().catch(() => ({}))) as Row
  if (!res.ok || j.error) {
    const e = new Error(String(j.error?.message ?? `HTTP ${res.status}`)) as Error & { code?: number }
    e.code = Number(j.error?.code) || res.status
    throw e
  }
  return j
}

let systemPages: { at: number; map: Map<string, { token: string; name: string }> } | null = null
async function systemUserPages(): Promise<Map<string, { token: string; name: string }>> {
  if (systemPages && Date.now() - systemPages.at < 6 * 3600_000) return systemPages.map
  const map = new Map<string, { token: string; name: string }>()
  const t = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim()
  if (t) {
    try { for (const p of (await graph("me/accounts?fields=id,name,access_token&limit=100", t)).data ?? []) if (p.access_token) map.set(String(p.id), { token: String(p.access_token), name: String(p.name ?? "") }) }
    catch { /* không có quyền → chỉ dùng token cấu hình */ }
  }
  systemPages = { at: Date.now(), map }
  return map
}

const pageNames = new Map<string, string>()
export async function pageTokenMap(): Promise<Map<string, { token: string; name: string | null; source: string }>> {
  const out = new Map<string, { token: string; name: string | null; source: string }>()
  for (const [id, p] of await systemUserPages()) out.set(id, { token: p.token, name: p.name, source: "system_user" })
  for (const p of configuredPageTokens()) out.set(p.pageId, { token: p.token, name: p.name ?? out.get(p.pageId)?.name ?? null, source: p.source })
  // Token đặt bằng biến môi trường chỉ có mã Trang → tra tên bằng chính token Trang (nhớ trong bộ nhớ).
  for (const [id, p] of out) {
    if (p.name) continue
    if (!pageNames.has(id)) { try { pageNames.set(id, String((await graph(`${id}?fields=name`, p.token)).name ?? "")) } catch { pageNames.set(id, "") } }
    p.name = pageNames.get(id) || null
  }
  return out
}
export function resetPageTokenCache(): void { systemPages = null }

/**
 * Người dùng dán token (token Trang, hoặc token NGƯỜI DÙNG dài hạn của người quản trị Trang) → danh sách
 * token TỪNG TRANG. Token người dùng KHÔNG được lưu — chỉ dùng tại chỗ để lấy token Trang.
 */
export async function resolvePastedToken(pasted: string): Promise<{ pages: { pageId: string; name: string; token: string; neverExpires: boolean; canRead: boolean }[]; kind: "user" | "page"; error?: string }> {
  const t = pasted.trim()
  if (!/^EAA[A-Za-z0-9]{50,}$/.test(t)) return { pages: [], kind: "page", error: "Không phải token truy cập Meta (token đúng bắt đầu bằng EAA, dài ~150–250 ký tự). Có thể bạn dán nhầm App Secret / Client Token." }
  let kind: "user" | "page" = "page"
  let list: { id: string; name: string; token: string }[] = []
  try {
    const acc = await graph("me/accounts?fields=id,name,access_token&limit=100", t)
    list = ((acc.data ?? []) as Row[]).filter((p) => p.access_token).map((p) => ({ id: String(p.id), name: String(p.name ?? ""), token: String(p.access_token) }))
    kind = "user"
  } catch { /* token Trang không có /me/accounts */ }
  if (!list.length) {
    try { const me = await graph("me?fields=id,name", t); list = [{ id: String(me.id), name: String(me.name ?? ""), token: t }]; kind = kind === "user" ? "user" : "page" }
    catch (e) { return { pages: [], kind, error: `Meta từ chối token: ${e instanceof Error ? e.message : String(e)}` } }
    if (kind === "user") return { pages: [], kind, error: "Token hợp lệ nhưng tài khoản này không quản trị Trang nào (hoặc thiếu quyền pages_show_list)." }
  }
  const pages: { pageId: string; name: string; token: string; neverExpires: boolean; canRead: boolean }[] = []
  for (const p of list) {
    let neverExpires = false, canRead = false
    try { const d = (await graph(`debug_token?input_token=${encodeURIComponent(p.token)}`, p.token)).data ?? {}; neverExpires = Number(d.expires_at) === 0 } catch { /* không kiểm được hạn */ }
    try { await graph(`${p.id}/posts?limit=1&fields=id`, p.token); canRead = true } catch { canRead = false }
    pages.push({ pageId: p.id, name: p.name, token: p.token, neverExpires, canRead })
  }
  return { pages, kind }
}

// ── Đệm ─────────────────────────────────────────────────────
interface CacheFile { posts: Record<string, PostContent & { at: string }>; alerted?: Record<string, string> }
function readCache(): CacheFile { try { return fs.existsSync(CACHE) ? (JSON.parse(fs.readFileSync(CACHE, "utf-8")) as CacheFile) : { posts: {} } } catch { return { posts: {} } } }
function writeCache(c: CacheFile) {
  const entries = Object.entries(c.posts).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_CACHE)
  try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); writeFileAtomicSync(CACHE, JSON.stringify({ ...c, posts: Object.fromEntries(entries) })) } catch (e) { console.warn("[page-posts] không ghi được đệm:", e) }
}

/** Đọc nội dung nhiều bài (đệm 7 ngày). Trả map storyId → nội dung; bài không đọc được thì vắng mặt. */
export async function readPosts(storyIds: string[], now = Date.now()): Promise<{ posts: Map<string, PostContent>; stats: Omit<PostReadStats, "postAds" | "read"> }> {
  const cache = readCache()
  const fresh = (x?: { at: string }) => x && now - Date.parse(x.at) < CACHE_DAYS * 86_400_000
  const posts = new Map<string, PostContent>()
  const byPage = new Map<string, string[]>()
  for (const id of [...new Set(storyIds)]) {
    const hit = cache.posts[id]
    if (fresh(hit)) { posts.set(id, { link: hit.link, message: hit.message, title: hit.title }); continue }
    byPage.set(pageOfStory(id), [...(byPage.get(pageOfStory(id)) ?? []), id])
  }
  const noToken: PostReadStats["noToken"] = [], tokenErrors: PostReadStats["tokenErrors"] = []
  if (byPage.size) {
    const tokens = await pageTokenMap()
    for (const [pageId, ids] of byPage) {
      const tk = tokens.get(pageId)
      if (!tk) { noToken.push({ pageId, ads: ids.length }); continue }
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50)
        try {
          const j = await graph(`?ids=${batch.join(",")}&fields=message,call_to_action,attachments{unshimmed_url,url,title}`, tk.token)
          for (const id of batch) {
            if (!j[id]) continue
            const c = postContentOf(j[id])
            posts.set(id, c)
            cache.posts[id] = { ...c, at: new Date(now).toISOString() }
          }
        } catch (e) {
          const code = (e as { code?: number }).code
          if (code === 190 || code === 102 || code === 10 || code === 200) { tokenErrors.push({ pageId, name: tk.name, error: e instanceof Error ? e.message : String(e) }); break }
          console.warn(`[page-posts] Trang ${pageId}: ${e instanceof Error ? e.message : e}`) // lỗi nhất thời — lượt sau đọc lại
        }
      }
    }
    writeCache(cache)
  }
  if (tokenErrors.length) await alertTokenErrors(tokenErrors, cache)
  return { posts, stats: { noToken, tokenErrors } }
}

/** Báo kênh IT (TEAMS_WEBHOOK_OPS_ALERTS) — mỗi Trang tối đa 1 lần/ngày (user chốt 28/09). */
async function alertTokenErrors(errs: PostReadStats["tokenErrors"], cache: CacheFile) {
  const today = new Date().toISOString().slice(0, 10)
  const fresh = errs.filter((e) => cache.alerted?.[e.pageId] !== today)
  if (!fresh.length) return
  const r = await sendTeamsAlert({
    title: "Token Trang Facebook hết hiệu lực — không đọc được link quảng cáo bài viết", level: "warning",
    facts: fresh.map((e) => ({ title: e.name ?? e.pageId, value: e.error.slice(0, 200) })),
    action: "Vào AdsCommand → Cài đặt → Kết nối → Trang Facebook: dán token mới (xem Hướng dẫn kết nối → Token Trang).",
  }).catch(() => ({ sent: false }))
  if (r.sent) { cache.alerted = { ...(cache.alerted ?? {}), ...Object.fromEntries(fresh.map((e) => [e.pageId, today])) }; writeCache(cache) }
}

/**
 * Gắn nội dung bài vào quảng cáo bài viết: ad.creative.__post = { link, message, title }.
 * Các hàm đọc link (adLinkKind, linkOfAd, adFeatures) đọc thêm trường này — quảng cáo bài viết được chấm như thường.
 */
export async function enrichPostAds(ads: Row[]): Promise<PostReadStats> {
  const post = ads.map((a) => ({ a, id: storyIdOf(a) })).filter((x): x is { a: Row; id: string } => !!x.id && !hasOwnLink(x.a))
  if (!post.length) return { postAds: 0, read: 0, noToken: [], tokenErrors: [] }
  const { posts, stats } = await readPosts(post.map((x) => x.id))
  let read = 0
  for (const x of post) {
    const c = posts.get(x.id)
    if (c) { x.a.creative = { ...(x.a.creative ?? {}), __post: c }; read++ }
  }
  // noToken đếm theo QUẢNG CÁO (nhiều quảng cáo có thể dùng chung một bài).
  const unread = new Map<string, number>()
  for (const x of post) if (!posts.has(x.id)) unread.set(pageOfStory(x.id), (unread.get(pageOfStory(x.id)) ?? 0) + 1)
  const noTok = new Set(stats.noToken.map((n) => n.pageId))
  return { postAds: post.length, read, noToken: [...unread].filter(([p]) => noTok.has(p)).map(([pageId, n]) => ({ pageId, ads: n })), tokenErrors: stats.tokenErrors }
}

function hasOwnLink(ad: Row): boolean {
  const c = ad.creative ?? {}
  const s = c.object_story_spec ?? {}
  return !!(s.link_data?.link || s.video_data?.call_to_action?.value?.link || c.asset_feed_spec?.link_urls?.length)
}
