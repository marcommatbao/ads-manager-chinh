// ============================================================
// Đợt 17 — Creative theo ĐƠN THẬT (Meta, cấp quảng cáo, CHỈ ĐỌC)
// ============================================================
// Vì sao: Đợt 12 đo được ~88% "mua hàng" Meta báo là người CHỈ XEM. Xếp mẫu quảng cáo theo số đó = nhân bản nhầm mẫu.
// Odoo không lưu tới cấp quảng cáo (chỉ utm_campaign), link quảng cáo cũ không có utm_content → chấm theo NGUỒN GẦN ĐƠN THẬT
// NHẤT đang có, luôn ghi rõ nguồn cạnh con số:
//   ① "odoo"  — đơn ĐÃ THU TIỀN gửi qua Conversions API (Đợt 16, sự kiện DonThanhToanOdoo), Meta khớp với người đã BẤM (7 ngày).
//               Cần: bật gửi Meta ở Đo lường → Đơn thật + tạo chuyển đổi tuỳ chỉnh từ sự kiện đó (Events Manager).
//   ② "ga4"   — đơn GA4 theo utm_content = mã quảng cáo (chỉ quảng cáo tạo từ Đợt 17 trở đi mới có).
//   ③ "click" — "mua hàng" Meta từ lượt BẤM 7 ngày (bỏ phần chỉ-xem). Luôn có.
// Lượt gọi: app Meta bậc phát triển ~60/giờ → 1 lượt insights + 1 lượt chuyển đổi tuỳ chỉnh + ≤ 2 lượt ảnh/nội dung; nhớ 60 phút.

import { metaGet, metaGetAll, adAccountId } from "@/lib/case/meta-graph"
import { PURCHASE_TYPES, pickAction, pickActionWindow } from "@/lib/case/meta-evidence"
import { detectCompany } from "@/lib/company-detect"
import { ga4Ids } from "@/lib/meta-accounts"
import { serviceAccountToken } from "@/lib/measure/gtm-api"
import { META_EVENT_NAME } from "@/lib/conversions/meta-capi"
import type { Company } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const FATIGUE_FREQ = 3.5
export const MIN_ORDERS_WINNER = 3
export const WINNER_CPA_RATIO = 0.7
export const LOSER_SPEND_RATIO = 2
export const VIEW_HEAVY_AD = 0.6
const DETAIL_ADS = 60

export type TruthSource = "odoo" | "ga4" | "click"
export const TRUTH_LABEL: Record<TruthSource, string> = {
  odoo: "Đơn đã thu tiền (Odoo → Meta, từ lượt bấm 7 ngày)",
  ga4: "Đơn GA4 theo mã quảng cáo (utm_content)",
  click: "Mua hàng Meta từ lượt BẤM 7 ngày (bỏ phần chỉ xem)",
}
export type Verdict = "nhan_ban" | "nen_tat" | "bi_nham" | "meta_bao_ho" | "chua_du_so" | "on"
export const VERDICT_LABEL: Record<Verdict, string> = {
  nhan_ban: "Đáng nhân bản", nen_tat: "Nên tắt", bi_nham: "Bị nhàm", meta_bao_ho: "Meta báo hộ", chua_du_so: "Chưa đủ số", on: "Ổn",
}

export interface AdInput {
  id: string; name: string; campaignId: string; campaignName: string; adsetName: string
  spend: number; impressions: number; clicks: number; frequency: number | null
  metaPurchases: number; click: number | null; view: number | null
  odoo: number | null; odooValue: number | null; ga4: number | null
}
export interface AdTruth extends AdInput {
  truth: number; truthSource: TruthSource; cpa: number | null; roas: number | null; viewShare: number | null
  verdict: Verdict; reasons: string[]
  thumb?: string | null; title?: string | null; link?: string | null; status?: string | null
}

const vnd = (n: number, t: TFunction) => `₫${Math.round(n).toLocaleString(t("libmeta.numLocale"))}`

