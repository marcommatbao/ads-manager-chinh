// ============================================================
// Đợt 9 · 3 — GỢI Ý bảng link chuẩn từ link quảng cáo đang thực sự chạy (hàm thuần)
// ============================================================
// Đo 28/09: bảng chuẩn MBC chỉ có 9 dòng → 76 quảng cáo MBC bị chấm "lệch chuẩn", phần lớn vì trang/sản phẩm
// CHƯA có dòng nào (vibe-hosting, google_workspace, wp_hosting…), không phải vì gắn sai. Quy ước user (27/09):
// tool KHÔNG tự đặt tên — nên gợi ý GIỮ utm_campaign đang chạy, chỉ chuẩn hoá utm_source/utm_medium theo luật;
// link chưa có utm_campaign thì tên lấy từ đường dẫn và đánh dấu "tool đề xuất". Người duyệt rồi mới vào bảng.

import { parseLink, UTM_RULES, type AdPlatform, type StandardLink } from "./utm-rules"

export interface ObservedLink { url: string; cost: number; campaignName: string }
export interface LinkSuggestion {
  key: string
  company: string
  platform: AdPlatform
  pageKey: string
  /** Link chuẩn đề xuất (utm_source/medium theo luật, utm_campaign giữ như đang chạy). */
  url: string
  label: string
  utmCampaign: string
  /** true = link đang chạy KHÔNG có utm_campaign, tên lấy từ đường dẫn — cần người đặt tên. */
  campaignProposedByTool: boolean
  ads: number
  cost: number
  campaigns: string[]
  /** Các cách gắn đang thấy, vd "facebook_ads / cpc" — để người duyệt biết đang lệch gì. */
  variants: { source: string | null; medium: string | null; count: number }[]
}

const slug = (p: string) => (p.split("/").filter(Boolean).pop() ?? "trang-chu").replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "trang-chu"
const pretty = (s: string) => { const t = s.replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : s }

export function suggestStandardLinks(company: string, platform: AdPlatform, observed: ObservedLink[], table: StandardLink[]): LinkSuggestion[] {
  const rule = UTM_RULES[platform]
  const inTable = new Set(table.filter((l) => l.company === company && l.platform === platform).map((l) => { const p = parseLink(l.url); return p ? `${p.pageKey}|${p.campaign ?? ""}` : "" }))
  const groups = new Map<string, { pageKey: string; origin: string; path: string; campaign: string | null; items: ObservedLink[]; parsed: ReturnType<typeof parseLink>[] }>()
  for (const o of observed) {
    let u: URL
    try { u = new URL(o.url) } catch { continue }
    if (!/^https?:$/.test(u.protocol)) continue
    const p = parseLink(o.url)
    if (!p) continue
    const key = `${p.pageKey}|${p.campaign ?? ""}`
    const g = groups.get(key) ?? { pageKey: p.pageKey, origin: u.origin, path: u.pathname, campaign: p.campaign, items: [], parsed: [] }
    g.items.push(o); g.parsed.push(p)
    groups.set(key, g)
  }
  const out: LinkSuggestion[] = []
  for (const [key, g] of groups) {
    if (inTable.has(key)) continue
    const utmCampaign = g.campaign ?? slug(g.path)
    // Medium đang dùng mà HỢP LỆ theo luật (vd Google "site_link") thì giữ; không thì lấy medium chuẩn đầu tiên.
    const okMedium = g.parsed.map((p) => p?.medium).find((m): m is string => !!m && rule.media.includes(m))
    const medium = okMedium ?? rule.media[0]
    const variants = new Map<string, { source: string | null; medium: string | null; count: number }>()
    for (const p of g.parsed) { const k = `${p?.source}|${p?.medium}`; const v = variants.get(k) ?? { source: p?.source ?? null, medium: p?.medium ?? null, count: 0 }; v.count++; variants.set(k, v) }
    out.push({
      key, company, platform, pageKey: g.pageKey,
      url: `${g.origin}${g.path}?utm_source=${rule.source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(utmCampaign)}`,
      label: pretty(g.campaign ?? slug(g.path)), utmCampaign, campaignProposedByTool: !g.campaign,
      ads: g.items.length, cost: Math.round(g.items.reduce((s, x) => s + x.cost, 0)),
      campaigns: [...new Set(g.items.map((x) => x.campaignName))].slice(0, 5),
      variants: [...variants.values()].sort((a, b) => b.count - a.count),
    })
  }
  return out.sort((a, b) => b.cost - a.cost || b.ads - a.ads)
}
