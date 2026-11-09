// ============================================================
// Sổ kinh nghiệm — thu đơn vị từ Google Ads (CHỈ ĐỌC), 180 ngày × 2 nửa kỳ
// ============================================================
// Mỗi sản phẩm chỉ 1–7 chiến dịch (đo 27/09) → học ở cấp cụm tìm kiếm, từ khoá,
// trang đích, thiết bị, khung giờ, tiêu đề RSA.
// BẮT BUỘC chỉ tính chuyển đổi nhóm MUA HÀNG: mục tiêu đặt giá MBI đang gồm
// Thêm giỏ + Bắt đầu thanh toán (đo 27/09) → "conversions" thô sẽ dạy tool học
// từ chiến dịch giỏi kéo người thêm giỏ. Khi tách theo
// segments.conversion_action_category Google KHÔNG cho lấy chi phí cùng lúc
// (và trường đó phải có trong SELECT) → mỗi loại đơn vị = 2 truy vấn: chi phí +
// chuyển đổi Mua hàng, rồi ghép theo khoá.

import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { productGroupOf, PRODUCT_LABEL } from "@/lib/case/product"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import type { FeatureKind, Half, Unit } from "./engine"
import { halvesOf } from "./collect-meta"
import { intentOf, type IntentLexicon } from "@/lib/case/intent"
import { lexiconFor } from "@/lib/case/targets"

