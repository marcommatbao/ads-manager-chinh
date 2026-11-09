// ============================================================
// Đợt 10b — KIỂM SOÁT PMax: phủ định · loại thương hiệu · loại vị trí · loại trang/URL · loại tuổi
// ============================================================
// Bước 0 (28/09, validate_only trên 2 tài khoản thật): mọi thao tác ở đây Google chấp nhận. Luồng như mọi đường ghi
// khác: đề xuất (hàm thuần, từ X-quang + số đọc thêm) → "Kiểm trước" (validate_only, không ghi) → gõ XAC NHAN → ghi →
// ĐỌC LẠI từng tài nguyên → nhật ký để HOÀN TÁC (xoá đúng tài nguyên tool tạo / trả lại cài đặt cũ).
// Giới hạn dữ liệu (nói ra ở giao diện): vị trí PMax chỉ có LƯỢT HIỂN THỊ (không chi phí/đơn) → chỉ app di động
// được tích sẵn; kênh YouTube/web để người chọn.

import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { intentOf, type IntentLexicon } from "@/lib/case/intent"
import { lexiconFor } from "@/lib/case/targets"
import { blocks, withAccentVariants, type NegativeKw } from "@/lib/case/simulate-negatives"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import type { PmaxXray, SearchTermRow } from "./xray"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, numT, tk } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const PMAX_CONFIRM_TEXT = "XAC NHAN"
const FILE = path.join(process.cwd(), "data", "pmax-controls.json")
const MAX_OPS = 200

export type ControlKind = "neg_keyword" | "brand_negative" | "placement_exclusion" | "webpage_exclusion" | "url_expansion_off" | "age_exclusion"
export interface ControlProposal {
  id: string
  kind: ControlKind
  /** Cấp chiến dịch (trừ placement_exclusion — cấp tài khoản). */
  campaignId?: string
  campaignName?: string
  label: string
  why: string
  /** Mã ổn định (không phụ thuộc ngôn ngữ) cho các bộ lọc logic — vd "competitor" cho phủ định tên đối thủ. */
  tag?: "competitor"
  /** Tích sẵn khi bằng chứng đủ; bỏ tích khi chỉ là gợi ý. */
  defaultChecked: boolean
  warning?: string
  /** Chi phí đo được đang chảy vào chỗ việc này chặn (₫/kỳ); null = không đo được (vd vị trí). */
  cost: number | null
  payload: { text?: string; match?: "PHRASE" | "EXACT"; placementType?: string; placement?: string; url?: string; ageRange?: string }
}

// ── Dữ liệu đọc thêm (ngoài X-quang) ──
export interface ControlData {
  placements: { campaignId: string; type: string; placement: string; name: string; targetUrl: string; impressions: number }[]
  landing: { campaignId: string; url: string; cost: number; clicks: number; conversions: number }[]
  finalUrls: Record<string, string[]>
  urlExpansion: Record<string, "OPTED_IN" | "OPTED_OUT" | "UNKNOWN">
  existing: { negatives: Record<string, string[]>; webpages: Record<string, string[]>; ages: Record<string, string[]>; placements: string[] }
  /** B5 (10d): Google KHÔNG báo độ tuổi cho PMax → bằng chứng từ chiến dịch Search 90 ngày (age_range_view). */
  ageEvidence?: { age: string; cost: number; conv: number; clicks: number }[]
}
export const AGE_LABEL: Record<string, string> = { AGE_RANGE_18_24: "18–24", AGE_RANGE_25_34: "25–34", AGE_RANGE_35_44: "35–44", AGE_RANGE_45_54: "45–54", AGE_RANGE_55_64: "55–64", AGE_RANGE_65_UP: "65+", AGE_RANGE_UNDETERMINED: "Không rõ" }
export const AGE_BAD_CPA_X = 2
export const AGE_MAX_CONV_SHARE = 0.03

const inv = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k]))
const PT = inv(enums.PlacementType as unknown as Record<string, unknown>)
const AAT = inv(enums.AssetAutomationType as unknown as Record<string, unknown>)
const AAS = inv(enums.AssetAutomationStatus as unknown as Record<string, unknown>)
const AGE = inv(enums.AgeRangeType as unknown as Record<string, unknown>)
const pathKey = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase() } catch { return u.toLowerCase() } }

