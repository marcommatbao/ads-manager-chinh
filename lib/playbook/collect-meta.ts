// ============================================================
// Sổ kinh nghiệm — thu đơn vị từ Meta (CHỈ ĐỌC), 180 ngày tách 2 nửa kỳ
// ============================================================
// ~12 lượt gọi cho CẢ HAI công ty (chung một tài khoản quảng cáo): số theo nhóm
// QC, theo nhóm × vị trí, theo nhóm × tuổi/giới, theo quảng cáo (mỗi thứ ×2 nửa
// kỳ) + cấu hình nhóm + nội dung quảng cáo. Chạy hằng tuần nên trong hạn mức.
// Quảng cáo BÀI VIẾT: nội dung đọc bằng token Trang (enrichPostAds · Đợt 8); Trang chưa có token →
// không có đặc điểm câu mở đầu/tiêu đề/trang đích, vẫn có dạng + lời kêu gọi.

import { detectCompany } from "@/lib/company-detect"
import { adAccountId, metaGetAll } from "@/lib/case/meta-graph"
import { enrichPostAds } from "@/lib/meta/page-posts"
import { LANDING_TYPES, optEventOf, pickAction, PURCHASE_TYPES } from "@/lib/case/meta-evidence"
import { placementKey, placementLabel } from "@/lib/case/meta-placements"
import { productGroupOf, PRODUCT_LABEL } from "@/lib/case/product"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import type { FeatureKind, Half, Unit } from "./engine"
import type { CRow } from "./meta-chunks"
import { vnDate } from "@/lib/case/dates"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const IC_TYPES = ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"]

export function halvesOf(days: number, now: Date = new Date()) {
  const d = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10)
  const mid = Math.floor(days / 2)
  return { h1: { since: d(days - 1), until: d(mid) }, h2: { since: d(mid - 1), until: d(0) } }
}

export const halfOf = (r: Row | undefined): Half => ({
  cost: Number(r?.spend) || 0, purchase: pickAction(r?.actions, PURCHASE_TYPES),
  initiate_checkout: pickAction(r?.actions, IC_TYPES), landing_view: pickAction(r?.actions, LANDING_TYPES),
})
const ZERO: Half = { cost: 0, purchase: 0, initiate_checkout: 0, landing_view: 0 }

/** Bậc ngân sách ngày (VND) — đặc điểm "mức ngân sách". */
export function budgetTier(vnd: number | null): string | null {
  if (!vnd) return null
  if (vnd < 100_000) return "<100k"
  if (vnd < 300_000) return "100k–300k"
  if (vnd < 1_000_000) return "300k–1Tr"
  return "≥1Tr"
}
/** Câu mở đầu: câu/dòng đầu tiên, gọn 80 ký tự — so theo bản bỏ dấu, chữ thường. */
export function hookOf(body: string | undefined | null): { value: string; label: string } | null {
  const first = String(body ?? "").split(/\n|(?<=[.!?])\s/)[0]?.trim()
  if (!first || first.length < 8) return null
  const label = first.slice(0, 80)
  return { value: stripDiacritics(label).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(), label }
}

/** Đặc điểm nhóm QC từ cấu hình — hàm thuần. */
export function adsetFeatures(a: Row): Unit["features"] {
  const t = (a.targeting ?? {}) as Row
  const out: Unit["features"] = []
  const f = (kind: FeatureKind, value: string, label?: string) => out.push({ kind, value, label })
  if (t.age_min || t.age_max) f("age", `${t.age_min ?? 18}-${t.age_max ?? 65}`, `Tuổi ${t.age_min ?? 18}–${t.age_max ?? 65}`)
  if (Array.isArray(t.genders) && t.genders.length === 1) f("gender", String(t.genders[0]), t.genders[0] === 1 ? "Chỉ nam" : "Chỉ nữ")
  for (const spec of (t.flexible_spec ?? []) as Row[]) for (const i of (spec.interests ?? []) as Row[]) f("interest", String(i.id), `Sở thích: ${i.name}`)
  f("advantage_audience", String(t.targeting_automation?.advantage_audience === 1), t.targeting_automation?.advantage_audience === 1 ? "Advantage+ đối tượng BẬT" : "Advantage+ đối tượng TẮT")
  f("custom_audience", String(!!(t.custom_audiences?.length)), t.custom_audiences?.length ? "Có tệp tuỳ chỉnh" : "Không tệp tuỳ chỉnh")
  const ev = optEventOf(a.promoted_object, String(a.optimization_goal ?? ""))
  f("opt_event", ev.type === "OTHER" ? `OTHER:${ev.customName}` : ev.type, `Tối ưu theo: ${ev.label}`)
  const tier = budgetTier(Number(a.daily_budget) || null)
  if (tier) f("budget_tier", tier, `Ngân sách ngày ${tier}`)
  return out
}

