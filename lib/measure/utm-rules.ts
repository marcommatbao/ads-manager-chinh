import { isCompany } from "@/lib/companies/registry";
// ============================================================
// Luật kiểm liên kết Facebook theo bảng link chuẩn — THUẦN, không đụng fs
// ============================================================
// Quy ước của user (chốt 27/09): link nhập TAY theo quy định riêng để dễ kiểm
// soát — utm_source=facebook_ads, utm_medium=cpc_fb, utm_campaign theo SẢN
// PHẨM / trang (vd "hop-dong-dien-tu", "hoa-don-dien-tu-sitelink"). Tool KHÔNG
// tự đặt tên, chỉ so với bảng link chuẩn user nhập và gợi ý đúng link đó.
//
// Hệ quả phải nói ra ở giao diện: một utm_campaign dùng chung cho nhiều chiến
// dịch → doanh thu Odoo đọc theo SẢN PHẨM, không chia được cho từng chiến dịch.
//
// Meta không cho sửa nội dung quảng cáo đã chạy (thay nội dung = duyệt lại),
// nên luật này chỉ PHÁT HIỆN + giao việc (user chốt hướng 1, 27/09).

// Tách khỏi utm-links.ts (27/09): trang giao diện nhập hằng số/hàm từ đây. Nhập từ
// utm-links.ts kéo `fs` vào gói trình duyệt → next build hỏng (tsc/eslint/test đều xanh).

export type AdPlatform = "facebook" | "google"

/**
 * Luật utm theo NỀN TẢNG (user 27/09): cùng một bộ source/medium/campaign cho
 * cả MBI và MBC, chỉ khác source/medium giữa Facebook và Google. Google có 2
 * medium hợp lệ: cpc (URL đích) và site_link (liên kết trang web).
 */
export const UTM_RULES: Record<AdPlatform, { source: string; media: string[] }> = {
  facebook: { source: "facebook_ads", media: ["cpc_fb"] },
  google: { source: "google_ads", media: ["cpc", "site_link"] },
}
/** Giữ tên cũ cho giao diện Đợt 4 (luật Facebook). */
export const REQUIRED_SOURCE = UTM_RULES.facebook.source
export const REQUIRED_MEDIUM = UTM_RULES.facebook.media[0]

export interface StandardLink {
  /** Bảng link chuẩn TÁCH theo công ty: MBI (matbao.in) và MBC (matbao.net) có quy ước riêng.
   *  Đo 27/09: MBC đang dùng utm_medium=cpc cho Vibe Hosting — chấm MBC bằng bảng MBI là báo sai hàng loạt. */
  company: string
  /** Link dùng cho quảng cáo nền tảng nào — quyết định luật source/medium. Tệp cũ thiếu cột này = facebook. */
  platform: AdPlatform
  label: string
  url: string
}