/** Nhãn nguồn / kết luận theo ngôn ngữ — TRUTH_LABEL / VERDICT_LABEL ở trên là bản tiếng Việt cố định. */
export const truthLabelOf = (s: TruthSource, t: TFunction = makeT("vi")): string => t(`libmeta.ct.src.${s}` as MessageKey)
export const verdictLabelOf = (v: Verdict, t: TFunction = makeT("vi")): string => t(`libmeta.ct.verdict.${v}` as MessageKey)
export const truthLabels = (t: TFunction = makeT("vi")): Record<TruthSource, string> => ({ odoo: truthLabelOf("odoo", t), ga4: truthLabelOf("ga4", t), click: truthLabelOf("click", t) })
export const verdictLabels = (t: TFunction = makeT("vi")): Record<Verdict, string> => ({ nhan_ban: verdictLabelOf("nhan_ban", t), nen_tat: verdictLabelOf("nen_tat", t), bi_nham: verdictLabelOf("bi_nham", t), meta_bao_ho: verdictLabelOf("meta_bao_ho", t), chua_du_so: verdictLabelOf("chua_du_so", t), on: verdictLabelOf("on", t) })

/** Nguồn chung cho CẢ tài khoản (không trộn nguồn giữa các dòng — trộn là so táo với cam). */
export function pickSource(ads: Pick<AdInput, "odoo" | "ga4">[], opts: { odooReady: boolean }): TruthSource {
  if (opts.odooReady) return "odoo"
  const withGa4 = ads.filter((a) => (a.ga4 ?? 0) > 0).length
  if (withGa4 >= 3) return "ga4"
  return "click"
}

/** Chấm từng quảng cáo — HÀM THUẦN. CPA mốc = chi cả tài khoản / đơn theo nguồn đã chọn. */
export function judgeAds(ads: AdInput[], source: TruthSource, t: TFunction = makeT("vi")): { ads: AdTruth[]; accountCpa: number | null; totals: { spend: number; truth: number; meta: number; value: number | null } } {
  const val = (a: AdInput) => (source === "odoo" ? a.odoo : source === "ga4" ? a.ga4 : a.click) ?? 0
  const spend = ads.reduce((s, a) => s + a.spend, 0)
  const truthTotal = ads.reduce((s, a) => s + val(a), 0)
  const value = source === "odoo" ? ads.reduce((s, a) => s + (a.odooValue ?? 0), 0) : null
  const accountCpa = truthTotal > 0 ? spend / truthTotal : null
  const out = ads.map((a): AdTruth => {
    const truth = val(a)
    const cpa = truth > 0 ? a.spend / truth : null
    const roas = source === "odoo" && a.odooValue != null && a.spend > 0 ? a.odooValue / a.spend : null
    const viewShare = a.metaPurchases > 0 && a.view != null ? a.view / a.metaPurchases : null
    const reasons: string[] = []
    let verdict: Verdict = "chua_du_so"
    const fatigued = a.frequency != null && a.frequency >= FATIGUE_FREQ
    if (accountCpa != null && truth === 0 && a.spend >= LOSER_SPEND_RATIO * accountCpa) {
      verdict = "nen_tat"; reasons.push(t("libmeta.ct.reasonLoser", { spend: vnd(a.spend, t), ratio: LOSER_SPEND_RATIO, cpa: vnd(accountCpa, t) }))
    } else if (accountCpa != null && cpa != null && truth >= MIN_ORDERS_WINNER && cpa <= WINNER_CPA_RATIO * accountCpa && !fatigued) {
      verdict = "nhan_ban"; reasons.push(t("libmeta.ct.reasonWinner", { n: Math.round(truth * 10) / 10, cpa: vnd(cpa, t), pct: Math.round((1 - cpa / accountCpa) * 100) }))
    } else if (fatigued && (cpa == null || accountCpa == null || cpa > accountCpa)) {
      verdict = "bi_nham"; reasons.push(t("libmeta.ct.reasonFatigue", { freq: a.frequency!.toFixed(1), cpa: cpa ? vnd(cpa, t) : t("libmeta.ct.noOrdersYet") }))
    } else if (accountCpa != null && truth >= MIN_ORDERS_WINNER) {
      verdict = "on"
    }
    if (viewShare != null && a.metaPurchases >= 10 && viewShare >= VIEW_HEAVY_AD) {
      reasons.push(t("libmeta.ct.reasonViewHeavy", { n: Math.round(a.metaPurchases), pct: Math.round(viewShare * 100) }))
      if (verdict === "chua_du_so" || verdict === "on") verdict = "meta_bao_ho"
    }
    if (fatigued && verdict === "nhan_ban") reasons.push(t("libmeta.ct.reasonDuplicateFatigue", { freq: a.frequency!.toFixed(1) }))
    return { ...a, truth, truthSource: source, cpa, roas, viewShare, verdict, reasons }
  })
  const order: Record<Verdict, number> = { nen_tat: 0, nhan_ban: 1, bi_nham: 2, meta_bao_ho: 3, on: 4, chua_du_so: 5 }
  out.sort((x, y) => order[x.verdict] - order[y.verdict] || y.spend - x.spend)
  return { ads: out, accountCpa, totals: { spend, truth: truthTotal, meta: ads.reduce((s, a) => s + a.metaPurchases, 0), value } }
}

