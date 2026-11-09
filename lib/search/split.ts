// ============================================================
// Đợt 11b — TÁCH lượt tìm chung khỏi chiến dịch thương hiệu (dựng chiến dịch "Chung" TẠM DỪNG → bật → chuyển từ khoá)
// ============================================================
// Đo 29/09: "MBC - Search-Domain-Brand-HN-HCM" chứa cả "matbao" (₫18tr → 326 đơn) lẫn "tên miền" (₫61tr → 197 đơn) chung MỘT
// ngân sách → mất 57% hiển thị vì ngân sách, lượt tìm thương hiệu (CPA ~₫57k) bị lượt tìm chung (CPA ~₫300k+) ăn trước. Không
// cắt lượt tìm chung (vẫn là đơn) — tách ra chiến dịch riêng có ngân sách/mục tiêu riêng.
// Bước 1 (một lệnh nguyên khối, TẠM DỪNG): ngân sách + chiến dịch chép cài đặt (đặt giá, mạng, kiểu nhắm vị trí, UTM) + vùng/
//         ngôn ngữ/lịch + phủ định của chiến dịch gốc + phủ định THƯƠNG HIỆU + danh sách phủ định dùng chung + nhóm quảng cáo có từ
//         khoá chung (từ khoá chung + RSA chép nguyên). Sau đó chép mục tiêu chuyển đổi cấp chiến dịch (không chặn nếu hỏng).
// Bước 2: người dùng bật chiến dịch mới (tool làm được, XAC NHAN).
// Bước 3: tạm dừng đúng các từ khoá chung đã chép trong chiến dịch gốc (chỉ khi chiến dịch mới ĐANG BẬT — tránh mất lượt tìm).
// Hoàn tác: bước 3 → bật lại từ khoá; bước 1 → gỡ chiến dịch mới (chỉ khi bước 3 đã hoàn tác / chưa làm).

import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { EU_POLITICAL_ADVERTISING_DECLARATION } from "@/lib/google-ads-helpers"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { intentOf, type IntentLexicon } from "@/lib/case/intent"
import { withAccentVariants } from "@/lib/case/simulate-negatives"
import { lexiconFor } from "@/lib/case/targets"

import { rangeDays } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { customerIdOf, PmaxControlError } from "@/lib/pmax/controls"
import { SEARCH_CONFIRM_TEXT } from "./controls"
import { BRAND_INTENTS, searchXray } from "./xray"
import { checkpoint } from "./split-assessment"
import { addDays, vnDate } from "@/lib/case/dates"
import { countByType, describeCounts, linkSourceAssets, readCampaignAssets, type AssetCount, type AssetReport } from "./split-assets"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, numT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: unknown) => Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k])) as Record<number, string>
const BID = inv(enums.BiddingStrategyType), MATCH = inv(enums.KeywordMatchType), CT = inv(enums.CriterionType), STATUS = inv(enums.CampaignStatus)

export interface SplitKeyword { criterion: string; adGroupId: string; text: string; match: string; cpcMicros: number | null; cost: number; purchases: number }
export interface SplitAdGroup { sourceId: string; name: string; cpcMicros: number | null; keywords: SplitKeyword[]; ads: { headlines: { text: string; pinned_field?: number }[]; descriptions: { text: string; pinned_field?: number }[]; finalUrls: string[]; path1?: string; path2?: string }[] }
export interface SplitPlan {
  sourceId: string; sourceName: string; newName: string
  bidding: string; budgetPerDay: number; genericCostPerDay: number
  adGroups: SplitAdGroup[]; skippedAdGroups: string[]
  brandNegatives: string[]; brandKeywords: number
  notes: string[]
  /** Đợt 18a: tài sản cấp chiến dịch + cấp nhóm (của các nhóm được chuyển) sẽ gắn sang chiến dịch mới. null = không đọc được. */
  assets: { campaign: AssetCount[]; adGroup: AssetCount[] } | null
  /** CPA mục tiêu chiến dịch gốc đang đặt (₫) — để UI cho chọn "không đặt / giữ / đặt mới". null = gốc không đặt. */
  sourceTargetCpa: number | null
  /** Ngân sách/ngày chiến dịch gốc (₫); sourceBudgetShared = ngân sách dùng chung → tool không đổi. */
  sourceBudgetPerDay: number | null; sourceBudgetShared: boolean
}

export type CpaMode = "none" | "keep" | "set"

/** Từ khoá nào là "chung" (chuyển đi) — HÀM THUẦN. Đối thủ đi theo nhóm chung (không phải thương hiệu mình). */
export const isGenericKeyword = (text: string, lex: IntentLexicon) => !BRAND_INTENTS.includes(intentOf(text, lex))

/** Phủ định thương hiệu cho chiến dịch mới: từ khoá thương hiệu của chiến dịch gốc + bộ từ thương hiệu — HÀM THUẦN. */
/**
 * Lỗi Google chỉ ghi "mutate_operations[14]" — đổi thành thao tác cụ thể (vd từ khoá phủ định "x", vùng geoTargetConstants/2704)
 * để biết Google từ chối CÁI GÌ (user 01/10: 9 dòng criterion_error 39 không biết là gì). Gộp các thao tác cùng lỗi — HÀM THUẦN.
 */