/** 7 link user gửi 27/09 — URL công khai (nằm sẵn trên quảng cáo), dùng làm mặc định khi chưa có tệp. */
export const DEFAULT_LINKS: StandardLink[] = [
  { company: "MBI", platform: "facebook", label: "Hoá đơn điện tử", url: "https://matbao.in/hoa-don-dien-tu?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=hoa-don-dien-tu-sitelink" },
  { company: "MBI", platform: "facebook", label: "Hoá đơn đầu vào", url: "https://matbao.in/hoa-don-dau-vao?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=hoa-don-dau-vao-sitelink" },
  { company: "MBI", platform: "facebook", label: "Chữ ký số", url: "https://matbao.in/bang-gia-chu-ky-so/?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=chu-ky-so-sitelink" },
  { company: "MBI", platform: "facebook", label: "Ký số tập trung", url: "https://matbao.in/ky-so-tap-trung?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=ky-so-tap-trung" },
  { company: "MBI", platform: "facebook", label: "Ký số trên điện thoại", url: "https://matbao.in/kysodienthoai?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=ky-so-tren-dien-thoai" },
  { company: "MBI", platform: "facebook", label: "Hợp đồng điện tử", url: "https://matbao.in/hop-dong-dien-tu/?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=hop-dong-dien-tu" },
  { company: "MBI", platform: "facebook", label: "Dịch vụ ZNS", url: "https://matbao.in/bang-gia-dich-vu-zns/?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=dich_vu_zns" },
  // MBC — user gửi 27/09 (Google + Facebook).
  { company: "MBC", platform: "google", label: "Elastic Cloud Server", url: "https://www.matbao.net/elastic-cloud-server?utm_source=google_ads&utm_medium=cpc&utm_campaign=elastic_cloud_server" },
  { company: "MBC", platform: "google", label: "Cloud WordPress Hosting", url: "https://www.matbao.net/hosting/cloud-wordpress-hosting?utm_source=google_ads&utm_medium=cpc&utm_campaign=wp_hosting" },
  { company: "MBC", platform: "google", label: "Cloud Hosting", url: "https://www.matbao.net/hosting/cloud-hosting?utm_source=google_ads&utm_medium=cpc&utm_campaign=cloud_hosting" },
  { company: "MBC", platform: "google", label: "Cloud Server (liên kết trang)", url: "https://www.matbao.net/server/cloud-server?utm_source=google_ads&utm_medium=site_link&utm_campaign=cloud_server" },
  { company: "MBC", platform: "google", label: "WordPress Ecom Hosting (liên kết trang)", url: "https://www.matbao.net/hosting/wordpress-ecom-hosting?utm_source=google_ads&utm_medium=site_link&utm_campaign=wordpress_ecom_hosting" },
  { company: "MBC", platform: "facebook", label: "Tên miền .cloud", url: "https://www.matbao.net/ten-mien/.cloud?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=cloud" },
  { company: "MBC", platform: "facebook", label: "Tên miền .asia", url: "https://www.matbao.net/ten-mien/.asia?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=asia" },
  { company: "MBC", platform: "facebook", label: "Tên miền .beauty", url: "https://www.matbao.net/ten-mien/.beauty?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=beauty" },
  { company: "MBC", platform: "facebook", label: "Tên miền .skin", url: "https://www.matbao.net/ten-mien/.skin?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=skin" },
]

/** Kiểm từng dòng trước khi lưu — link chuẩn mà chính nó sai quy ước thì vô nghĩa. */
export function validateStandardLinks(links: unknown): string | null {
  if (!Array.isArray(links)) return "Bảng link chuẩn phải là danh sách"
  if (links.length > 200) return "Tối đa 200 dòng"
  for (const [i, l] of links.entries()) {
    const row = l as Partial<StandardLink>
    if (!row || (!isCompany(row.company))) return `Dòng ${i + 1}: công ty phải là MBI hoặc MBC`
    if (typeof row.label !== "string" || !row.label.trim()) return `Dòng ${i + 1}: thiếu tên sản phẩm`
    if (typeof row.url !== "string") return `Dòng ${i + 1}: thiếu link`
    const p = parseLink(row.url)
    if (!p) return `Dòng ${i + 1}: link không hợp lệ`
    if (row.platform !== "facebook" && row.platform !== "google") return `Dòng ${i + 1}: nền tảng phải là facebook hoặc google`
    const rule = UTM_RULES[row.platform]
    if (p.source !== rule.source || !p.medium || !rule.media.includes(p.medium)) return `Dòng ${i + 1}: link ${row.platform === "google" ? "Google" : "Facebook"} phải có utm_source=${rule.source} và utm_medium là ${rule.media.join(" hoặc ")}`
    if (!p.campaign) return `Dòng ${i + 1}: thiếu utm_campaign`
  }
  return null
}

export interface ParsedLink {
  /** host + đường dẫn, bỏ "www.", bỏ "/" cuối, chữ thường — khoá so trang đích. */
  pageKey: string
  source: string | null
  medium: string | null
  campaign: string | null
}