export async function readControlData(company: Company, range: { from: string; to: string }): Promise<ControlData> {
  const c = getGoogleAdsCustomer(company)
  const between = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const PM = "campaign.advertising_channel_type = 'PERFORMANCE_MAX'"
  const ageFrom = new Date(Date.parse(range.to) - 89 * 86_400_000).toISOString().slice(0, 10)
  const [pl, lp, ag, camp, crit, cust, age] = await Promise.all([
    c.query(`SELECT campaign.id, performance_max_placement_view.display_name, performance_max_placement_view.placement, performance_max_placement_view.placement_type, performance_max_placement_view.target_url, metrics.impressions FROM performance_max_placement_view WHERE ${between} ORDER BY metrics.impressions DESC LIMIT 500`),
    c.query(`SELECT campaign.id, campaign.advertising_channel_type, expanded_landing_page_view.expanded_final_url, metrics.cost_micros, metrics.clicks, metrics.conversions FROM expanded_landing_page_view WHERE ${PM} AND ${between}`),
    c.query(`SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED' AND ${PM}`),
    c.query(`SELECT campaign.id, campaign.asset_automation_settings FROM campaign WHERE ${PM} AND campaign.status = 'ENABLED'`),
    c.query(`SELECT campaign.id, campaign_criterion.type, campaign_criterion.keyword.text, campaign_criterion.webpage.conditions, campaign_criterion.age_range.type FROM campaign_criterion WHERE ${PM} AND campaign_criterion.negative = TRUE AND campaign.status = 'ENABLED'`),
    c.query(`SELECT customer_negative_criterion.type, customer_negative_criterion.placement.url, customer_negative_criterion.mobile_application.app_id, customer_negative_criterion.youtube_channel.channel_id, customer_negative_criterion.youtube_video.video_id FROM customer_negative_criterion`),
    c.query(`SELECT ad_group_criterion.age_range.type, metrics.cost_micros, metrics.conversions, metrics.clicks FROM age_range_view WHERE segments.date BETWEEN '${ageFrom}' AND '${range.to}'`).catch(() => []),
  ]) as Row[][]
  const ageAgg = new Map<string, { age: string; cost: number; conv: number; clicks: number }>()
  for (const r of age) { const k = AGE[r.ad_group_criterion?.age_range?.type] ?? String(r.ad_group_criterion?.age_range?.type); const a = ageAgg.get(k) ?? { age: k, cost: 0, conv: 0, clicks: 0 }; a.cost += (Number(r.metrics.cost_micros) || 0) / 1e6; a.conv += Number(r.metrics.conversions) || 0; a.clicks += Number(r.metrics.clicks) || 0; ageAgg.set(k, a) }
  const add = (m: Record<string, string[]>, k: string, v: string) => { (m[k] ??= []).push(v) }
  const existing: ControlData["existing"] = { negatives: {}, webpages: {}, ages: {}, placements: [] }
  for (const r of crit) {
    const id = String(r.campaign.id), cc = r.campaign_criterion ?? {}
    if (cc.keyword?.text) add(existing.negatives, id, stripDiacritics(String(cc.keyword.text)))
    for (const w of cc.webpage?.conditions ?? []) add(existing.webpages, id, String(w.argument ?? "").toLowerCase())
    if (cc.age_range?.type) add(existing.ages, id, AGE[cc.age_range.type] ?? String(cc.age_range.type))
  }
  for (const r of cust) { const n = r.customer_negative_criterion ?? {}; const v = n.placement?.url ?? n.mobile_application?.app_id ?? n.youtube_channel?.channel_id ?? n.youtube_video?.video_id; if (v) existing.placements.push(String(v).toLowerCase()) }
  const finalUrls: Record<string, string[]> = {}
  for (const r of ag) for (const u of r.asset_group?.final_urls ?? []) add(finalUrls, String(r.campaign.id), pathKey(String(u)))
  const urlExpansion: ControlData["urlExpansion"] = {}
  for (const r of camp) {
    const s = ((r.campaign?.asset_automation_settings ?? []) as Row[]).find((x) => AAT[x.asset_automation_type] === "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION")
    urlExpansion[String(r.campaign.id)] = s ? ((AAS[s.asset_automation_status] as "OPTED_IN" | "OPTED_OUT") ?? "UNKNOWN") : "UNKNOWN"
  }
  const lpAgg = new Map<string, ControlData["landing"][number]>()
  for (const r of lp) {
    const url = String(r.expanded_landing_page_view?.expanded_final_url ?? "")
    const k = `${r.campaign.id}|${pathKey(url)}`
    const x = lpAgg.get(k) ?? { campaignId: String(r.campaign.id), url, cost: 0, clicks: 0, conversions: 0 }
    x.cost += (Number(r.metrics.cost_micros) || 0) / 1e6; x.clicks += Number(r.metrics.clicks) || 0; x.conversions += Number(r.metrics.conversions) || 0
    lpAgg.set(k, x)
  }
  return {
    placements: pl.map((r) => ({ campaignId: String(r.campaign.id), type: PT[r.performance_max_placement_view.placement_type] ?? String(r.performance_max_placement_view.placement_type), placement: String(r.performance_max_placement_view.placement ?? ""), name: String(r.performance_max_placement_view.display_name ?? ""), targetUrl: String(r.performance_max_placement_view.target_url ?? ""), impressions: Number(r.metrics.impressions) || 0 })),
    landing: [...lpAgg.values()], finalUrls, urlExpansion, existing, ageEvidence: [...ageAgg.values()],
  }
}