export function explainFailedOps(message: string, ops: object[], t: TFunction = viT): string {
  const idx = [...new Set([...message.matchAll(/mutate_operations\[(\d+)\]/g)].map((m) => Number(m[1])))]
  if (!idx.length) return message
  const what = (i: number) => {
    const o = ops[i] as { entity?: string; resource?: Record<string, any> } | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = o?.resource ?? {}
    if (o?.entity === "campaign_criterion") {
      if (r.keyword) return t("libgoogle.sp.opKwText", { kind: r.negative ? t("libgoogle.sp.opNeg") : t("libgoogle.sp.opKw"), text: r.keyword.text })
      if (r.location) return t("libgoogle.sp.opGeoText", { kind: r.negative ? t("libgoogle.sp.opGeoExcl") : t("libgoogle.sp.opGeo"), id: String(r.location.geo_target_constant).split("/").pop()! })
      if (r.language) return t("libgoogle.sp.opLang", { id: String(r.language.language_constant).split("/").pop()! })
      if (r.ad_schedule) return t("libgoogle.sp.opSchedule")
      return t("libgoogle.sp.opCriterion")
    }
    if (o?.entity === "ad_group_criterion" && r.keyword) return t("libgoogle.sp.opAgKw", { text: r.keyword.text })
    return o?.entity ?? t("libgoogle.sp.opN", { i })
  }
  const first = message.split(/ · |\. \(/)[0].replace(/\s*\(trường:.*$/, "").trim()
  const codes = [...new Set([...message.matchAll(/\[([a-z_]+_error: \d+)\]/g)].map((m) => m[1]))].join(", ")
  return t("libgoogle.sp.explain", { first, codes: codes ? ` [${codes}]` : "", n: idx.length, list: idx.slice(0, 15).map(what).join(" · "), more: idx.length > 15 ? ` · +${idx.length - 15}` : "" })
}

/**
 * Lỗi kiểm CHỈ gồm "Criterion is not allowed to be targeted" (criterion_error 39) trên vùng LOẠI TRỪ → chỉ số các thao tác bỏ được;
 * còn lỗi khác / vùng nhắm tới (bỏ vùng nhắm tới = chạy rộng hơn gốc) → null, giữ nguyên lỗi — HÀM THUẦN.
 */
export function droppableLocationOps(message: string, ops: object[]): number[] | null {
  const idx = [...new Set([...message.matchAll(/mutate_operations\[(\d+)\]/g)].map((m) => Number(m[1])))]
  const codes = new Set([...message.matchAll(/\[([a-z_]+_error: \d+)\]/g)].map((m) => m[1]))
  if (!idx.length || codes.size !== 1 || !codes.has("criterion_error: 39")) return null
  const ok = idx.every((i) => { const o = ops[i] as { entity?: string; resource?: { negative?: boolean; location?: unknown } } | undefined; return o?.entity === "campaign_criterion" && !!o.resource?.location && o.resource.negative === true })
  return ok ? idx : null
}

/** Đổi ngân sách/ngày chiến dịch GỐC (không đụng ngân sách dùng chung); lưu mức trước để hoàn tác. Ném lỗi để nơi gọi báo. */
async function setSourceBudget(company: Company, r: SplitRecord, amount: number, actor: string, t: TFunction = viT): Promise<void> {
  const c = getGoogleAdsCustomer(company)
  const [row] = (await c.query(`SELECT campaign.id, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${Number(r.sourceId)}`)) as Row[]
  if (!row?.campaign_budget?.resource_name) throw new PmaxControlError(t("libgoogle.sp.errNoBudget"), 502)
  if (row.campaign_budget.explicitly_shared) throw new PmaxControlError(t("libgoogle.sp.errSharedBudget"), 409)
  const before = Math.round(Number(row.campaign_budget.amount_micros) / 1e6)
  await c.campaignBudgets.update([{ resource_name: row.campaign_budget.resource_name, amount_micros: amount * 1e6 }] as never)
  r.sourceBudget = { target: r.sourceBudget?.target ?? amount, before: r.sourceBudget?.before ?? before, appliedAt: new Date().toISOString() }
  if (amount === r.sourceBudget.before) r.sourceBudget = { target: r.sourceBudget.target }
  r.log.push(`${actor}: ngân sách chiến dịch gốc ₫${before.toLocaleString("vi-VN")} → ₫${amount.toLocaleString("vi-VN")}/ngày`)
}

async function geoNames(c: ReturnType<typeof getGoogleAdsCustomer>, res: string[]): Promise<Map<string, string>> {
  const ids = res.map((r) => r.split("/").pop()).filter((x): x is string => !!x && /^\d+$/.test(x))
  if (!ids.length) return new Map()
  try {
    const rows = (await c.query(`SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.target_type FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.join(", ")})`)) as Row[]
    return new Map(rows.map((r) => [String(r.geo_target_constant.resource_name), `${r.geo_target_constant.name}${r.geo_target_constant.target_type ? ` (${String(r.geo_target_constant.target_type).toLowerCase()})` : ""}`]))
  } catch { return new Map() }
}

export function brandNegativesOf(brandTexts: string[], lex: IntentLexicon): string[] {
  const base = [...new Set([...lex.brand, ...brandTexts].map((t) => t.normalize("NFC").toLowerCase().replace(/[+"[\]]/g, "").trim()).filter((t) => t && t.split(/\s+/).length <= 3))]
  const out = new Map<string, string>()
  for (const n of withAccentVariants(base.map((text) => ({ text, match: "PHRASE" as const })))) out.set(n.text.normalize("NFC"), n.text.normalize("NFC"))
  return [...out.values()].slice(0, 80)
}

async function readSource(company: Company, campaignId: string, t: TFunction = viT) {
  const c = getGoogleAdsCustomer(company)
  const id = Number(campaignId)
  const [camp] = (await c.query(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.bidding_strategy, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas, campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type, campaign.final_url_suffix, campaign.tracking_url_template, campaign_budget.amount_micros, campaign_budget.resource_name, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${id}`)) as Row[]
  if (!camp || camp.campaign.advertising_channel_type !== enums.AdvertisingChannelType.SEARCH) throw new PmaxControlError(t("libgoogle.sp.errNoSearch"), 404)
  const [crit, groups, kws, ads, shared, goals] = await Promise.all([
    c.query(`SELECT campaign_criterion.type, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.start_minute, campaign_criterion.ad_schedule.end_minute, campaign_criterion.device.type FROM campaign_criterion WHERE campaign.id = ${id}`) as Promise<Row[]>,
    c.query(`SELECT ad_group.id, ad_group.name, ad_group.cpc_bid_micros, ad_group.status FROM ad_group WHERE campaign.id = ${id} AND ad_group.status = 'ENABLED'`) as Promise<Row[]>,
    c.query(`SELECT ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.cpc_bid_micros, ad_group_criterion.negative FROM ad_group_criterion WHERE campaign.id = ${id} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status = 'ENABLED' AND ad_group.status = 'ENABLED'`) as Promise<Row[]>,
    c.query(`SELECT ad_group.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2 FROM ad_group_ad WHERE campaign.id = ${id} AND ad_group_ad.status = 'ENABLED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`) as Promise<Row[]>,
    c.query(`SELECT campaign_shared_set.shared_set, shared_set.type, campaign_shared_set.status FROM campaign_shared_set WHERE campaign.id = ${id} AND campaign_shared_set.status = 'ENABLED'`) as Promise<Row[]>,
    c.query(`SELECT campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign.id = ${id}`).catch(() => null) as Promise<Row[] | null>,
  ])
  return { camp, crit, groups, kws, ads, shared, goals }
}

export async function planSplit(company: Company, campaignId: string, range: { from: string; to: string }, t: TFunction = viT): Promise<SplitPlan> {
  const [src, x, assetRows] = await Promise.all([readSource(company, campaignId, t), searchXray(company, range), readCampaignAssets(company, campaignId).catch(() => null)])
  const lex = lexiconFor(company)
  const kwStats = new Map(x.keywords.map((k) => [k.criterion, k]))
  const positives = src.kws.filter((r) => !r.ad_group_criterion.negative)
  const generic = positives.filter((r) => isGenericKeyword(String(r.ad_group_criterion.keyword.text), lex))
  const brand = positives.filter((r) => !isGenericKeyword(String(r.ad_group_criterion.keyword.text), lex))
  const adGroups: SplitAdGroup[] = [], skipped: string[] = []
  for (const g of src.groups) {
    const gid = String(g.ad_group.id)
    const ks = generic.filter((r) => String(r.ad_group.id) === gid)
    if (!ks.length) continue
    const ads = src.ads.filter((a) => String(a.ad_group.id) === gid).map((a) => {
      const rsa = a.ad_group_ad.ad.responsive_search_ad ?? {}
      const tx = (xs: Row[] = []) => xs.map((h) => ({ text: String(h.text), ...(h.pinned_field ? { pinned_field: Number(h.pinned_field) } : {}) }))
      return { headlines: tx(rsa.headlines), descriptions: tx(rsa.descriptions), finalUrls: (a.ad_group_ad.ad.final_urls ?? []).map(String), ...(rsa.path1 ? { path1: String(rsa.path1) } : {}), ...(rsa.path2 ? { path2: String(rsa.path2) } : {}) }
    })
    if (!ads.length) { skipped.push(t("libgoogle.sp.skipNoRsa", { name: String(g.ad_group.name) })); continue }
    adGroups.push({ sourceId: gid, name: String(g.ad_group.name), cpcMicros: Number(g.ad_group.cpc_bid_micros) || null, ads,
      keywords: ks.map((r) => { const s = kwStats.get(String(r.ad_group_criterion.resource_name)); return { criterion: String(r.ad_group_criterion.resource_name), adGroupId: gid, text: String(r.ad_group_criterion.keyword.text), match: MATCH[r.ad_group_criterion.keyword.match_type] ?? "PHRASE", cpcMicros: Number(r.ad_group_criterion.cpc_bid_micros) || null, cost: s?.cost ?? 0, purchases: s?.purchases ?? 0 } }) })
  }
  const days = Math.max(1, rangeDays(range))
  const genericCost = adGroups.flatMap((g) => g.keywords).reduce((s, k) => s + k.cost, 0)
  const notes: string[] = []
  if (src.crit.some((r) => CT[r.campaign_criterion.type] === "DEVICE" && Number(r.campaign_criterion.bid_modifier) && Number(r.campaign_criterion.bid_modifier) !== 1)) notes.push(t("libgoogle.sp.noteDevice"))
  const srcBudget = Number(src.camp.campaign_budget?.amount_micros) / 1e6 || 0
  const newBudget = Math.max(50_000, Math.round(genericCost / days / 10_000) * 10_000)
  if (srcBudget) notes.push(t("libgoogle.sp.noteBudget", { from: numT(t, srcBudget), to: numT(t, srcBudget + newBudget) }))
  if (src.camp.campaign.bidding_strategy) notes.push(t("libgoogle.sp.notePortfolio"))
  const movedIds = new Set(adGroups.map((g) => g.sourceId))
  const assets = assetRows ? { campaign: countByType(assetRows.filter((a) => !a.adGroupId), t), adGroup: countByType(assetRows.filter((a) => a.adGroupId && movedIds.has(a.adGroupId)), t) } : null
  if (!assetRows) notes.push(t("libgoogle.sp.noteNoAssets"))
  return {
    sourceId: campaignId, sourceName: String(src.camp.campaign.name), newName: `${src.camp.campaign.name} · Chung (AdsCommand)`.slice(0, 250),
    bidding: BID[src.camp.campaign.bidding_strategy_type] ?? String(src.camp.campaign.bidding_strategy_type),
    budgetPerDay: newBudget, genericCostPerDay: Math.round(genericCost / days),
    adGroups, skippedAdGroups: skipped, brandKeywords: brand.length,
    brandNegatives: brandNegativesOf(brand.map((r) => String(r.ad_group_criterion.keyword.text)), lex), notes, assets,
    sourceTargetCpa: sourceTargetCpaOf(src.camp), sourceBudgetPerDay: srcBudget || null, sourceBudgetShared: !!src.camp.campaign_budget?.explicitly_shared,
  }
}

// ── Ghi ──
const FILE = path.join(process.cwd(), "data", "search-splits.json")
export interface SplitRecord {
  id: string; company: Company; at: string; by: string; sourceId: string; sourceName: string
  newCampaign?: string; newBudget?: string; name: string; budgetPerDay: number
  movedKeywords: string[]; keywordsCount: number; adGroupsCount: number
  step: "created" | "moved" | "removed" | "failed"; errors: string[]; goalReport?: string
  /** Ngân sách/ngày chiến dịch gốc: target = hạ về khi chuyển từ khoá (phương án "Giữ tổng"); before = trước khi tool đổi (để hoàn tác). */
  sourceBudget?: { target: number; before?: number; appliedAt?: string }
  /** Lúc chuyển từ khoá (bước 3) — mốc đo lại 7/14 ngày. */
  movedAt?: string
  log: string[]
  /** Đợt 18: các lần gắn tài sản từ chiến dịch gốc (lần đầu lúc tách + mỗi lần bổ sung). */
  assetReports?: AssetReport[]
  /** Đợt 18f: kết quả đo tự động theo mốc. */
  checkpoints?: Partial<Record<"7" | "14", { at: string; verdict: "tot" | "theo_doi" | "dung"; lines: string[] }>>
  /** Đợt 18g: lần nhắc gần nhất (chống nhắc lặp). */
  lastReminderAt?: string
  /** Đợt 18f: id nhóm gốc → tên (để map tài sản cấp nhóm khi bổ sung). */
  movedAdGroups?: { sourceId: string; name: string }[]
}
function readLog(): SplitRecord[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SplitRecord[] } catch { return [] } }
function writeLog(l: SplitRecord[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-100), null, 1)) }
export const listSplits = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 20)
/** Đợt 15b: toàn bộ bản tách (luồng ghi chung). */
export const allSplits = () => readLog()

/**
 * Bản tách đang dùng → nhóm gốc ↔ nhóm cùng tên ở chiến dịch "· Chung" (1 truy vấn Google Ads). Dùng để đề xuất thêm lượt tìm chung
 * vào bản tách thay vì chiến dịch thương hiệu. Lỗi → Map rỗng (đề xuất chỉ bị bỏ, không sai chỗ).
 */
export async function splitTargets(company: Company): Promise<Map<string, import("./controls").SplitTarget>> {
  const recs = readLog().filter((r) => r.company === company && (r.step === "created" || r.step === "moved") && r.newCampaign)
  const out = new Map<string, import("./controls").SplitTarget>()
  if (!recs.length) return out
  const newId = (r: SplitRecord) => String(r.newCampaign).split("/").pop()!
  const ids = [...new Set(recs.flatMap((r) => [r.sourceId, newId(r)]))].filter((x) => /^\d+$/.test(x))
  try {
    const rows = (await getGoogleAdsCustomer(company).query(`SELECT campaign.id, ad_group.id, ad_group.name FROM ad_group WHERE campaign.id IN (${ids.join(", ")}) AND ad_group.status != 'REMOVED'`)) as Row[]
    const byCamp = new Map<string, { id: string; name: string }[]>()
    for (const g of rows) (byCamp.get(String(g.campaign.id)) ?? byCamp.set(String(g.campaign.id), []).get(String(g.campaign.id))!).push({ id: String(g.ad_group.id), name: String(g.ad_group.name) })
    for (const r of recs) {
      const dst = new Map((byCamp.get(newId(r)) ?? []).map((g) => [g.name, g.id]))
      const m = new Map<string, string>()
      for (const g of byCamp.get(r.sourceId) ?? []) { const t = dst.get(g.name.slice(0, 250)); if (t) m.set(g.id, t) }
      out.set(r.sourceId, { campaignId: newId(r), campaignName: r.name, adGroups: m })
    }
  } catch { /* để rỗng */ }
  return out
}
const confirm = (text: string | undefined, t: TFunction = viT) => { if (text?.trim() !== SEARCH_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sp.errConfirm", { text: SEARCH_CONFIRM_TEXT })) }

function sourceTargetCpaOf(camp: Row): number | null {
  const v = Number(camp.campaign.maximize_conversions?.target_cpa_micros) || Number(camp.campaign.target_cpa?.target_cpa_micros) || 0
  return v > 0 ? Math.round(v / 1e6) : null
}

/**
 * Đặt giá chiến dịch mới. cpaMode "none" = Tối đa chuyển đổi KHÔNG mục tiêu CPA (khuyên 2 tuần đầu — user 01/10: chọn Tối đa
 * chuyển đổi mà bản tách vẫn mang tCPA ₫155.000 của gốc vì ô trống từng nghĩa là "giữ như gốc"). "keep" = như gốc, "set" = targetCpa.
 * HÀM THUẦN.
 */
export function biddingOf(camp: Row, cpaMode: CpaMode = "keep", targetCpa?: number, tr: TFunction = viT): Record<string, unknown> {
  const c = camp.campaign
  if (c.bidding_strategy) return { bidding_strategy: c.bidding_strategy }
  const t = BID[c.bidding_strategy_type]
  const cpa = cpaMode === "set" && targetCpa ? Math.round(targetCpa) * 1e6 : undefined
  if (cpaMode === "none" && (t === "MAXIMIZE_CONVERSIONS" || t === "TARGET_CPA")) return { maximize_conversions: {} }
  if (t === "MAXIMIZE_CONVERSIONS") return { maximize_conversions: { ...(cpa ? { target_cpa_micros: cpa } : c.maximize_conversions?.target_cpa_micros ? { target_cpa_micros: Number(c.maximize_conversions.target_cpa_micros) } : {}) } }
  if (t === "MAXIMIZE_CONVERSION_VALUE") return { maximize_conversion_value: { ...(c.maximize_conversion_value?.target_roas ? { target_roas: Number(c.maximize_conversion_value.target_roas) } : {}) } }
  if (t === "TARGET_CPA") return { target_cpa: { target_cpa_micros: cpa ?? Number(c.target_cpa?.target_cpa_micros) } }
  if (t === "TARGET_ROAS") return { target_roas: { target_roas: Number(c.target_roas?.target_roas) } }
  if (t === "MANUAL_CPC") return { manual_cpc: { enhanced_cpc_enabled: false } }
  if (t === "TARGET_SPEND") return { target_spend: {} }
  throw new PmaxControlError(tr("libgoogle.sp.errBidType", { type: String(t) }))
}

export async function createSplit(input: { company: Company; campaignId: string; range: { from: string; to: string }; budgetPerDay?: number; targetCpa?: number; cpaMode?: CpaMode; sourceBudgetPerDay?: number; actor: string; validateOnly: boolean; confirmText?: string }, t: TFunction = viT): Promise<SplitRecord & { plan: SplitPlan }> {
  if (!input.validateOnly) confirm(input.confirmText, t)
  if (!input.validateOnly && readLog().some((r) => r.company === input.company && r.sourceId === input.campaignId && (r.step === "created" || r.step === "moved"))) throw new PmaxControlError(t("libgoogle.sp.errHasSplit"), 409)
  const plan = await planSplit(input.company, input.campaignId, input.range, t)
  const src = await readSource(input.company, input.campaignId, t)
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  const budget = Math.round(Math.max(50_000, Math.min(input.budgetPerDay ?? plan.budgetPerDay, 50_000_000)))
  const rec: SplitRecord = { id: `split_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, sourceId: plan.sourceId, sourceName: plan.sourceName, name: plan.newName, budgetPerDay: budget, movedKeywords: [], keywordsCount: plan.adGroups.reduce((s, g) => s + g.keywords.length, 0), adGroupsCount: plan.adGroups.length, step: "failed", errors: [], log: [] }
  if (!plan.adGroups.length) { rec.errors.push(t("libgoogle.sp.errNoGeneric")); return { ...rec, plan } }
  if (input.cpaMode === "none" && src.camp.campaign.bidding_strategy) rec.log.push("Gốc dùng chiến lược đặt giá DANH MỤC — chiến dịch mới dùng chung chiến lược đó, KHÔNG bỏ được mục tiêu CPA riêng (chỉnh trong Thư viện chiến lược của Google Ads).")
  // "Giữ tổng ngân sách": hạ ngân sách gốc LÚC CHUYỂN TỪ KHOÁ (bước 3) — trước đó từ khoá chung vẫn chạy ở gốc, hạ sớm là gốc càng hụt.
  if (input.sourceBudgetPerDay && plan.sourceBudgetPerDay && Math.round(input.sourceBudgetPerDay) !== Math.round(plan.sourceBudgetPerDay)) {
    if (plan.sourceBudgetShared) rec.log.push("Ngân sách chiến dịch gốc là ngân sách DÙNG CHUNG — tool không đổi; chỉnh tay trong Google Ads nếu muốn giữ tổng.")
    else rec.sourceBudget = { target: Math.round(Math.max(50_000, input.sourceBudgetPerDay)) }
  }
  const BUD = `customers/${cust}/campaignBudgets/-1`, CAMP = `customers/${cust}/campaigns/-2`
  const MT = enums.KeywordMatchType as unknown as Record<string, number>
  const ops: object[] = [
    { entity: "campaign_budget", operation: "create", resource: { resource_name: BUD, name: `Budget — ${plan.newName} ${Date.now().toString(36)}`, amount_micros: budget * 1e6, delivery_method: enums.BudgetDeliveryMethod.STANDARD, explicitly_shared: false } },
    { entity: "campaign", operation: "create", resource: {
      resource_name: CAMP, name: plan.newName, status: enums.CampaignStatus.PAUSED, advertising_channel_type: enums.AdvertisingChannelType.SEARCH, campaign_budget: BUD,
      contains_eu_political_advertising: EU_POLITICAL_ADVERTISING_DECLARATION, ...biddingOf(src.camp, input.cpaMode ?? (input.targetCpa ? "set" : "keep"), input.targetCpa, t),
      network_settings: { target_google_search: !!src.camp.campaign.network_settings?.target_google_search, target_search_network: !!src.camp.campaign.network_settings?.target_search_network, target_content_network: !!src.camp.campaign.network_settings?.target_content_network, target_partner_search_network: false },
      geo_target_type_setting: { positive_geo_target_type: src.camp.campaign.geo_target_type_setting?.positive_geo_target_type ?? enums.PositiveGeoTargetType.PRESENCE, negative_geo_target_type: src.camp.campaign.geo_target_type_setting?.negative_geo_target_type ?? enums.NegativeGeoTargetType.PRESENCE },
      ...(src.camp.campaign.final_url_suffix ? { final_url_suffix: String(src.camp.campaign.final_url_suffix) } : {}),
      ...(src.camp.campaign.tracking_url_template ? { tracking_url_template: String(src.camp.campaign.tracking_url_template) } : {}),
    } },
  ]
  for (const r of src.crit) {
    const cc = r.campaign_criterion, ct = CT[cc.type]
    const bm = Number(cc.bid_modifier) && Number(cc.bid_modifier) !== 1 && !cc.negative ? { bid_modifier: Number(cc.bid_modifier) } : {}
    if (ct === "LOCATION" && cc.location?.geo_target_constant) ops.push({ entity: "campaign_criterion", operation: "create", resource: { campaign: CAMP, negative: !!cc.negative, location: { geo_target_constant: cc.location.geo_target_constant }, ...bm } })
    else if (ct === "LANGUAGE" && cc.language?.language_constant) ops.push({ entity: "campaign_criterion", operation: "create", resource: { campaign: CAMP, language: { language_constant: cc.language.language_constant } } })
    else if (ct === "AD_SCHEDULE" && cc.ad_schedule) ops.push({ entity: "campaign_criterion", operation: "create", resource: { campaign: CAMP, ad_schedule: { day_of_week: cc.ad_schedule.day_of_week, start_hour: cc.ad_schedule.start_hour, end_hour: cc.ad_schedule.end_hour, start_minute: cc.ad_schedule.start_minute, end_minute: cc.ad_schedule.end_minute }, ...bm } })
    else if (ct === "KEYWORD" && cc.negative && cc.keyword?.text) ops.push({ entity: "campaign_criterion", operation: "create", resource: { campaign: CAMP, negative: true, keyword: { text: cc.keyword.text, match_type: cc.keyword.match_type } } })
  }
  // So theo chữ NGUYÊN DẤU (Google phân biệt "mắt bão" với "mat bao" — lý do có withAccentVariants), không theo bản bỏ dấu.
  const haveNeg = new Set(src.crit.filter((r) => r.campaign_criterion.negative && r.campaign_criterion.keyword?.text).map((r) => String(r.campaign_criterion.keyword.text).normalize("NFC").toLowerCase().trim()))
  for (const bn of plan.brandNegatives) {
    const k = bn.normalize("NFC").toLowerCase().trim()
    if (haveNeg.has(k)) continue
    haveNeg.add(k)
    ops.push({ entity: "campaign_criterion", operation: "create", resource: { campaign: CAMP, negative: true, keyword: { text: bn, match_type: MT.PHRASE } } })
  }
  for (const s of src.shared) ops.push({ entity: "campaign_shared_set", operation: "create", resource: { campaign: CAMP, shared_set: s.campaign_shared_set.shared_set } })
  let ag = -10
  for (const g of plan.adGroups) {
    const AG = `customers/${cust}/adGroups/${ag--}`
    ops.push({ entity: "ad_group", operation: "create", resource: { resource_name: AG, campaign: CAMP, name: g.name.slice(0, 250), status: enums.AdGroupStatus.ENABLED, type: enums.AdGroupType.SEARCH_STANDARD, ...(g.cpcMicros ? { cpc_bid_micros: g.cpcMicros } : {}) } })
    for (const k of g.keywords) ops.push({ entity: "ad_group_criterion", operation: "create", resource: { ad_group: AG, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: k.text, match_type: MT[k.match] ?? MT.PHRASE }, ...(k.cpcMicros ? { cpc_bid_micros: k.cpcMicros } : {}) } })
    for (const a of g.ads) ops.push({ entity: "ad_group_ad", operation: "create", resource: { ad_group: AG, status: enums.AdGroupAdStatus.ENABLED, ad: { final_urls: a.finalUrls, responsive_search_ad: { headlines: a.headlines, descriptions: a.descriptions, ...(a.path1 ? { path1: a.path1 } : {}), ...(a.path2 ? { path2: a.path2 } : {}) } } } })
  }
  const dropped: string[] = []
  try { await c.mutateResources(ops as never, { validate_only: true } as never) } catch (e) {
    const msg = googleAdsErrorMessage(e)
    const drop = droppableLocationOps(msg, ops)
    if (!drop) { rec.errors.push(t("libgoogle.sp.errValidate", { msg: explainFailedOps(msg, ops, t) })); return { ...rec, plan } }
    // Vùng LOẠI TRỪ ở gốc mà Google không còn cho nhắm (user 01/10: 9 mã quận/huyện 904xxxx — nghi đơn vị hành chính cũ) → bỏ, kiểm lại.
    const geo = drop.map((i) => String((ops[i] as { resource: { location: { geo_target_constant: string } } }).resource.location.geo_target_constant))
    const names = await geoNames(c, geo)
    dropped.push(...geo.map((g) => names.get(g) ?? g.split("/").pop()!))
    const keep = new Set(drop)
    const rest = ops.filter((_, i) => !keep.has(i)); ops.length = 0; ops.push(...rest)
    try { await c.mutateResources(ops as never, { validate_only: true } as never) } catch (e2) { rec.errors.push(t("libgoogle.sp.errValidate", { msg: explainFailedOps(googleAdsErrorMessage(e2), ops, t) })); return { ...rec, plan } }
  }
  const dropNote = dropped.length ? `Bỏ ${dropped.length} vùng loại trừ Google không còn cho nhắm (chiến dịch gốc giữ từ trước): ${dropped.slice(0, 12).join(", ")}${dropped.length > 12 ? "…" : ""} — kiểm lại vùng loại trừ ở chiến dịch mới nếu cần.` : null
  if (dropNote) rec.log.push(dropNote)
  if (input.validateOnly) { rec.step = "created"; rec.log.push(`Kiểm trước qua: ${ops.length} thao tác`); return { ...rec, plan } }
  return withFileLock(FILE, async () => {
    try {
      const res = (await c.mutateResources(ops as never)) as { mutate_operation_responses?: Row[] }
      rec.newBudget = res?.mutate_operation_responses?.[0]?.campaign_budget_result?.resource_name
      rec.newCampaign = res?.mutate_operation_responses?.[1]?.campaign_result?.resource_name
      rec.movedKeywords = plan.adGroups.flatMap((g) => g.keywords.map((k) => k.criterion))
      rec.step = rec.newCampaign ? "created" : "failed"
      rec.log.push(`${input.actor}: tạo chiến dịch TẠM DỪNG ${rec.newCampaign ?? "?"} (${ops.length} thao tác)`)
    } catch (e) { rec.errors.push(t("libgoogle.sp.errCreate", { msg: googleAdsErrorMessage(e) })) }
    // Chép mục tiêu chuyển đổi cấp chiến dịch (biddable theo cặp nhóm~nguồn) — hỏng thì báo, không huỷ.
    // Đợt 20c: không đọc được mục tiêu ở gốc → nói rõ (trước đây im lặng như thể đã chép xong).
    if (rec.newCampaign && src.goals === null) rec.goalReport = t("libgoogle.sp.goalNoRead")
    if (rec.newCampaign && src.goals?.length) {
      try {
        const newId = rec.newCampaign.split("/").pop()
        const now = (await c.query(`SELECT campaign_conversion_goal.resource_name, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign.id = ${Number(newId)}`)) as Row[]
        const want = new Map(src.goals.map((g) => [`${g.campaign_conversion_goal.category}~${g.campaign_conversion_goal.origin}`, !!g.campaign_conversion_goal.biddable]))
        const upd = now.filter((g) => want.has(`${g.campaign_conversion_goal.category}~${g.campaign_conversion_goal.origin}`) && want.get(`${g.campaign_conversion_goal.category}~${g.campaign_conversion_goal.origin}`) !== !!g.campaign_conversion_goal.biddable)
        if (upd.length) await c.campaignConversionGoals.update(upd.map((g) => ({ resource_name: g.campaign_conversion_goal.resource_name, biddable: want.get(`${g.campaign_conversion_goal.category}~${g.campaign_conversion_goal.origin}`) })) as never)
        rec.goalReport = t("libgoogle.sp.goalCopied", { n: upd.length })
      } catch (e) { rec.goalReport = t("libgoogle.sp.goalFail", { msg: googleAdsErrorMessage(e) }) }
    }
    // Đợt 18b: gắn tài sản của chiến dịch gốc (sitelink, ảnh, tên doanh nghiệp…). Hỏng thì ghi lại, KHÔNG huỷ bản tách.
    if (rec.newCampaign) {
      rec.movedAdGroups = plan.adGroups.map((g) => ({ sourceId: g.sourceId, name: g.name }))
      try {
        const ar = await linkSourceAssets({ company: input.company, sourceCampaignId: plan.sourceId, newCampaign: rec.newCampaign, sourceAdGroups: rec.movedAdGroups, validateOnly: false, actor: input.actor }, t)
        rec.assetReports = [ar]
        rec.log.push(`${input.actor}: gắn tài sản từ chiến dịch gốc — ${describeCounts(ar.added)}${ar.failed.length ? ` · lỗi: ${ar.failed.map((x) => x.label).join(", ")}` : ""}`)
        for (const x of ar.failed) rec.errors.push(t("libgoogle.sp.errAssetFail", { n: x.count, label: x.label, error: x.error }))
      } catch (e) { rec.errors.push(t("libgoogle.sp.errAssets", { msg: googleAdsErrorMessage(e) })) }
    }
    if (rec.newCampaign) {
      const [chk] = (await c.query(`SELECT campaign.status FROM campaign WHERE campaign.resource_name = '${rec.newCampaign}'`)) as Row[]
      if (STATUS[chk?.campaign?.status] !== "PAUSED") rec.errors.push(t("libgoogle.sp.errReadback", { status: STATUS[chk?.campaign?.status] ?? t("libgoogle.sp.statusNone") }))
    }
    writeLog([...readLog(), rec])
    return { ...rec, plan }
  })
}

async function campaignStatus(company: Company, rn: string): Promise<string | null> {
  const [r] = (await getGoogleAdsCustomer(company).query(`SELECT campaign.status FROM campaign WHERE campaign.resource_name = '${rn}'`)) as Row[]
  return r ? STATUS[r.campaign.status] ?? null : null
}

/** Bước 2/3 + hoàn tác. */
export type SplitActionName = "enable" | "pause" | "move" | "unmove" | "remove" | "clear_tcpa" | "source_budget"
export async function splitAction(company: Company, id: string, action: SplitActionName, actor: string, confirmText?: string, opts: { amount?: number } = {}, t: TFunction = viT): Promise<SplitRecord> {
  confirm(confirmText, t)
  return withFileLock(FILE, async () => {
    const l = readLog()
    const r = l.find((x) => x.id === id && x.company === company)
    if (!r?.newCampaign || r.step === "removed" || r.step === "failed") throw new PmaxControlError(t("libgoogle.sp.errNoSplit"), 404)
    const c = getGoogleAdsCustomer(company)
    try {
      if (action === "enable" || action === "pause") {
        await c.campaigns.update([{ resource_name: r.newCampaign, status: action === "enable" ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED }] as never)
        r.log.push(`${actor}: ${action === "enable" ? "BẬT" : "tạm dừng"} chiến dịch mới`)
      } else if (action === "move") {
        if (r.step === "moved") throw new PmaxControlError(t("libgoogle.sp.errMovedAlready"), 409)
        if ((await campaignStatus(company, r.newCampaign)) !== "ENABLED") throw new PmaxControlError(t("libgoogle.sp.errEnableFirst"), 409)
        await c.adGroupCriteria.update(r.movedKeywords.map((k) => ({ resource_name: k, status: enums.AdGroupCriterionStatus.PAUSED })) as never)
        r.step = "moved"; r.movedAt = new Date().toISOString(); r.log.push(`${actor}: tạm dừng ${r.movedKeywords.length} từ khoá chung ở chiến dịch gốc`)
        if (r.sourceBudget && !r.sourceBudget.appliedAt) await setSourceBudget(company, r, r.sourceBudget.target, actor, t).catch((e) => { r.errors.push(t("libgoogle.sp.errBudgetNoReduce", { msg: googleAdsErrorMessage(e) })) })
      } else if (action === "unmove") {
        if (r.step !== "moved") throw new PmaxControlError(t("libgoogle.sp.errNotMoved"), 409)
        await c.adGroupCriteria.update(r.movedKeywords.map((k) => ({ resource_name: k, status: enums.AdGroupCriterionStatus.ENABLED })) as never)
        r.step = "created"; r.log.push(`${actor}: bật lại ${r.movedKeywords.length} từ khoá chung ở chiến dịch gốc`)
        if (r.sourceBudget?.appliedAt && r.sourceBudget.before) {
          const before = r.sourceBudget.before
          await setSourceBudget(company, r, before, actor, t).then(() => { r.sourceBudget = { target: r.sourceBudget!.target } }).catch((e) => { r.errors.push(t("libgoogle.sp.errBudgetNoRestore", { amount: numT(t, before), msg: googleAdsErrorMessage(e) })) })
        }
      } else if (action === "clear_tcpa") {
        // Bỏ mục tiêu CPA ở chiến dịch mới → Tối đa chuyển đổi không mục tiêu (cho bản tạo trước khi có lựa chọn).
        await c.campaigns.update([{ resource_name: r.newCampaign, maximize_conversions: { target_cpa_micros: 0 } }] as never)
        r.log.push(`${actor}: bỏ mục tiêu CPA ở chiến dịch mới (Tối đa chuyển đổi không mục tiêu)`)
      } else if (action === "source_budget") {
        const amt = Math.round(Number(opts.amount))
        if (!Number.isFinite(amt) || amt < 50_000 || amt > 50_000_000) throw new PmaxControlError(t("libgoogle.sp.errBudgetRange"), 400)
        await setSourceBudget(company, r, amt, actor, t)
      } else {
        if (r.step === "moved") throw new PmaxControlError(t("libgoogle.sp.errUnmoveFirst"), 409)
        await c.campaigns.remove([r.newCampaign])
        r.step = "removed"; r.log.push(`${actor}: gỡ chiến dịch mới`)
      }
    } catch (e) {
      if (e instanceof PmaxControlError) throw e
      throw new PmaxControlError(t("libgoogle.sp.errGoogle", { msg: googleAdsErrorMessage(e) }), 502)
    }
    writeLog(l)
    return r
  })
}

/**
 * Đợt 18c: bổ sung tài sản còn thiếu cho bản tách ĐÃ tạo (vd bản tạo trước Đợt 18). validateOnly = Kiểm trước, không ghi.
 * Không gắn trùng: chỉ thêm liên kết chưa có — chạy lại an toàn.
 */
export async function supplementSplitAssets(company: Company, id: string, opts: { validateOnly: boolean; actor: string; confirmText?: string }, t: TFunction = viT): Promise<{ record: SplitRecord; report: AssetReport }> {
  if (!opts.validateOnly) confirm(opts.confirmText, t)
  const r0 = readLog().find((x) => x.id === id && x.company === company)
  if (!r0?.newCampaign || r0.step === "removed" || r0.step === "failed") throw new PmaxControlError(t("libgoogle.sp.errNoSplit"), 404)
  // Bản tạo trước Đợt 18 không lưu danh sách nhóm → đọc lại nhóm gốc theo tên nhóm của chiến dịch mới.
  let groups = r0.movedAdGroups
  if (!groups?.length) {
    const c = getGoogleAdsCustomer(company)
    const newId = Number(r0.newCampaign.split("/").pop())
    const [mine, src] = await Promise.all([
      c.query(`SELECT ad_group.name FROM ad_group WHERE campaign.id = ${newId} AND ad_group.status != 'REMOVED'`) as Promise<Row[]>,
      c.query(`SELECT ad_group.id, ad_group.name FROM ad_group WHERE campaign.id = ${Number(r0.sourceId)} AND ad_group.status != 'REMOVED'`) as Promise<Row[]>,
    ])
    const names = new Set(mine.map((g) => String(g.ad_group.name)))
    groups = src.filter((g) => names.has(String(g.ad_group.name).slice(0, 250))).map((g) => ({ sourceId: String(g.ad_group.id), name: String(g.ad_group.name) }))
  }
  const report = await linkSourceAssets({ company, sourceCampaignId: r0.sourceId, newCampaign: r0.newCampaign, sourceAdGroups: groups, validateOnly: opts.validateOnly, actor: opts.actor }, t)
  if (opts.validateOnly) return { record: r0, report }
  return withFileLock(FILE, async () => {
    const l = readLog()
    const r = l.find((x) => x.id === id && x.company === company)!
    r.movedAdGroups = groups
    r.assetReports = [...(r.assetReports ?? []), report].slice(-10)
    r.log.push(`${opts.actor}: bổ sung tài sản từ chiến dịch gốc — ${describeCounts(report.added)}${report.failed.length ? ` · lỗi: ${report.failed.map((x) => x.label).join(", ")}` : ""}`)
    writeLog(l)
    return { record: r, report }
  })
}

/** Đợt 18f: lưu kết quả đo theo mốc vào bản ghi (job tự đo gọi). */
export async function saveSplitCheckpoint(company: Company, id: string, days: "7" | "14", result: { verdict: "tot" | "theo_doi" | "dung"; lines: string[] }, now = new Date()): Promise<void> {
  await withFileLock(FILE, async () => {
    const l = readLog(); const r = l.find((x) => x.id === id && x.company === company)
    if (!r) return
    r.checkpoints = { ...(r.checkpoints ?? {}), [days]: { at: now.toISOString(), ...result } }
    r.log.push(`Tự đo mốc ${days} ngày: ${result.verdict === "tot" ? "Đạt" : result.verdict === "dung" ? "Nên hoàn tác" : "Theo dõi"}`)
    writeLog(l)
  })
}

/** Đợt 18g: ghi lần nhắc. */
export async function markSplitReminded(company: Company, id: string, now = new Date()): Promise<void> {
  await withFileLock(FILE, async () => { const l = readLog(); const r = l.find((x) => x.id === id && x.company === company); if (r) { r.lastReminderAt = now.toISOString(); writeLog(l) } })
}

/** Đo lại bản tách: N ngày trước lúc chuyển vs N ngày sau (N = 7 hoặc 14, tối đa số ngày đã qua). `fixedDays`: job tự đo đúng mốc. */
/**
 * Đợt 19d (18e): nhóm quảng cáo của bản "· Chung" + Ad strength từng RSA + từ khoá — để mở công cụ sửa RSA (AI gợi ý theo từ khoá,
 * user duyệt, Kiểm trước + XAC NHAN). Quảng cáo chép từ chiến dịch thương hiệu thường "Poor" với lượt tìm chung.
 */
export interface SplitAdGroupAds { adGroupId: string; name: string; keywords: string[]; ads: { id: string; strength: string }[] }
const STRENGTH = Object.fromEntries(Object.entries(enums.AdStrength).filter(([, v]) => typeof v === "number").map(([k, v]) => [v, k])) as Record<number, string>
export async function splitAds(company: Company, id: string, t: TFunction = viT): Promise<SplitAdGroupAds[]> {
  const r = readLog().find((x) => x.id === id && x.company === company)
  const newId = r?.newCampaign?.split("/").pop()
  if (!r || !newId || !/^\d+$/.test(newId)) throw new PmaxControlError(t("libgoogle.sp.errNoSplit2"), 404)
  const c = getGoogleAdsCustomer(company)
  const [ads, kws] = await Promise.all([
    c.query(`SELECT campaign.id, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad_strength FROM ad_group_ad WHERE campaign.id = ${newId} AND ad_group_ad.status != 'REMOVED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, ad_group.id, ad_group_criterion.keyword.text FROM ad_group_criterion WHERE campaign.id = ${newId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`) as Promise<Row[]>,
  ])
  const m = new Map<string, SplitAdGroupAds>()
  const g = (x: Row) => { const k = String(x.ad_group.id); return m.get(k) ?? m.set(k, { adGroupId: k, name: String(x.ad_group.name ?? k), keywords: [], ads: [] }).get(k)! }
  for (const a of ads) g(a).ads.push({ id: String(a.ad_group_ad.ad.id), strength: STRENGTH[Number(a.ad_group_ad.ad_strength)] ?? String(a.ad_group_ad.ad_strength ?? "") })
  for (const k of kws) { const x = g(k); if (x.keywords.length < 30) x.keywords.push(String(k.ad_group_criterion.keyword.text)) }
  return [...m.values()]
}

/** Đợt 19d: đơn thật (hành động phụ "Lead chốt đơn", all_conversions) của các chiến dịch trong hai khoảng. null = chưa có hành động. */
async function realOrdersAround(company: Company, ids: string[], before: { from: string; to: string }, after: { from: string; to: string }): Promise<{ before: number; after: number } | null> {
  const { readActions } = await import("@/lib/leads/quality")
  const won = (await readActions(company)).find((a) => a.stage === "won")?.resourceName
  if (!won || !/^customers\/\d+\/conversionActions\/\d+$/.test(won) || !ids.every((x) => /^\d+$/.test(x))) return null
  const c = getGoogleAdsCustomer(company)
  // Theo NGÀY CHUYỂN ĐỔI (không theo ngày bấm): đơn chốt trễ gán về ngày bấm làm khoảng "sau" luôn thiếu → báo "Nên hoàn tác" nhầm.
  const q = async (rg: { from: string; to: string }) => ((await c.query(`SELECT campaign.id, segments.conversion_action, metrics.all_conversions_by_conversion_date FROM campaign WHERE campaign.id IN (${ids.join(", ")}) AND segments.date BETWEEN '${rg.from}' AND '${rg.to}' AND segments.conversion_action = '${won}'`)) as Row[]).reduce((s, x) => s + (Number(x.metrics.all_conversions_by_conversion_date) || 0), 0)
  const [b, a] = await Promise.all([q(before), q(after)])
  return { before: b, after: a }
}

export async function splitCheckpoint(company: Company, id: string, fixedDays?: 7 | 14, t: TFunction = viT): Promise<{ record: SplitRecord; days: number; result: ReturnType<typeof checkpoint> | null; note?: string }> {
  const r = readLog().find((x) => x.id === id && x.company === company)
  if (!r) throw new PmaxControlError(t("libgoogle.sp.errNoSplit2"), 404)
  if (!r.movedAt || !r.newCampaign) return { record: r, days: 0, result: null, note: t("libgoogle.sp.cpNotMoved") }
  const moved = vnDate(new Date(r.movedAt)) // ngày VN (cắt ISO UTC lệch 1 ngày nếu chuyển 00:00–07:00 VN)
  const yesterday = addDays(vnDate(), -1)
  const passed = Math.round((Date.parse(yesterday) - Date.parse(moved)) / 86_400_000)
  if (passed < 1) return { record: r, days: 0, result: null, note: t("libgoogle.sp.cpToday") }
  const days = fixedDays && passed >= fixedDays ? fixedDays : passed >= 14 ? 14 : passed >= 7 ? 7 : passed
  const newId = r.newCampaign.split("/").pop()!
  const [b, a] = await Promise.all([searchXray(company, { from: addDays(moved, -days), to: addDays(moved, -1) }), searchXray(company, { from: addDays(moved, 1), to: addDays(moved, days) })])
  const pick = (x: Awaited<ReturnType<typeof searchXray>>) => ({ brand: x.campaigns.find((c) => c.id === r.sourceId) ?? null, generic: x.campaigns.find((c) => c.id === newId) ?? null })
  let realErr: string | null = null
  const real = await realOrdersAround(company, [r.sourceId, newId], { from: addDays(moved, -days), to: addDays(moved, -1) }, { from: addDays(moved, 1), to: addDays(moved, days) }).catch((e: unknown) => { realErr = googleAdsErrorMessage(e).slice(0, 160); return null })
  const result = checkpoint(pick(b), pick(a), days, real, t)
  // Đợt 20c: lỗi đọc đơn thật phải hiện, không lặng lẽ rơi về số Google.
  if (realErr) result.lines.splice(result.lines.length - 1, 0, t("libgoogle.sp.cpRealErr", { err: realErr }))
  return { record: r, days, result, note: days < 7 ? t("libgoogle.sp.cpEarly", { days }) : undefined }
}