/** Chuyển đổi tuỳ chỉnh dựng từ sự kiện Đợt 16 (rule nhắc tên sự kiện) → action_type để đọc số theo quảng cáo. */
export function findOdooConversion(rows: Row[], pixelId: string | null): { id: string; name: string; actionType: string } | null {
  const hit = rows.find((r) => String(r.rule ?? "").includes(META_EVENT_NAME) && (!pixelId || !r.event_source_id || String(r.event_source_id) === pixelId) && !r.is_archived)
  return hit ? { id: String(hit.id), name: String(hit.name ?? ""), actionType: `offsite_conversion.custom.${hit.id}` } : null
}

/** Một dòng insights cấp quảng cáo → AdInput (chưa có GA4). */
export function toAdInput(r: Row, odooType: string | null): AdInput {
  const odooVal = (arr: Parameters<typeof pickActionWindow>[0]) => (odooType ? pickActionWindow(arr, [odooType], "7d_click") : null)
  return {
    id: String(r.ad_id), name: String(r.ad_name ?? ""), campaignId: String(r.campaign_id), campaignName: String(r.campaign_name ?? ""), adsetName: String(r.adset_name ?? ""),
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, frequency: r.frequency != null ? Number(r.frequency) : null,
    metaPurchases: pickAction(r.actions, PURCHASE_TYPES), click: pickActionWindow(r.actions, PURCHASE_TYPES, "7d_click"), view: pickActionWindow(r.actions, PURCHASE_TYPES, "1d_view"),
    odoo: odooVal(r.actions), odooValue: odooVal(r.action_values), ga4: null,
  }
}

async function ga4ByAdContent(company: Company, range: { from: string; to: string }, t: TFunction): Promise<Map<string, number> | { error: string }> {
  const prop = ga4Ids(company).propertyId
  if (!prop) return { error: t("libmeta.xray.ga4NoProperty") }
  let token: string
  try { token = await serviceAccountToken("https://www.googleapis.com/auth/analytics.readonly") } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, {
    method: "POST", signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: range.from, endDate: range.to }], dimensions: [{ name: "sessionManualAdContent" }], metrics: [{ name: "ecommercePurchases" }],
      dimensionFilter: { filter: { fieldName: "sessionManualAdContent", stringFilter: { matchType: "FULL_REGEXP", value: "\\d{6,}" } } }, limit: 5000 }),
  })
  const j = (await res.json().catch(() => ({}))) as Row
  if (!res.ok) return { error: res.status === 403 ? t("libmeta.xray.ga4NoViewer") : `GA4 ${res.status}` }
  const m = new Map<string, number>()
  for (const r of (j.rows ?? []) as Row[]) m.set(String(r.dimensionValues[0].value), (m.get(String(r.dimensionValues[0].value)) ?? 0) + (Number(r.metricValues[0].value) || 0))
  return m
}

export interface CreativeTruth {
  company: Company; range: { from: string; to: string }; collectedAt: string
  source: TruthSource; sourceLabel: string; accountCpa: number | null
  totals: { spend: number; truth: number; meta: number; value: number | null; ads: number }
  ads: AdTruth[]
  setup: { odooConversion: { id: string; name: string } | null; ga4AdsTagged: number }
  counts: Record<Verdict, number>
  calls: number; errors: string[]; notes: string[]
}

const memo = new Map<string, { at: number; value: CreativeTruth }>()