export function parseLink(raw: string): ParsedLink | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    const p = u.pathname.replace(/\/+$/, "").toLowerCase()
    const q = (k: string) => u.searchParams.get(k)?.trim() || null
    return { pageKey: `${host}${p}`, source: q("utm_source"), medium: q("utm_medium"), campaign: q("utm_campaign") }
  } catch {
    return null
  }
}

/**
 * Gộp utm từ `url_tags` của quảng cáo vào link đích (Meta nối url_tags vào
 * cuối link lúc người bấm). Trường hợp trùng khoá, url_tags thắng — đó là thứ
 * Meta thật sự gửi đi.
 */
export function effectiveLink(link: string, urlTags?: string | null): string {
  if (!urlTags) return link
  try {
    const u = new URL(link)
    for (const [k, v] of new URLSearchParams(urlTags.replace(/^\?/, ""))) u.searchParams.set(k, v)
    return u.toString()
  } catch {
    return link
  }
}

export type LinkProblem = "missing_utm" | "wrong_source_medium" | "campaign_not_standard"

export interface LinkCheck {
  ok: boolean
  problems: LinkProblem[]
  /** Mô tả ngắn cho người đọc, vd "đang là utm_source=facebook". */
  detail: string | null
  /** Link chuẩn cùng trang đích (khớp host+path); null = bảng chưa có trang này. */
  suggestion: StandardLink | null
}

export const linksOfCompany = (links: StandardLink[], company: string, platform: AdPlatform = "facebook") =>
  links.filter((l) => l.company === company && (l.platform ?? "facebook") === platform)

/** Các bộ (source, medium, campaign) đang dùng — cho công ty chưa có bảng chuẩn: liệt kê, không chấm. */
export function observedUtm(links: string[]): { source: string | null; medium: string | null; campaign: string | null; count: number }[] {
  const m = new Map<string, { source: string | null; medium: string | null; campaign: string | null; count: number }>()
  for (const l of links) {
    const p = parseLink(l)
    if (!p) continue
    const k = `${p.source}|${p.medium}|${p.campaign}`
    const cur = m.get(k) ?? { source: p.source, medium: p.medium, campaign: p.campaign, count: 0 }
    cur.count++
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

export function checkFacebookLink(link: string, table: StandardLink[]): LinkCheck {
  return checkAdLink(link, table, "facebook")
}

/** Kiểm link theo luật của nền tảng + bảng link chuẩn (đã lọc đúng công ty + nền tảng). */
export function checkAdLink(link: string, table: StandardLink[], platform: AdPlatform): LinkCheck {
  const rule = UTM_RULES[platform]
  const p = parseLink(link)
  const std = table.map((s) => ({ s, p: parseLink(s.url) })).filter((x) => x.p)
  const suggestion = p ? std.find((x) => x.p!.pageKey === p.pageKey)?.s ?? null : null
  if (!p) return { ok: false, problems: ["missing_utm"], detail: "Không đọc được link", suggestion: null }
  if (!p.source && !p.medium && !p.campaign) return { ok: false, problems: ["missing_utm"], detail: null, suggestion }
  const problems: LinkProblem[] = []
  const parts: string[] = []
  if (p.source !== rule.source || !p.medium || !rule.media.includes(p.medium)) {
    problems.push("wrong_source_medium")
    if (p.source !== rule.source) parts.push(`utm_source=${p.source ?? "(trống)"}`)
    if (!p.medium || !rule.media.includes(p.medium)) parts.push(`utm_medium=${p.medium ?? "(trống)"}`)
  }
  const standardCampaigns = new Set(std.map((x) => x.p!.campaign))
  if (!p.campaign) {
    problems.push("missing_utm")
    parts.push("thiếu utm_campaign")
  } else if (!standardCampaigns.has(p.campaign)) {
    problems.push("campaign_not_standard")
    parts.push(`utm_campaign=${p.campaign}`)
  }
  return { ok: problems.length === 0, problems, detail: parts.length ? `đang là ${parts.join(", ")}` : null, suggestion }
}