// ── Đề xuất (hàm thuần) ──
const NEG_INTENTS = new Set(["competitor", "lookup", "info"])
export function proposeControls(x: Pick<PmaxXray, "campaigns" | "terms" | "searchKeywords">, d: ControlData, lex: IntentLexicon, t: TFunction = viT): ControlProposal[] {
  const fmt = (n: number) => numT(t, Math.round(n))
  const out: ControlProposal[] = []
  const camps = new Map(x.campaigns.map((c) => [c.id, c]))
  const enabled = x.campaigns.filter((c) => c.status === "ENABLED")
  const converting = x.terms.rows.filter((tm) => tm.conversions > 0).map((tm) => tm.term)

  // 1. Phủ định lượt tìm đối thủ / tra cứu / hỏi cách làm có bấm mà 0 đơn — theo chiến dịch.
  const byCamp = new Map<string, SearchTermRow[]>()
  for (const tm of x.terms.rows) (byCamp.get(tm.campaignId) ?? byCamp.set(tm.campaignId, []).get(tm.campaignId)!).push(tm)
  for (const [cid, rows] of byCamp) {
    const c = camps.get(cid)
    if (!c || c.status !== "ENABLED") continue
    const have = new Set(d.existing.negatives[cid] ?? [])
    for (const tm of rows) {
      const intent = intentOf(tm.term, lex)
      if (!NEG_INTENTS.has(intent) || tm.conversions > 0 || tm.clicks < 2) continue
      const text = tm.term.toLowerCase().trim()
      if (have.has(stripDiacritics(text))) continue
      const neg: NegativeKw = { text, match: "PHRASE" }
      const hurts = converting.find((ct) => blocks(ct, neg))
      if (hurts) continue // chặn nhầm lượt tìm đã ra đơn → bỏ
      out.push({ id: `neg_${cid}_${stripDiacritics(text).replace(/\s+/g, "_")}`, kind: "neg_keyword", campaignId: cid, campaignName: c.name, label: t("libgoogle.pc.negLabel", { text }),
        why: t("libgoogle.pc.negWhy", { kind: intent === "competitor" ? t("libgoogle.sc.negKindComp") : intent === "lookup" ? t("libgoogle.intent.lookup") : t("libgoogle.sc.negKindInfo"), clicks: tm.clicks }), ...(intent === "competitor" ? { tag: "competitor" as const } : {}), defaultChecked: intent === "competitor" || tm.clicks >= 5, cost: tm.cost, payload: { text, match: "PHRASE" } })
    }
  }

  // 2. Loại lượt tìm THƯƠNG HIỆU mình khỏi PMax — chỉ tích sẵn khi đã có Search đang chạy từ khoá thương hiệu.
  const hasBrandSearch = x.searchKeywords.some((k) => lex.brand.some((b) => stripDiacritics(k).includes(b)))
  for (const c of enabled) {
    const brandRows = (byCamp.get(c.id) ?? []).filter((tm) => intentOf(tm.term, lex) === "own_brand")
    const brandClicks = brandRows.reduce((s, tm) => s + tm.clicks, 0), brandCost = brandRows.reduce((s, tm) => s + tm.cost, 0)
    if (brandClicks < 10) continue
    const have = new Set(d.existing.negatives[c.id] ?? [])
    // Chỉ từ thương hiệu THẬT SỰ có trong lượt tìm của chính chiến dịch này (bộ từ dùng chung 2 công ty — đo 28/09
    // tool từng đề xuất loại "mifi" (MBI) khỏi PMax MBC).
    const seen = brandRows.map((tm) => stripDiacritics(tm.term))
    for (const b of lex.brand.filter((b) => !have.has(b) && seen.some((tm) => tm.includes(b)))) {
      const blockedConv = brandRows.filter((tm) => tm.conversions > 0 && stripDiacritics(tm.term).includes(b)).reduce((s2, tm) => s2 + tm.conversions, 0)
      out.push({ id: `brand_${c.id}_${b.replace(/\s+/g, "_")}`, kind: "brand_negative", campaignId: c.id, campaignName: c.name, label: t("libgoogle.pc.brandLabel", { b }),
        why: t("libgoogle.pc.brandWhy", { n: brandClicks }), defaultChecked: hasBrandSearch, cost: brandCost,
        warning: !hasBrandSearch ? t("libgoogle.pc.brandWarnNoSearch")
          : blockedConv ? t("libgoogle.pc.brandWarnConv", { n: Math.round(blockedConv * 10) / 10 }) : undefined,
        payload: { text: b, match: "PHRASE" } })
    }
  }

  // 3. Loại vị trí cấp TÀI KHOẢN — gộp theo vị trí (một vị trí có thể xuất hiện ở nhiều chiến dịch).
  const pl = new Map<string, { type: string; placement: string; name: string; impressions: number; camps: Set<string> }>()
  for (const p of d.placements) {
    if (!p.placement || d.existing.placements.includes(p.placement.toLowerCase())) continue
    const k = `${p.type}|${p.placement}`
    const x2 = pl.get(k) ?? { type: p.type, placement: p.placement, name: p.name, impressions: 0, camps: new Set<string>() }
    x2.impressions += p.impressions; x2.camps.add(p.campaignId); pl.set(k, x2)
  }
  for (const p of [...pl.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 60)) {
    if (!["MOBILE_APPLICATION", "YOUTUBE_CHANNEL", "YOUTUBE_VIDEO", "WEBSITE"].includes(p.type) || p.impressions < 200) continue
    const app = p.type === "MOBILE_APPLICATION"
    out.push({ id: `pl_${p.type}_${p.placement}`, kind: "placement_exclusion", label: t("libgoogle.pc.plLabel", { kind: app ? t("libgoogle.pc.plApp") : p.type === "WEBSITE" ? t("libgoogle.pc.plWeb") : t("libgoogle.pc.plYt"), name: p.name || p.placement }),
      why: t("libgoogle.pc.plWhy", { n: fmt(p.impressions), c: p.camps.size }), defaultChecked: app, cost: null,
      warning: app ? undefined : t("libgoogle.pc.plWarn"), payload: { placementType: p.type, placement: p.placement } })
  }

  // 4. Trang đích Google tự mở rộng tới (không nằm trong URL của asset group) có chi mà 0 đơn → loại trang.
  for (const l of d.landing) {
    const c = camps.get(l.campaignId)
    if (!c || c.status !== "ENABLED") continue
    const key = pathKey(l.url)
    if ((d.finalUrls[l.campaignId] ?? []).includes(key)) continue
    const minCost = Math.max(200_000, c.cost * 0.05)
    if (l.conversions > 0 || l.cost < minCost) continue
    let u: URL
    try { u = new URL(l.url) } catch { continue }
    const arg = `${u.hostname.replace(/^www\./, "")}${u.pathname}`.replace(/\/+$/, "")
    if ((d.existing.webpages[l.campaignId] ?? []).includes(arg.toLowerCase())) continue
    out.push({ id: `wp_${l.campaignId}_${arg}`, kind: "webpage_exclusion", campaignId: l.campaignId, campaignName: c.name, label: t("libgoogle.pc.wpLabel", { arg }),
      why: t("libgoogle.pc.wpWhy", { cost: fmt(l.cost), clicks: l.clicks }), defaultChecked: true, cost: l.cost, payload: { url: arg } })
  }

  // 5. Mở rộng URL đang BẬT mà trang mở rộng ăn ≥ 30% chi của chiến dịch với CPA tệ hơn trang chính → gợi ý tắt.
  for (const c of enabled) {
    if (d.urlExpansion[c.id] !== "OPTED_IN") continue
    const lps = d.landing.filter((l) => l.campaignId === c.id)
    const exp = lps.filter((l) => !(d.finalUrls[c.id] ?? []).includes(pathKey(l.url)))
    const main = lps.filter((l) => (d.finalUrls[c.id] ?? []).includes(pathKey(l.url)))
    const sum = (xs: typeof lps, f: "cost" | "conversions") => xs.reduce((s, l) => s + l[f], 0)
    const total = sum(lps, "cost"), expCost = sum(exp, "cost")
    if (!total || expCost / total < 0.3) continue
    const cpa = (xs: typeof lps) => (sum(xs, "conversions") ? sum(xs, "cost") / sum(xs, "conversions") : Infinity)
    if (cpa(exp) <= cpa(main)) continue
    out.push({ id: `urlexp_${c.id}`, kind: "url_expansion_off", campaignId: c.id, campaignName: c.name, label: t("libgoogle.pc.urlLabel"),
      why: t("libgoogle.pc.urlWhy", { share: Math.round((expCost / total) * 100), cost: fmt(expCost), cpa: cpa(exp) === Infinity ? t("libgoogle.sx.noOrders") : t("libgoogle.pc.cpaV", { v: fmt(cpa(exp)) }), main: cpa(main) === Infinity ? "—" : t("libgoogle.pc.cpaV", { v: fmt(cpa(main)) }) }),
      defaultChecked: false, cost: expCost, warning: t("libgoogle.pc.urlWarn"), payload: {} })
  }

  // 6. B5 — loại độ tuổi: chỉ khi CPA ≥ 2× trung bình VÀ nhóm tuổi mang < 3% đơn (Search 90 ngày). Đo 28/09 MBC: 55–64 CPA
  //    ₫128k vs ~₫83k (1,5×) → KHÔNG đề xuất — loại tuổi sai là mất khách thật. Không bao giờ tích sẵn.
  const ages = (d.ageEvidence ?? []).filter((a) => a.age !== "AGE_RANGE_UNDETERMINED")
  const tc = ages.reduce((s, a) => s + a.cost, 0), tv = ages.reduce((s, a) => s + a.conv, 0)
  if (tc > 0 && tv >= 30) {
    const avg = tc / tv
    for (const a of ages) {
      const cpa = a.conv > 0 ? a.cost / a.conv : Infinity
      if (a.conv / tv >= AGE_MAX_CONV_SHARE || cpa < AGE_BAD_CPA_X * avg || a.cost < avg * 2) continue
      for (const c of enabled) {
        if ((d.existing.ages[c.id] ?? []).includes(a.age)) continue
        out.push({ id: `age_${c.id}_${a.age}`, kind: "age_exclusion", campaignId: c.id, campaignName: c.name, label: t("libgoogle.pc.ageLabel", { age: AGE_LABEL[a.age] ?? a.age }),
          why: t("libgoogle.pc.ageWhy", { age: AGE_LABEL[a.age] ?? a.age, cost: fmt(a.cost), n: Math.round(a.conv), cpa: cpa === Infinity ? t("libgoogle.sx.noOrders") : t("libgoogle.pc.cpaV", { v: fmt(cpa) }), avg: fmt(avg), pct: (a.conv / tv * 100).toFixed(1) }),
          defaultChecked: false, cost: null, warning: t("libgoogle.pc.ageWarn"), payload: { ageRange: a.age } })
      }
    }
  }
  return out
}