/** Đặc điểm quảng cáo từ nội dung — hàm thuần. */
export function adFeatures(ad: Row): Unit["features"] {
  const c = (ad.creative ?? {}) as Row
  const out: Unit["features"] = []
  const s = c.object_story_spec ?? {}
  const format = c.object_type === "VIDEO" || s.video_data ? "video" : s.link_data?.child_attachments ? "carousel" : c.effective_object_story_id && !s.link_data ? "post" : "image"
  out.push({ kind: "ad_format", value: format, label: { video: "Dạng video", carousel: "Dạng băng chuyền", post: "Bài viết có sẵn", image: "Dạng ảnh" }[format] })
  const cta = c.call_to_action_type ?? s.link_data?.call_to_action?.type ?? s.video_data?.call_to_action?.type
  if (cta) out.push({ kind: "cta", value: String(cta), label: `Nút: ${cta}` })
  const body = c.body ?? s.link_data?.message ?? s.video_data?.message ?? c.asset_feed_spec?.bodies?.[0]?.text ?? c.__post?.message
  const hook = hookOf(body)
  if (hook) out.push({ kind: "hook", value: hook.value, label: `Mở đầu: “${hook.label}”` })
  const title = c.title ?? s.link_data?.name ?? c.asset_feed_spec?.titles?.[0]?.text ?? c.__post?.title
  if (title) out.push({ kind: "headline", value: stripDiacritics(String(title)).trim(), label: `Tiêu đề: “${String(title).slice(0, 80)}”` })
  const link = s.link_data?.link ?? s.video_data?.call_to_action?.value?.link ?? c.asset_feed_spec?.link_urls?.[0]?.website_url ?? c.__post?.link
  if (link) { try { const u = new URL(String(link)); out.push({ kind: "landing", value: `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`, label: `Trang đích ${u.hostname.replace(/^www\./, "")}${u.pathname}` }) } catch { /* link hỏng */ } }
  return out
}

const coOf = (name: string): Company => detectCompany(name)

/**
 * Đơn vị Meta từ các khoảng 15 ngày ĐÃ LƯU (meta-chunks) + cấu hình nhóm/quảng cáo đọc mới (2 lượt gọi).
 * Chưa đủ 12 khoảng → vẫn chạy với phần đã có, ghi rõ độ phủ.
 */