/** Nhóm ý định → loại đơn vị riêng. Thương hiệu/tra cứu/sản phẩm khác = khách cũ; đối thủ = không phải cầu tự nhiên. */
/** Gõ sai tên thương hiệu vẫn là tìm thương hiệu (đo 28/09: "mabao" lọt vào nhóm khách mới). */
const BRAND_TYPO = /\b(m[ae]t?\s?b[ao]{1,2}o?|matbao+|mat bao+)\b/
export function intentGroup(text: string, lex: IntentLexicon): { suffix: string; note?: string } {
  const it = BRAND_TYPO.test(stripDiacritics(text)) ? "own_brand" : intentOf(text, lex)
  if (it === "own_brand" || it === "lookup" || it === "own_other") return { suffix: "_brand", note: "Tìm thương hiệu / tra cứu / đăng nhập — phần lớn là KHÁCH CŨ (gia hạn), rẻ vì đằng nào cũng mua; không dùng để dựng chiến dịch tìm khách mới." }
  if (it === "competitor") return { suffix: "_competitor", note: "Tìm tên đối thủ — kết quả phụ thuộc giá thầu cạnh tranh, không tự dùng." }
  return { suffix: "" }
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const PMAX = "campaign.advertising_channel_type = 'PERFORMANCE_MAX'"
const CHANNEL: Record<string, string> = { 2: "Search", 3: "Đối tác tìm kiếm", 4: "Display", 7: "Hỗn hợp", 8: "YouTube", 11: "Gmail", 12: "Discover", 13: "Maps" }
const STOP = new Set(["va", "cua", "cho", "la", "o", "tai", "the", "nao", "gi", "co", "khong", "mot", "cac", "nhung", "voi", "tu", "den", "de", "ve", "tren"])

/** Chủ đề cụm tìm kiếm: cụm 1–2 từ (bỏ dấu, bỏ từ nối) — hàm thuần. */
export function searchThemes(term: string, brandTokens: Set<string> = new Set()): string[] {
  const w = stripDiacritics(term).replace(/[^a-z0-9 .]/g, " ").split(/\s+/).filter((x) => x.length > 1 && !STOP.has(x) && !brandTokens.has(x))
  // Chỉ cụm 2 từ (từ đơn chỉ khi cả lượt tìm có một từ) — đo 28/09: giữ từ đơn thì "kiem", "tra", "kiem tra",
  // "tra ten" thành 4 dòng gần như trùng nhau.
  if (w.length === 1) return [w[0]]
  const out = new Set<string>()
  for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`)
  return [...out]
}
export const hourBand = (h: number) => (h < 6 ? "0–5h" : h < 12 ? "6–11h" : h < 18 ? "12–17h" : "18–23h")

interface Spec {
  unitType: string
  from: string
  /** Trường định danh (ngoài campaign) — ghép khoá + tạo đặc điểm. */
  keyFields: string[]
  where?: string
  /** Thêm vào truy vấn CHUYỂN ĐỔI (segment không lấy được cùng chi phí). */
  convSelect?: string
  convWhere?: string
  note?: string
  key: (r: Row) => string
  name: (r: Row) => string
  features: (r: Row, brandTokens: Set<string>) => Unit["features"]
  /** Văn bản để phân ý định (chỉ cụm tìm kiếm + từ khoá). */
  intentText?: (r: Row) => string
}

const SPECS: Spec[] = [
  { unitType: "search_term", from: "search_term_view", keyFields: ["search_term_view.search_term"],
    key: (r) => `${r.campaign.id}|${r.search_term_view.search_term}`, name: (r) => String(r.search_term_view.search_term), intentText: (r) => String(r.search_term_view.search_term),
    features: (r, bt) => searchThemes(String(r.search_term_view.search_term), bt).map((t) => ({ kind: "search_theme" as FeatureKind, value: t, label: `Cụm tìm kiếm chứa “${t}”` })) },
  { unitType: "keyword", from: "keyword_view", keyFields: ["ad_group_criterion.keyword.text", "ad_group_criterion.keyword.match_type", "ad_group_criterion.criterion_id"],
    key: (r) => `${r.campaign.id}|${r.ad_group_criterion.criterion_id}`, name: (r) => String(r.ad_group_criterion.keyword.text), intentText: (r) => String(r.ad_group_criterion.keyword.text),
    features: (r) => [{ kind: "keyword", value: `${stripDiacritics(String(r.ad_group_criterion.keyword.text))}|${r.ad_group_criterion.keyword.match_type}`, label: `Từ khoá “${r.ad_group_criterion.keyword.text}”` }] },
  { unitType: "landing", from: "landing_page_view", keyFields: ["landing_page_view.unexpanded_final_url"],
    key: (r) => `${r.campaign.id}|${r.landing_page_view.unexpanded_final_url}`, name: (r) => String(r.landing_page_view.unexpanded_final_url),
    features: (r) => { try { const u = new URL(String(r.landing_page_view.unexpanded_final_url)); const v = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`; return [{ kind: "landing" as FeatureKind, value: v, label: `Trang đích ${v}` }] } catch { return [] } } },
  { unitType: "device", from: "campaign", keyFields: ["segments.device"],
    key: (r) => `${r.campaign.id}|${r.segments.device}`, name: (r) => `${r.campaign.name} · ${r.segments.device}`,
    features: (r) => [{ kind: "device", value: String(r.segments.device), label: `Thiết bị ${({ 2: "di động", 3: "máy tính bảng", 4: "máy tính" } as Record<string, string>)[String(r.segments.device)] ?? r.segments.device}` }] },
  { unitType: "hour", from: "campaign", keyFields: ["segments.hour"],
    key: (r) => `${r.campaign.id}|${hourBand(Number(r.segments.hour))}`, name: (r) => `${r.campaign.name} · ${hourBand(Number(r.segments.hour))}`,
    features: (r) => [{ kind: "hour", value: hourBand(Number(r.segments.hour)), label: `Khung giờ ${hourBand(Number(r.segments.hour))}` }] },
  // ── Đợt 10d (F1): học từ PMax. search_term_view chỉ có Search → PMax dùng campaign_search_term_view (đo 28/09: lọc được
  // Mua hàng; KHÔNG tách được đơn sau lượt xem, nhưng lượt tìm vốn là bấm). landing_page_view ở trên đã gồm PMax.
  { unitType: "pmax_search_term", from: "campaign_search_term_view", where: PMAX, keyFields: ["campaign_search_term_view.search_term"],
    key: (r) => `${r.campaign.id}|${r.campaign_search_term_view.search_term}`, name: (r) => String(r.campaign_search_term_view.search_term), intentText: (r) => String(r.campaign_search_term_view.search_term),
    features: (r, bt) => searchThemes(String(r.campaign_search_term_view.search_term), bt).map((t) => ({ kind: "search_theme" as FeatureKind, value: t, label: `Cụm tìm kiếm chứa “${t}”` })) },
  // Asset chữ của PMax: Google không cho tách đơn sau lượt xem theo asset → ghi chú, trần độ tin cậy Trung bình.
  { unitType: "pmax_asset", from: "asset_group_asset", where: `${PMAX} AND asset_group_asset.field_type IN ('HEADLINE', 'LONG_HEADLINE', 'DESCRIPTION')`,
    keyFields: ["asset.id", "asset.text_asset.text", "asset_group_asset.field_type"],
    key: (r) => `${r.campaign.id}|${r.asset.id}`, name: (r) => String(r.asset.text_asset?.text ?? r.asset.id),
    note: "Đơn theo asset PMax gồm cả đơn sau lượt xem (Google không cho tách) — chỉ tham khảo.",
    features: (r) => { const t = String(r.asset.text_asset?.text ?? "").trim(); return t ? [{ kind: "pmax_text" as FeatureKind, value: stripDiacritics(t).replace(/\s+/g, " "), label: `Chữ PMax “${t}”` }] : [] } },
  // Kênh PMax — chỉ đơn từ lượt bấm (bỏ ENGAGED_VIEW: đo 28/09 YouTube MBC 96% "đơn" là xem ≥10 giây không bấm).
  { unitType: "pmax_channel", from: "campaign", where: PMAX, keyFields: ["segments.ad_network_type"],
    convSelect: "segments.conversion_attribution_event_type", convWhere: "segments.conversion_attribution_event_type != 'ENGAGED_VIEW'",
    key: (r) => `${r.campaign.id}|${r.segments.ad_network_type}`, name: (r) => `${r.campaign.name} · ${CHANNEL[String(r.segments.ad_network_type)] ?? r.segments.ad_network_type}`,
    features: (r) => [{ kind: "channel" as FeatureKind, value: CHANNEL[String(r.segments.ad_network_type)] ?? String(r.segments.ad_network_type), label: `Kênh PMax ${CHANNEL[String(r.segments.ad_network_type)] ?? r.segments.ad_network_type}` }] },
]