// ── Ghi ──
export interface ControlExecution {
  id: string; company: Company; at: string; by: string; mode: "validate" | "write"; status: "done" | "failed"
  applied: { proposalId: string; label: string; kind: ControlKind; resourceName?: string; previous?: string }[]
  skipped: string[]; errors: string[]
  readback: { label: string; ok: boolean }[]
  undoneAt?: string; undoReport?: string[]
}
export class PmaxControlError extends Error { constructor(message: string, public status = 400) { super(message) } }

function readLog(): ControlExecution[] { try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as ControlExecution[]) : [] } catch { return [] } }
function writeLog(list: ControlExecution[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(list.slice(-300), null, 1)) }
export const listControlExecutions = (company: Company) => readLog().filter((e) => e.company === company).reverse()

/** Kiểm trước / ghi các đề xuất đã chọn. Đề xuất được TÍNH LẠI từ số tươi ở route — client chỉ gửi mã. */
export async function runControls(input: { company: Company; proposals: ControlProposal[]; ids: string[]; actor: string; validateOnly: boolean; confirmText?: string; customerId: string }, t: TFunction = viT): Promise<ControlExecution> {
  const sel = input.proposals.filter((p) => input.ids.includes(p.id))
  if (!sel.length) throw new PmaxControlError(t("libgoogle.sc.errNone"))
  if (sel.length > MAX_OPS) throw new PmaxControlError(t("libgoogle.sc.errMax", { max: MAX_OPS }))
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sc.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  const c = getGoogleAdsCustomer(input.company)
  const cust = input.customerId
  const exec: ControlExecution = { id: `pmaxc_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, mode: input.validateOnly ? "validate" : "write", status: "failed", applied: [], skipped: [], errors: [], readback: [] }
  const camp = (id: string) => `customers/${cust}/campaigns/${id}`

  // Gom theo loại để mỗi loại là MỘT lệnh (lỗi một dòng → báo, không ghi dở cả lô vì mỗi lô đi riêng).
  const negs = sel.filter((p) => p.kind === "neg_keyword" || p.kind === "brand_negative")
  const negOps = negs.flatMap((p) => withAccentVariants([{ text: p.payload.text!, match: p.payload.match ?? "PHRASE" }]).map((n) => ({ p, n })))
  const pages = sel.filter((p) => p.kind === "webpage_exclusion")
  const ages = sel.filter((p) => p.kind === "age_exclusion")
  const places = sel.filter((p) => p.kind === "placement_exclusion")
  const urlOff = sel.filter((p) => p.kind === "url_expansion_off")
  const placementCriterion = (p: ControlProposal) => {
    const v = p.payload.placement!
    if (p.payload.placementType === "MOBILE_APPLICATION") return { mobile_application: { app_id: v.replace(/^mobileapp::/, "") } }
    if (p.payload.placementType === "YOUTUBE_CHANNEL") return { youtube_channel: { channel_id: v.replace(/^youtube::/, "") } }
    if (p.payload.placementType === "YOUTUBE_VIDEO") return { youtube_video: { video_id: v.replace(/^youtube::/, "") } }
    return { placement: { url: v } }
  }
  const vopt = { validate_only: true } as never
  const withOpt = (o: never | undefined) => [
    negOps.length ? { label: t("libgoogle.sc.batchNeg"), n: negOps.map((x) => x.p), run: () => c.campaignCriteria.create(negOps.map(({ p, n }) => ({ campaign: camp(p.campaignId!), negative: true, keyword: { text: n.text, match_type: n.match === "EXACT" ? enums.KeywordMatchType.EXACT : enums.KeywordMatchType.PHRASE } })), o) } : null,
    pages.length ? { label: t("libgoogle.pc.batchPages"), n: pages, run: () => c.campaignCriteria.create(pages.map((p) => ({ campaign: camp(p.campaignId!), negative: true, webpage: { criterion_name: `AdsCommand loại ${p.payload.url}`.slice(0, 250), conditions: [{ operand: enums.WebpageConditionOperand.URL, argument: p.payload.url! }] } })), o) } : null,
    ages.length ? { label: t("libgoogle.pc.batchAges"), n: ages, run: () => c.campaignCriteria.create(ages.map((p) => ({ campaign: camp(p.campaignId!), negative: true, age_range: { type: enums.AgeRangeType[p.payload.ageRange as keyof typeof enums.AgeRangeType] } })), o) } : null,
    places.length ? { label: t("libgoogle.pc.batchPlaces"), n: places, run: () => c.customerNegativeCriteria.create(places.map((p) => placementCriterion(p) as never), o) } : null,
    urlOff.length ? { label: t("libgoogle.pc.batchUrl"), n: urlOff, run: () => c.campaigns.update(urlOff.map((p) => ({ resource_name: camp(p.campaignId!), asset_automation_settings: [{ asset_automation_type: enums.AssetAutomationType.FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION, asset_automation_status: enums.AssetAutomationStatus.OPTED_OUT }] })), o) } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // Kiểm trước MỌI lô (validate_only) — Google từ chối lô nào thì KHÔNG ghi gì.
  for (const b of withOpt(vopt)) { try { await b.run() } catch (e) { exec.errors.push(t("libgoogle.sc.errValidate", { label: b.label, msg: googleAdsErrorMessage(e) })) } }
  if (input.validateOnly) {
    exec.status = exec.errors.length ? "failed" : "done"
    exec.applied = exec.errors.length ? [] : sel.map((p) => ({ proposalId: p.id, label: p.label, kind: p.kind }))
    return exec
  }
  if (exec.errors.length) { await withFileLock(FILE, async () => writeLog([...readLog(), exec])); return exec }
  for (const b of withOpt(undefined)) {
    try {
      const res = (await b.run()) as { results?: { resource_name?: string }[] }
      const names = (res?.results ?? []).map((r) => r.resource_name ?? "")
      b.n.forEach((p, i) => exec.applied.push({ proposalId: p.id, label: p.label, kind: p.kind, resourceName: names[i] || undefined, ...(p.kind === "url_expansion_off" ? { previous: "OPTED_IN" } : {}) }))
    } catch (e) { exec.errors.push(t("libgoogle.sc.errWrite", { label: b.label, msg: googleAdsErrorMessage(e) })) }
  }
  // Đọc lại: tài nguyên tạo ra phải tồn tại; mở rộng URL phải là OPTED_OUT.
  try {
    const created = exec.applied.filter((a) => a.resourceName && a.kind !== "url_expansion_off")
    const critNames = created.filter((a) => a.kind !== "placement_exclusion").map((a) => `'${a.resourceName}'`)
    const custNames = created.filter((a) => a.kind === "placement_exclusion").map((a) => `'${a.resourceName}'`)
    const found = new Set<string>()
    if (critNames.length) for (const r of (await c.query(`SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign_criterion.resource_name IN (${critNames.join(",")})`)) as Row[]) found.add(String(r.campaign_criterion.resource_name))
    if (custNames.length) for (const r of (await c.query(`SELECT customer_negative_criterion.resource_name FROM customer_negative_criterion WHERE customer_negative_criterion.resource_name IN (${custNames.join(",")})`)) as Row[]) found.add(String(r.customer_negative_criterion.resource_name))
    const exp = urlOff.length ? await readControlDataUrl(input.company, urlOff.map((p) => p.campaignId!)) : {}
    exec.readback = exec.applied.map((a) => ({ label: a.label, ok: a.kind === "url_expansion_off" ? exp[sel.find((p) => p.id === a.proposalId)!.campaignId!] === "OPTED_OUT" : !!a.resourceName && found.has(a.resourceName) }))
  } catch (e) { exec.errors.push(t("libgoogle.sc.errReadback", { msg: googleAdsErrorMessage(e) })) }
  exec.status = !exec.errors.length && exec.readback.every((r) => r.ok) ? "done" : "failed"
  await withFileLock(FILE, async () => writeLog([...readLog(), exec]))
  return exec
}

async function readControlDataUrl(company: Company, ids: string[]): Promise<Record<string, string>> {
  const c = getGoogleAdsCustomer(company)
  const rows = (await c.query(`SELECT campaign.id, campaign.asset_automation_settings FROM campaign WHERE campaign.id IN (${ids.map(Number).join(",")})`)) as Row[]
  const out: Record<string, string> = {}
  for (const r of rows) { const s = ((r.campaign?.asset_automation_settings ?? []) as Row[]).find((x) => AAT[x.asset_automation_type] === "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION"); out[String(r.campaign.id)] = s ? AAS[s.asset_automation_status] ?? "UNKNOWN" : "UNKNOWN" }
  return out
}

/** Hoàn tác: xoá đúng tài nguyên tool đã tạo; mở rộng URL trả về OPTED_IN. Tài nguyên đã bị người khác xoá → bỏ qua, báo. */
export async function undoControls(company: Company, execId: string, actor: string, customerId: string, t: TFunction = viT): Promise<string[]> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === execId && e.company === company)
    if (!ex || ex.mode !== "write") throw new PmaxControlError(t("libgoogle.sc.errNoRun"), 404)
    if (ex.undoneAt) throw new PmaxControlError(t("libgoogle.pc.errUndone"), 409)
    const c = getGoogleAdsCustomer(company)
    const report: string[] = []
    const crit = ex.applied.filter((a) => a.resourceName && a.kind !== "placement_exclusion" && a.kind !== "url_expansion_off").map((a) => a.resourceName!)
    const cust = ex.applied.filter((a) => a.resourceName && a.kind === "placement_exclusion").map((a) => a.resourceName!)
    const alive = async (res: string, names: string[]) => {
      if (!names.length) return new Set<string>()
      const rows = (await c.query(`SELECT ${res}.resource_name FROM ${res} WHERE ${res}.resource_name IN (${names.map((n) => `'${n}'`).join(",")})`)) as Row[]
      return new Set(rows.map((r) => String(r[res].resource_name)))
    }
    const aCrit = await alive("campaign_criterion", crit), aCust = await alive("customer_negative_criterion", cust)
    if (aCrit.size) { await c.campaignCriteria.remove([...aCrit]); report.push(t("libgoogle.pc.undoCrit", { n: aCrit.size })) }
    if (aCust.size) { await c.customerNegativeCriteria.remove([...aCust]); report.push(t("libgoogle.pc.undoCust", { n: aCust.size })) }
    const gone = crit.length + cust.length - aCrit.size - aCust.size
    if (gone) report.push(t("libgoogle.pc.undoGone", { n: gone }))
    const urls = ex.applied.filter((a) => a.kind === "url_expansion_off")
    if (urls.length) {
      const ids = urls.map((a) => a.proposalId.replace(/^urlexp_/, ""))
      await c.campaigns.update(ids.map((id) => ({ resource_name: `customers/${customerId}/campaigns/${id}`, asset_automation_settings: [{ asset_automation_type: enums.AssetAutomationType.FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION, asset_automation_status: enums.AssetAutomationStatus.OPTED_IN }] })))
      report.push(t("libgoogle.pc.undoUrl", { n: ids.length }))
    }
    ex.undoneAt = new Date().toISOString()
    ex.undoReport = [t("libgoogle.pc.undoneBy", { actor }), ...report]
    writeLog(log)
    return report
  })
}

export const controlLexicon = (company: Company) => lexiconFor(company)

/** Mã tài khoản Google (không gạch) đọc TẠI LÚC CHẠY — biến có thể được nạp từ Cài đặt sau khi module load. */
export const customerIdOf = (company: Company) => String(process.env[`GOOGLE_ADS_CUSTOMER_ID_${company}`] ?? "").replace(/-/g, "")