export async function collectMetaUnits(now: Date = new Date()): Promise<{ units: Unit[]; calls: number; notes: string[]; have: number }> {
  const { loadHalves, CHUNKS_NEEDED } = await import("./meta-chunks")
  const { h1, h2, have } = loadHalves(vnDate(now))
  const notes: string[] = []
  if (have < CHUNKS_NEEDED) notes.push(`Meta mới có ${have}/${CHUNKS_NEEDED} khoảng 15 ngày (đang tải dần mỗi đêm) — kinh nghiệm Meta dựa trên ${have * 15} ngày.`)
  if (!have) return { units: [], calls: 0, notes, have }
  const act = `act_${adAccountId()}`
  const allStatus = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"] }])
  const adsets = await metaGetAll<Row>(`${act}/adsets`, { fields: "id,name,campaign_id,campaign{objective},targeting,promoted_object,optimization_goal,daily_budget", filtering: allStatus, limit: "200" }, 30)
  // Chỉ so chiến dịch BÁN HÀNG — đo 28/09: không lọc thì "tối ưu theo Tương tác bài viết" thành "nên tránh — Cao"
  // chỉ vì chiến dịch tương tác vốn không nhằm ra đơn.
  const SALES = new Set(["OUTCOME_SALES", "CONVERSIONS", "PRODUCT_CATALOG_SALES"])
  const objective = new Map(adsets.map((a) => [String(a.campaign_id), String(a.campaign?.objective ?? "")]))
  const skippedObj = new Set<string>()
  const ads = await metaGetAll<Row>(`${act}/ads`, { fields: "id,name,campaign_id,creative{object_type,body,title,call_to_action_type,effective_object_story_id,object_story_spec{link_data{link,message,name,call_to_action,child_attachments},video_data{message,call_to_action}},asset_feed_spec{bodies,titles,link_urls}}", filtering: allStatus, limit: "200" }, 30)
  const postStats = await enrichPostAds(ads).catch(() => null)
  const cfg = new Map(adsets.map((a) => [String(a.id), a]))
  const adCfg = new Map(ads.map((a) => [String(a.id), a]))
  type Part = "adset" | "placement" | "age" | "gender" | "ad"
  const sum = (chunks: typeof h1, part: Part) => {
    const m = new Map<string, CRow>()
    for (const c of chunks) for (const r of c[part]) {
      const cur = m.get(r.key)
      if (!cur) m.set(r.key, { ...r })
      else { cur.cost += r.cost; cur.purchase += r.purchase; cur.initiate_checkout += r.initiate_checkout; cur.landing_view += r.landing_view }
    }
    return m
  }
  const units: Unit[] = []
  const mk = (part: Part, unitType: string, features: (r: CRow) => Unit["features"] | null, name: (r: CRow) => string) => {
    const a = sum(h1, part), b = sum(h2, part)
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const r = (b.get(k) ?? a.get(k))!
      const obj = objective.get(r.campaignId)
      if (!obj || !SALES.has(obj)) { skippedObj.add(r.campaignId); continue }
      const f = features(r)
      if (!f) continue
      const half = (x?: CRow): Half => (x ? { cost: x.cost, purchase: x.purchase, initiate_checkout: x.initiate_checkout, landing_view: x.landing_view } : ZERO)
      units.push({ platform: "facebook", company: coOf(r.campaignName), product: PRODUCT_LABEL[productGroupOf(r.campaignName)], unitType, unitId: `${unitType}|${k}`,
        unitName: name(r), campaignId: r.campaignId, campaignName: r.campaignName, h1: half(a.get(k)), h2: half(b.get(k)), features: f })
    }
  }
  mk("adset", "adset", (r) => (cfg.has(r.adsetId) ? adsetFeatures(cfg.get(r.adsetId)!) : null), (r) => r.name)
  mk("placement", "adset_placement", (r) => { const [, p, pos] = r.key.split("|"); const key = placementKey(p, pos); return [{ kind: "placement", value: key, label: placementLabel(key) }] }, (r) => r.name.replace(/\|/g, " · "))
  mk("age", "adset_age", (r) => { const a = r.key.split("|")[1]; return [{ kind: "age", value: `band:${a}`, label: `Nhóm tuổi ${a}` }] }, (r) => r.name.replace(/\|/g, " · "))
  mk("gender", "adset_gender", (r) => { const g = r.key.split("|")[1]; return [{ kind: "gender", value: `band:${g}`, label: g === "male" ? "Nam" : g === "female" ? "Nữ" : "Không rõ giới" }] }, (r) => r.name.replace(/\|/g, " · "))
  mk("ad", "ad", (r) => (adCfg.has(r.key) ? adFeatures(adCfg.get(r.key)!) : null), (r) => r.name)
  if (postStats?.read) notes.push(`${postStats.read} quảng cáo bài viết: nội dung đọc bằng token Trang.`)
  const unreadPosts = (postStats?.noToken ?? []).reduce((s, x) => s + x.ads, 0)
  if (unreadPosts) notes.push(`${unreadPosts} quảng cáo bài viết của Trang chưa có token — chỉ có dạng/nút.`)
  if (skippedObj.size) notes.push(`Bỏ qua ${skippedObj.size} chiến dịch không phải mục tiêu Bán hàng (tương tác, lưu lượng, tin nhắn…) — không so với chiến dịch bán hàng.`)
  return { units, calls: 2, notes, have }
}