export async function collectGoogleUnits(company: Company, days = 180, now: Date = new Date()): Promise<{ units: Unit[]; queries: number; notes: string[] }> {
  const c = getGoogleAdsCustomer(company)
  const { h1, h2 } = halvesOf(days, now)
  const notes: string[] = []
  let queries = 0
  const units = new Map<string, Unit>()
  const lex = lexiconFor(company)
  // Mẩu từ của tên thương hiệu ("mat", "bao", "matbao"…) không phải chủ đề — đo 27/09 chúng lên top vì khách cũ.
  const brandTokens = new Set(lex.brand.flatMap((b) => [stripDiacritics(b).replace(/\s+/g, ""), ...stripDiacritics(b).split(/\s+/)])) // KHÔNG thêm net/com/vn: với Tên miền đó là chủ đề mua thật; tìm "matbao net" đã tách nhóm thương hiệu theo ý định
  for (const spec of SPECS) {
    for (const [half, range] of [["h1", h1], ["h2", h2]] as const) {
      const between = `segments.date BETWEEN '${range.since}' AND '${range.until}'`
      const sel = ["campaign.id", "campaign.name", ...spec.keyFields].join(", ")
      try {
        queries += 2
        const w = spec.where ? ` AND ${spec.where}` : ""
        const cost = (await c.query(`SELECT ${sel}, metrics.cost_micros FROM ${spec.from} WHERE ${between}${w} AND metrics.cost_micros > 0`)) as Row[]
        const conv = (await c.query(`SELECT segments.conversion_action_category, ${spec.convSelect ? `${spec.convSelect}, ` : ""}${sel}, metrics.conversions FROM ${spec.from} WHERE ${between}${w} AND segments.conversion_action_category = 'PURCHASE'${spec.convWhere ? ` AND ${spec.convWhere}` : ""}`)) as Row[]
        const purch = new Map<string, number>()
        for (const r of conv) purch.set(spec.key(r), (purch.get(spec.key(r)) ?? 0) + (Number(r.metrics.conversions) || 0))
        const seen = new Set<string>()
        for (const r of [...cost, ...conv]) {
          const k = spec.key(r)
          const cn = String(r.campaign.name)
          const ig = spec.intentText ? intentGroup(spec.intentText(r), lex) : { suffix: "" }
          const u = units.get(`${spec.unitType}|${k}`) ?? {
            platform: "google" as const, company, product: PRODUCT_LABEL[productGroupOf(cn)], unitType: `${spec.unitType}${ig.suffix}`, unitId: `${spec.unitType}|${k}`,
            unitName: spec.name(r), campaignId: String(r.campaign.id), campaignName: cn, features: spec.features(r, brandTokens), ...(ig.note || spec.note ? { nonIncremental: ig.note ?? spec.note } : {}),
            h1: { cost: 0, purchase: 0, initiate_checkout: 0, landing_view: 0 } as Half, h2: { cost: 0, purchase: 0, initiate_checkout: 0, landing_view: 0 } as Half,
          }
          if (!seen.has(k)) { u[half].purchase += purch.get(k) ?? 0; seen.add(k) }
          if (r.metrics.cost_micros !== undefined) u[half].cost += (Number(r.metrics.cost_micros) || 0) / 1_000_000
          units.set(`${spec.unitType}|${k}`, u)
        }
      } catch (e) {
        const x = e as { errors?: { message?: string }[]; message?: string }
        notes.push(`${spec.unitType} ${half}: ${x.errors?.[0]?.message ?? x.message ?? String(e)}`)
      }
    }
  }
  return { units: [...units.values()], queries, notes }
}