export async function creativeTruth(company: Company, range: { from: string; to: string }, opts: { force?: boolean } = {}, t: TFunction = makeT("vi")): Promise<CreativeTruth> {
  // Văn bản (lý do, ghi chú, nhãn) sinh theo ngôn ngữ → khoá nhớ có ngôn ngữ, bản EN không làm hỏng bản VI.
  const key = `${t("libmeta.localeTag")}|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < 60 * 60_000) return hit.value
  const act = `act_${adAccountId()}`
  const errors: string[] = [], notes: string[] = []
  let calls = 0

  let conv: ReturnType<typeof findOdooConversion> = null
  try {
    const { metaAccountIds } = await import("@/lib/meta-accounts")
    const cc = await metaGetAll<Row>(`${act}/customconversions`, { fields: "id,name,rule,event_source_id,is_archived", limit: "200" }, 2); calls++
    conv = findOdooConversion(cc, metaAccountIds(company).pixelId || null)
  } catch (e) { errors.push(t("libmeta.ct.errCustomConv", { msg: e instanceof Error ? e.message : String(e) })) }

  const ins = await metaGetAll<Row>(`${act}/insights`, {
    level: "ad", time_range: JSON.stringify({ since: range.from, until: range.to }),
    fields: "ad_id,ad_name,adset_name,campaign_id,campaign_name,spend,impressions,clicks,frequency,actions,action_values",
    action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]), limit: "500",
  }, 5); calls++
  const rows = ins.filter((r) => detectCompany(String(r.campaign_name)) === company && Number(r.spend) > 0).map((r) => toAdInput(r, conv?.actionType ?? null))

  const ga4 = await ga4ByAdContent(company, range, t)
  let ga4AdsTagged = 0
  if ("error" in ga4) notes.push(t("libmeta.ct.noteGa4", { msg: ga4.error }))
  else for (const a of rows) { const n = ga4.get(a.id); if (n != null) { a.ga4 = n; ga4AdsTagged++ } }

  const odooReady = !!conv && rows.some((a) => (a.odoo ?? 0) > 0)
  if (conv && !odooReady) notes.push(t("libmeta.ct.noteConvNoMatch", { name: conv.name }))
  if (!conv) notes.push(t("libmeta.ct.noteNoConv", { event: META_EVENT_NAME }))
  if (!ga4AdsTagged) notes.push(t("libmeta.ct.noteNoUtmContent"))

  const source = pickSource(rows, { odooReady })
  const j = judgeAds(rows, source, t)

  // Ảnh + tiêu đề cho các quảng cáo chi nhiều nhất (tiết kiệm lượt gọi).
  const top = [...j.ads].sort((a, b) => b.spend - a.spend).slice(0, DETAIL_ADS)
  for (let i = 0; i < top.length; i += 50) {
    try {
      const ids = top.slice(i, i + 50).map((a) => a.id).join(",")
      const d = await metaGet<Record<string, Row>>("", { ids, fields: "effective_status,creative{thumbnail_url,title,object_story_spec{link_data{link}},asset_feed_spec{link_urls}}" }); calls++
      for (const a of top.slice(i, i + 50)) {
        const x = d[a.id]; if (!x) continue
        a.status = x.effective_status ?? null
        a.thumb = x.creative?.thumbnail_url ?? null
        a.title = x.creative?.title ?? null
        a.link = x.creative?.object_story_spec?.link_data?.link ?? x.creative?.asset_feed_spec?.link_urls?.[0]?.website_url ?? null
      }
    } catch (e) { errors.push(t("libmeta.ct.errImages", { msg: e instanceof Error ? e.message : String(e) })); break }
  }

  const counts = { nhan_ban: 0, nen_tat: 0, bi_nham: 0, meta_bao_ho: 0, chua_du_so: 0, on: 0 } as Record<Verdict, number>
  for (const a of j.ads) counts[a.verdict]++
  const value: CreativeTruth = {
    company, range, collectedAt: new Date().toISOString(), source, sourceLabel: truthLabelOf(source, t), accountCpa: j.accountCpa,
    totals: { ...j.totals, ads: j.ads.length }, ads: j.ads, setup: { odooConversion: conv ? { id: conv.id, name: conv.name } : null, ga4AdsTagged }, counts, calls, errors, notes,
  }
  memo.set(key, { at: Date.now(), value })
  return value
}
