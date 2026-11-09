// ============================================================
// Đợt 10c (C4) — Thí nghiệm loại trừ vùng cho PMax: đọc số theo tỉnh · bật · tắt · đo (I/O)
// ============================================================
// Toán ở ./geo-design.ts. Ở đây: lấy KPI tuần × tỉnh từ nguồn tốt nhất có (GA4 → CSV → Google), đơn PMax Google ghi theo
// tỉnh, rồi BẬT thí nghiệm = thêm loại trừ vị trí (campaign_criterion location negative) cho các PMax đã chọn. Chiến dịch
// đang NHẮM ĐÍCH DANH tỉnh đó → gỡ nhắm tạm (ghi lại hệ số giá để trả lại), trừ khi gỡ xong chiến dịch không còn vùng
// nhắm nào (sẽ thành nhắm cả thế giới) → từ chối chiến dịch đó.
// Mọi ghi: Kiểm trước (validate_only cả lô) → XAC NHAN → ghi → đọc lại → nhật ký data/pmax-experiments.json. Kết thúc
// (tay hoặc tự động đúng ngày hẹn — job pmax_experiments) = gỡ đúng những gì tool đã thêm + trả nhắm cũ.

import fs from "fs"
import path from "path"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { addDays, vnDate } from "@/lib/case/dates"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import { ga4Ids } from "@/lib/meta-accounts"
import { serviceAccountToken } from "@/lib/measure/gtm-api"
import { analyzeExperiment, designCandidates, fullWeeks, weekMonday, type DesignCandidate, type ExperimentResult, type KpiKind, type WeeklySeries } from "./geo-design"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "./controls"

import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const FILE = path.join(process.cwd(), "data", "pmax-experiments.json")
const CSV_DIR = path.join(process.cwd(), "data", "pmax-geo-kpi")
export const PRE_WEEKS = 12
export const MIN_TEST_WEEKS = 2
export const MAX_TEST_WEEKS = 8

// ── Tên tỉnh ↔ mã vùng Google ───────────────────────────────

const ALIAS: Record<string, string> = { tphcm: "hochiminh", hcm: "hochiminh", saigon: "hochiminh", hochiminhcity: "hochiminh", thanhphohochiminh: "hochiminh", hn: "hanoi", thudohanoi: "hanoi" }
/** "TP. Hồ Chí Minh" / "Ho Chi Minh City" / "Thừa Thiên-Huế" → khoá so khớp. */
export function provinceKey(name: string): string {
  let k = stripDiacritics(name).replace(/\b(tinh|thanh pho|tp|province|city|municipality)\b\.?/g, "").replace(/[^a-z]/g, "")
  k = ALIAS[k] ?? k
  return k
}

async function geoNames(company: Company, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const c = getGoogleAdsCustomer(company)
  const rows = (await c.query(`SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.map(Number).filter(Boolean).join(",")})`)) as Row[]
  return Object.fromEntries(rows.map((r) => [String(r.geo_target_constant.id), String(r.geo_target_constant.name)]))
}
async function vnProvinces(company: Company): Promise<Record<string, string>> {
  const c = getGoogleAdsCustomer(company)
  const rows = (await c.query(`SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.target_type FROM geo_target_constant WHERE geo_target_constant.country_code = 'VN'`)) as Row[]
  return Object.fromEntries(rows.filter((r) => ["Province", "City", "Municipality"].includes(String(r.geo_target_constant.target_type))).map((r) => [String(r.geo_target_constant.id), String(r.geo_target_constant.name)]))
}

// ── Nguồn số ────────────────────────────────────────────────

export interface GeoData {
  kpiKind: KpiKind
  source: "ga4" | "csv" | "google"
  sourceNote: string
  series: WeeklySeries
  weeks: string[]
  pmaxClaim: Record<string, number>
  pmaxCost: Record<string, number>
  names: Record<string, string>
  unmatched: string[]
}

async function googleGeo(company: Company, from: string, to: string) {
  const c = getGoogleAdsCustomer(company)
  const rows = (await c.query(`SELECT segments.week, segments.geo_target_region, campaign.advertising_channel_type, metrics.conversions, metrics.cost_micros FROM geographic_view WHERE segments.date BETWEEN '${from}' AND '${to}' AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'`)) as Row[]
  const nonPmax: WeeklySeries = {}, pmaxClaim: Record<string, number> = {}, pmaxCost: Record<string, number> = {}
  const PMAX = 10 // AdvertisingChannelType.PERFORMANCE_MAX
  for (const r of rows) {
    const g = String(r.segments.geo_target_region ?? "").split("/")[1]
    if (!g) continue
    const conv = Number(r.metrics.conversions) || 0
    if (Number(r.campaign.advertising_channel_type) === PMAX) { pmaxClaim[g] = (pmaxClaim[g] ?? 0) + conv; pmaxCost[g] = (pmaxCost[g] ?? 0) + (Number(r.metrics.cost_micros) || 0) / 1e6 }
    else { const w = String(r.segments.week); (nonPmax[g] ??= {})[w] = (nonPmax[g][w] ?? 0) + conv }
  }
  return { nonPmax, pmaxClaim, pmaxCost }
}

async function ga4Geo(company: Company, from: string, to: string, event: string, newOnly = false): Promise<{ raw: Record<string, Record<string, number>> } | { error: string }> {
  const prop = ga4Ids(company).propertyId
  if (!prop) return { error: "chưa khai báo GA4 property" }
  let token: string
  try { token = await serviceAccountToken("https://www.googleapis.com/auth/analytics.readonly") } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, {
    method: "POST", signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: "date" }, { name: "region" }], metrics: [{ name: "eventCount" }],
      dimensionFilter: { andGroup: { expressions: [{ filter: { fieldName: "eventName", stringFilter: { value: event } } }, { filter: { fieldName: "countryId", stringFilter: { value: "VN" } } }, ...(newOnly ? [{ filter: { fieldName: "newVsReturning", stringFilter: { value: "new" } } }] : [])] } }, limit: 100000 }),
  })
  const j = (await res.json().catch(() => ({}))) as Row
  if (!res.ok) return { error: res.status === 403 ? "service account chưa được cấp quyền Viewer trên GA4" : `GA4 ${res.status}: ${String(j.error?.message ?? "").slice(0, 160)}` }
  const raw: Record<string, Record<string, number>> = {}
  for (const r of (j.rows ?? []) as Row[]) {
    const d = String(r.dimensionValues[0].value); const ymd = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
    const reg = String(r.dimensionValues[1].value); const w = weekMonday(ymd)
    ;(raw[reg] ??= {})[w] = (raw[reg][w] ?? 0) + (Number(r.metricValues[0].value) || 0)
  }
  return { raw }
}

// CSV đơn theo tỉnh (xuất từ hệ thống bán hàng bất kỳ): "ngay,tinh,so_don" — không phụ thuộc ERP.
export interface CsvKpi { uploadedAt: string; by: string; rows: { date: string; province: string; orders: number }[] }
const csvFile = (co: Company) => path.join(CSV_DIR, `${co}.json`)
export function readCsvKpi(company: Company): CsvKpi | null { try { return JSON.parse(fs.readFileSync(csvFile(company), "utf-8")) as CsvKpi } catch { return null } }
export function parseKpiCsv(text: string): { rows: CsvKpi["rows"]; errors: string[] } {
  const rows: CsvKpi["rows"] = [], errors: string[] = []
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const [i, line] of lines.entries()) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""))
    if (i === 0 && !/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(cells[0])) continue // dòng tiêu đề
    const [d, prov, n] = cells
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d ?? "")
    const date = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : d
    const orders = Number(String(n ?? "").replace(/[^\d.-]/g, ""))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !prov || !Number.isFinite(orders)) { if (errors.length < 10) errors.push(`Dòng ${i + 1}: "${line.slice(0, 60)}"`); continue }
    rows.push({ date, province: prov, orders })
  }
  return { rows, errors }
}
export async function saveCsvKpi(company: Company, rows: CsvKpi["rows"], by: string): Promise<void> {
  fs.mkdirSync(CSV_DIR, { recursive: true })
  writeFileAtomicSync(csvFile(company), JSON.stringify({ uploadedAt: new Date().toISOString(), by, rows } satisfies CsvKpi))
}

/** Gom tên tỉnh (GA4/CSV) về mã vùng Google. Tỉnh không khớp được → báo, không đoán. */
function mapByName(raw: Record<string, Record<string, number>>, provinces: Record<string, string>): { series: WeeklySeries; unmatched: string[] } {
  const byKey = new Map(Object.entries(provinces).map(([id, n]) => [provinceKey(n), id]))
  const series: WeeklySeries = {}, unmatched: string[] = []
  for (const [name, weeks] of Object.entries(raw)) {
    const id = byKey.get(provinceKey(name))
    if (!id) { if (name && name !== "(not set)") unmatched.push(name); continue }
    for (const [w, v] of Object.entries(weeks)) (series[id] ??= {})[w] = (series[id][w] ?? 0) + v
  }
  return { series, unmatched }
}

/** ga4NewOnly: chỉ đơn của người dùng MỚI (GA4 newVsReturning = new). Đo 28/09 MBC: đơn cũ (gia hạn) chiếm ~2/3 và không do
 *  quảng cáo → làm loãng tín hiệu; chỉ khách mới thì phần PMax chiếm ~30–38% thay vì 10–13% → thí nghiệm dễ kết luận hơn. */
export interface KpiChoice { source?: "auto" | "ga4" | "csv" | "google"; ga4Event?: string; ga4NewOnly?: boolean }

/** KPI tuần × tỉnh trong [from, to] + đơn/chi PMax theo tỉnh. Ưu tiên GA4 → CSV → Google (ghi rõ lý do lùi). */
export async function readGeoData(company: Company, from: string, to: string, choice: KpiChoice = {}, tr: TFunction = viT): Promise<GeoData> {
  const want = choice.source ?? "auto"
  const event = (choice.ga4Event || "purchase").slice(0, 60)
  const g = await googleGeo(company, from, to)
  const weeks = fullWeeks(from, to)
  const notes: string[] = []
  if (want === "auto" || want === "ga4") {
    const r = await ga4Geo(company, from, to, event, !!choice.ga4NewOnly)
    if ("raw" in r) {
      const m = mapByName(r.raw, await vnProvinces(company))
      const total = Object.values(m.series).reduce((s, x) => s + Object.values(x).reduce((a, b) => a + b, 0), 0)
      if (total > 0) return { kpiKind: "orders", source: "ga4", sourceNote: tr("libgoogle.ge.ga4Src", { event, newOnly: choice.ga4NewOnly ? tr("libgoogle.ge.ga4NewOnly") : "" }), series: m.series, weeks, pmaxClaim: g.pmaxClaim, pmaxCost: g.pmaxCost, names: await geoNames(company, [...new Set([...Object.keys(m.series), ...Object.keys(g.pmaxClaim)])]), unmatched: m.unmatched }
      notes.push(tr("libgoogle.ge.ga4NoEvent", { event }))
    } else notes.push(tr("libgoogle.ge.ga4Err", { err: r.error }))
    if (want === "ga4") throw new PmaxControlError(notes.join(" · "))
  }
  if (want === "auto" || want === "csv") {
    const csv = readCsvKpi(company)
    if (csv?.rows.length) {
      const raw: Record<string, Record<string, number>> = {}
      for (const r of csv.rows) if (r.date >= from && r.date <= to) { const w = weekMonday(r.date); (raw[r.province] ??= {})[w] = (raw[r.province][w] ?? 0) + r.orders }
      const m = mapByName(raw, await vnProvinces(company))
      return { kpiKind: "orders", source: "csv", sourceNote: tr("libgoogle.ge.csvSrc", { date: csv.uploadedAt.slice(0, 10) }), series: m.series, weeks, pmaxClaim: g.pmaxClaim, pmaxCost: g.pmaxCost, names: await geoNames(company, [...new Set([...Object.keys(m.series), ...Object.keys(g.pmaxClaim)])]), unmatched: m.unmatched }
    }
    notes.push(tr("libgoogle.ge.csvNone"))
    if (want === "csv") throw new PmaxControlError(tr("libgoogle.ge.errCsv"))
  }
  return { kpiKind: "google_non_pmax", source: "google", sourceNote: tr("libgoogle.ge.googleSrc", { notes: notes.length ? " — " + notes.join(" · ") : "" }),
    series: g.nonPmax, weeks, pmaxClaim: g.pmaxClaim, pmaxCost: g.pmaxCost, names: await geoNames(company, [...new Set([...Object.keys(g.nonPmax), ...Object.keys(g.pmaxClaim)])]), unmatched: [] }
}

// ── Thiết kế ────────────────────────────────────────────────

export interface ExperimentDesign {
  company: Company
  pre: { from: string; to: string; weeks: string[] }
  kpi: { kind: KpiKind; source: GeoData["source"]; note: string; ga4Event?: string; ga4NewOnly?: boolean; unmatched: string[] }
  candidates: (DesignCandidate & { holdoutNames: string[] })[]
  campaigns: { id: string; name: string; cost: number; locations: { positive: string[]; negative: string[] } }[]
}

async function pmaxCampaignLocations(company: Company) {
  const c = getGoogleAdsCustomer(company)
  const [camps, crit] = await Promise.all([
    c.query(`SELECT campaign.id, campaign.name, metrics.cost_micros FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED' AND campaign_criterion.type = 'LOCATION'`) as Promise<Row[]>,
  ])
  const cost = new Map<string, number>()
  for (const r of camps) cost.set(String(r.campaign.id), (cost.get(String(r.campaign.id)) ?? 0) + (Number(r.metrics.cost_micros) || 0) / 1e6)
  const names = new Map(camps.map((r) => [String(r.campaign.id), String(r.campaign.name)]))
  const crits = crit.map((r) => ({ campaignId: String(r.campaign.id), resourceName: String(r.campaign_criterion.resource_name), negative: !!r.campaign_criterion.negative, bidModifier: Number(r.campaign_criterion.bid_modifier) || 0, geo: String(r.campaign_criterion.location?.geo_target_constant ?? "").split("/")[1] ?? "" }))
  return { names, cost, crits }
}

export async function designExperiment(company: Company, choice: KpiChoice = {}, now = new Date(), tr: TFunction = viT): Promise<ExperimentDesign> {
  const to = addDays(vnDate(now), -1)
  const lastMonday = weekMonday(to)
  const preTo = addDays(lastMonday, addDays(lastMonday, 6) <= to ? 6 : -1)
  const preFrom = addDays(weekMonday(preTo), -7 * (PRE_WEEKS - 1))
  const [d, loc] = await Promise.all([readGeoData(company, preFrom, preTo, choice, tr), pmaxCampaignLocations(company)])
  const candidates = designCandidates({ kpiKind: d.kpiKind, series: d.series, weeks: d.weeks, pmaxClaim: d.pmaxClaim, pmaxCost: d.pmaxCost, tr })
  const extra = await geoNames(company, candidates.flatMap((x) => x.holdout).filter((g) => !d.names[g]))
  const nm = { ...d.names, ...extra }
  return {
    company, pre: { from: preFrom, to: preTo, weeks: d.weeks },
    kpi: { kind: d.kpiKind, source: d.source, note: d.sourceNote, ga4Event: d.source === "ga4" ? (choice.ga4Event || "purchase") : undefined, ga4NewOnly: d.source === "ga4" ? !!choice.ga4NewOnly : undefined, unmatched: d.unmatched.slice(0, 20) },
    // Phương án đủ nhạy lên đầu (giao diện chọn sẵn phương án đầu), rồi theo mức phát hiện được 4 tuần.
    candidates: [...candidates].sort((a, b) => Number(b.sensitive) - Number(a.sensitive) || a.mde[4] - b.mde[4]).map((x) => ({ ...x, holdoutNames: x.holdout.map((g) => nm[g] ?? g) })),
    campaigns: [...loc.names.entries()].map(([id, name]) => ({ id, name, cost: loc.cost.get(id) ?? 0,
      locations: { positive: loc.crits.filter((x) => x.campaignId === id && !x.negative).map((x) => x.geo), negative: loc.crits.filter((x) => x.campaignId === id && x.negative).map((x) => x.geo) } })).sort((a, b) => b.cost - a.cost),
  }
}

// ── Bật / tắt ───────────────────────────────────────────────

export interface ExperimentOp { kind: "negative_added" | "positive_removed"; campaignId: string; geo: string; resourceName?: string; bidModifier?: number }
export interface GeoExperiment {
  id: string; company: Company; status: "running" | "ended" | "failed"
  createdAt: string; by: string
  candidateId: DesignCandidate["id"]; label: string; holdout: string[]; holdoutNames: string[]
  kpi: { kind: KpiKind; source: GeoData["source"]; ga4Event?: string; ga4NewOnly?: boolean }
  pre: { from: string; to: string; weeks: string[] }
  start: string; plannedEnd: string; weeks: number
  campaigns: { id: string; name: string }[]
  skipped: string[]
  ops: ExperimentOp[]
  pmaxClaimPerWeek: number; pmaxCostPerWeek: number; expectedEffect: number
  errors: string[]
  endedAt?: string; endedBy?: string; endReport?: string[]
  lastResult?: ExperimentResult & { at: string; leakCost: number }
}

function readLog(): GeoExperiment[] { try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as GeoExperiment[]) : [] } catch { return [] } }
function writeLog(list: GeoExperiment[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(list.slice(-100), null, 1)) }
export const listExperiments = (company: Company) => readLog().filter((e) => e.company === company).reverse()

export interface LaunchPlan { ops: ExperimentOp[]; skipped: string[] }
/** Kế hoạch ghi: loại trừ tỉnh vùng tắt trên từng PMax; gỡ nhắm đích danh nếu có (chỉ khi còn vùng nhắm khác). */
export function planLaunch(campaigns: ExperimentDesign["campaigns"], holdout: string[], tr: TFunction = viT): LaunchPlan {
  const ops: ExperimentOp[] = [], skipped: string[] = []
  const H = new Set(holdout)
  for (const cp of campaigns) {
    const pos = cp.locations.positive, neg = new Set(cp.locations.negative)
    const posHold = pos.filter((g) => H.has(g))
    const posOther = pos.filter((g) => !H.has(g))
    if (posHold.length && !posOther.length) { skipped.push(tr("libgoogle.ge.skipOnly", { name: cp.name })); continue }
    // Nhắm đích danh vài tỉnh KHÁC (không có vùng tắt, không nhắm cả nước) → vốn đã không chạy ở vùng tắt.
    if (pos.length && !posHold.length && !pos.includes("2704")) { skipped.push(tr("libgoogle.ge.skipAlready", { name: cp.name })); continue }
    for (const g of posHold) ops.push({ kind: "positive_removed", campaignId: cp.id, geo: g })
    for (const g of holdout) if (!neg.has(g)) ops.push({ kind: "negative_added", campaignId: cp.id, geo: g })
  }
  return { ops, skipped }
}

/** Tuần trọn đầu tiên của thí nghiệm: bật đúng thứ Hai thì tính luôn tuần đó, còn lại tính từ thứ Hai kế tiếp. */
export const firstTestMonday = (start: string) => (weekMonday(start) === start ? start : addDays(weekMonday(start), 7))

const round = (n: number) => Math.round(n * 100) / 100

export async function launchExperiment(input: { company: Company; candidateId: DesignCandidate["id"]; campaignIds: string[]; weeks: number; kpi: KpiChoice; actor: string; validateOnly: boolean; confirmText?: string; now?: Date }, tr: TFunction = viT): Promise<GeoExperiment> {
  const { company } = input
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(tr("libgoogle.ge.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  const weeks = Math.round(input.weeks)
  if (!(weeks >= MIN_TEST_WEEKS && weeks <= MAX_TEST_WEEKS)) throw new PmaxControlError(tr("libgoogle.ge.errWeeks", { min: MIN_TEST_WEEKS, max: MAX_TEST_WEEKS }))
  if (!input.validateOnly && readLog().some((e) => e.company === company && e.status === "running")) throw new PmaxControlError(tr("libgoogle.ge.errRunning"), 409)
  const design = await designExperiment(company, input.kpi, input.now, tr)
  const cand = design.candidates.find((x) => x.id === input.candidateId)
  if (!cand) throw new PmaxControlError(tr("libgoogle.ge.errCand"))
  const camps = design.campaigns.filter((x) => input.campaignIds.includes(x.id))
  if (!camps.length) throw new PmaxControlError(tr("libgoogle.ge.errNoCamp"))
  const plan = planLaunch(camps, cand.holdout, tr)
  const cust = customerIdOf(company)
  const c = getGoogleAdsCustomer(company)
  const today = vnDate(input.now)
  const exp: GeoExperiment = {
    id: `pmaxexp_${Date.now().toString(36)}`, company, status: "failed", createdAt: new Date().toISOString(), by: input.actor,
    candidateId: cand.id, label: cand.label, holdout: cand.holdout, holdoutNames: cand.holdoutNames,
    kpi: { kind: design.kpi.kind, source: design.kpi.source, ga4Event: design.kpi.ga4Event, ga4NewOnly: design.kpi.ga4NewOnly }, pre: design.pre,
    start: today, plannedEnd: addDays(firstTestMonday(today), 7 * weeks - 1), weeks,
    campaigns: camps.map((x) => ({ id: x.id, name: x.name })), skipped: plan.skipped, ops: plan.ops,
    pmaxClaimPerWeek: round(cand.pmaxClaimPerWeek), pmaxCostPerWeek: Math.round(cand.pmaxCostPerWeek), expectedEffect: cand.expectedEffect, errors: [],
  }
  if (!plan.ops.length) { exp.errors.push(tr("libgoogle.ge.errNoOps")); return exp }
  const loc = await pmaxCampaignLocations(company)
  const camp = (id: string) => `customers/${cust}/campaigns/${id}`
  const removes = plan.ops.filter((o) => o.kind === "positive_removed").map((o) => ({ o, crit: loc.crits.find((x) => x.campaignId === o.campaignId && x.geo === o.geo && !x.negative)! }))
  const adds = plan.ops.filter((o) => o.kind === "negative_added")
  // MỘT lệnh nguyên khối, gỡ trước rồi mới tạo: Google không cho tạo loại trừ cho tỉnh chiến dịch đang nhắm (cùng mã tiêu
  // chí → "negative is immutable"); gộp chung thì kiểm trước (validate_only) cũng qua (đo 28/09). Hỏng một dòng → cả lệnh
  // không ghi gì — không có trạng thái nửa vời.
  const mutateOps = [
    ...removes.map((r) => ({ entity: "campaign_criterion", operation: "remove", resource: r.crit.resourceName })),
    ...adds.map((o) => ({ entity: "campaign_criterion", operation: "create", resource: { campaign: camp(o.campaignId), negative: true, location: { geo_target_constant: `geoTargetConstants/${o.geo}` } } })),
  ]
  try { await c.mutateResources(mutateOps as never, { validate_only: true } as never) } catch (e) { exp.errors.push(tr("libgoogle.pa.errValidate", { msg: googleAdsErrorMessage(e) })) }
  if (input.validateOnly || exp.errors.length) { exp.status = exp.errors.length ? "failed" : "running"; return exp }
  return withFileLock(FILE, async () => {
    for (const r of removes) r.o.bidModifier = r.crit.bidModifier || undefined
    try {
      await c.mutateResources(mutateOps as never)
      // Mã tiêu chí vị trí = mã vùng → tên tài nguyên xác định được, không phụ thuộc thứ tự kết quả trả về.
      for (const o of adds) o.resourceName = `customers/${cust}/campaignCriteria/${o.campaignId}~${o.geo}`
    } catch (e) { exp.errors.push(tr("libgoogle.pa.errWrite", { msg: googleAdsErrorMessage(e) })) }
    // Đọc lại: loại trừ phải có; nhắm đích danh vùng tắt phải hết.
    try {
      const after = await pmaxCampaignLocations(company)
      for (const o of plan.ops) {
        const has = after.crits.some((x) => x.campaignId === o.campaignId && x.geo === o.geo && x.negative === (o.kind === "negative_added"))
        if (o.kind === "negative_added" ? !has : has) exp.errors.push(tr("libgoogle.ge.errMismatch", { kind: o.kind === "negative_added" ? tr("libgoogle.ge.kindNoExcl") : tr("libgoogle.ge.kindStill"), geo: o.geo, cid: o.campaignId }))
      }
    } catch (e) { exp.errors.push(tr("libgoogle.sc.errReadback", { msg: googleAdsErrorMessage(e) })) }
    // Ghi được phần nào cũng lưu RUNNING để kết thúc/hoàn tác được phần đó.
    exp.status = adds.some((o) => o.resourceName) || (!adds.length && !exp.errors.length) ? "running" : "failed"
    writeLog([...readLog(), exp])
    return exp
  })
}

/** Kết thúc: gỡ loại trừ tool đã thêm, trả nhắm đích danh cũ (kèm hệ số giá). Chỉ đụng đúng thứ tool đã làm. */
export async function endExperiment(company: Company, id: string, actor: string, reason = "Kết thúc tay", tr: TFunction = viT): Promise<GeoExperiment> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const exp = log.find((e) => e.id === id && e.company === company)
    if (!exp) throw new PmaxControlError(tr("libgoogle.ge.errNoExp"), 404)
    if (exp.status !== "running") throw new PmaxControlError(tr("libgoogle.ge.errNotRunning"), 409)
    try { exp.lastResult = await measure(exp, new Date(), tr) } catch { /* kết thúc vẫn phải làm dù đo hỏng */ }
    const c = getGoogleAdsCustomer(company)
    const cust = customerIdOf(company)
    const report: string[] = [reason]
    const neg = exp.ops.filter((o) => o.kind === "negative_added" && o.resourceName)
    const pos = exp.ops.filter((o) => o.kind === "positive_removed")
    const loc = await pmaxCampaignLocations(company)
    const stillThere = neg.filter((o) => loc.crits.some((x) => x.resourceName === o.resourceName))
    if (neg.length - stillThere.length) report.push(tr("libgoogle.ge.rpGone", { n: neg.length - stillThere.length }))
    const toRestore = pos.filter((o) => !loc.crits.some((x) => x.campaignId === o.campaignId && x.geo === o.geo && !x.negative))
    // Gỡ loại trừ + trả nhắm cũ trong MỘT lệnh (cùng mã tiêu chí — tách hai lệnh thì lệnh tạo bị từ chối).
    const ops = [
      ...stillThere.map((o) => ({ entity: "campaign_criterion", operation: "remove", resource: o.resourceName })),
      ...toRestore.map((o) => ({ entity: "campaign_criterion", operation: "create", resource: { campaign: `customers/${cust}/campaigns/${o.campaignId}`, location: { geo_target_constant: `geoTargetConstants/${o.geo}` }, ...(o.bidModifier ? { bid_modifier: o.bidModifier } : {}) } })),
    ]
    if (ops.length) {
      try { await c.mutateResources(ops as never) } catch (e) {
        // Chưa trả được tài khoản về như cũ → GIỮ trạng thái đang chạy để thử lại, không báo "đã kết thúc".
        throw new PmaxControlError(tr("libgoogle.ge.errEnd", { msg: googleAdsErrorMessage(e) }), 502)
      }
      if (stillThere.length) report.push(tr("libgoogle.ge.rpRemoved", { n: stillThere.length }))
      if (toRestore.length) report.push(tr("libgoogle.ge.rpRestored", { n: toRestore.length }))
    }
    exp.status = "ended"; exp.endedAt = new Date().toISOString(); exp.endedBy = actor; exp.endReport = report
    writeLog(log)
    return exp
  })
}

async function measure(exp: GeoExperiment, now = new Date(), tr: TFunction = viT): Promise<ExperimentResult & { at: string; leakCost: number }> {
  const to = addDays(vnDate(now), -1)
  const end = exp.endedAt ? exp.endedAt.slice(0, 10) : to
  const d = await readGeoData(exp.company, exp.pre.from, end < to ? end : to, { source: exp.kpi.source, ga4Event: exp.kpi.ga4Event, ga4NewOnly: exp.kpi.ga4NewOnly }, tr)
  const testWeeks = d.weeks.filter((w) => w >= firstTestMonday(exp.start))
  const r = analyzeExperiment({ kpiKind: exp.kpi.kind, series: d.series, holdout: exp.holdout, preWeeks: exp.pre.weeks, testWeeks, pmaxClaimPerWeek: exp.pmaxClaimPerWeek, tr })
  // Rò rỉ: PMax vẫn tiêu ở vùng tắt từ ngày bật (người ở gần ranh giới / đang đi lại).
  const leak = await googleGeo(exp.company, exp.start, to)
  const leakCost = exp.holdout.reduce((s, g) => s + (leak.pmaxCost[g] ?? 0), 0)
  return { ...r, at: new Date().toISOString(), leakCost: Math.round(leakCost) }
}

export async function experimentStatus(company: Company, id: string, tr: TFunction = viT): Promise<GeoExperiment> {
  const exp = readLog().find((e) => e.id === id && e.company === company)
  if (!exp) throw new PmaxControlError(tr("libgoogle.ge.errNoExp"), 404)
  const result = await measure(exp, new Date(), tr)
  await withFileLock(FILE, async () => { const log = readLog(); const e = log.find((x) => x.id === id); if (e) { e.lastResult = result; writeLog(log) } })
  return { ...exp, lastResult: result }
}

/** Job hằng ngày: tới ngày hẹn → tự kết thúc (trả tài khoản về như cũ) + báo; ngày thường → đo lại. */
export async function runExperimentJob(now = new Date()): Promise<{ id: string; company: Company; action: string }[]> {
  const out: { id: string; company: Company; action: string }[] = []
  const today = vnDate(now)
  for (const e of readLog().filter((x) => x.status === "running")) {
    try {
      if (today > e.plannedEnd) { const r = await endExperiment(e.company, e.id, "Tự động (hết hạn)", `Tự kết thúc đúng hẹn ${e.plannedEnd}`); out.push({ id: e.id, company: e.company, action: `kết thúc — ${r.lastResult?.text ?? "chưa đo được"}` }) }
      else {
        const r = await experimentStatus(e.company, e.id)
        // Cảnh báo sớm (user 28/09 lo mất nhiều đơn): ≥ 2 tuần mà đơn vùng tắt giảm gần đúng mức Google ghi → báo để kết thúc sớm.
        const early = r.lastResult && r.lastResult.testWeeks >= 2 && (r.lastResult.verdict === "google_dung" || r.lastResult.verdict === "mot_phan")
        out.push({ id: e.id, company: e.company, action: early ? `cảnh báo — đơn vùng tắt đang giảm (${Math.round(r.lastResult!.change * 100)}%, ~${Math.round(-r.lastResult!.kpiDelta)} đơn). ${r.lastResult!.text} Cân nhắc kết thúc sớm.` : `đo lại — ${r.lastResult?.text || r.lastResult?.verdict}` })
      }
    } catch (err) { out.push({ id: e.id, company: e.company, action: `lỗi: ${err instanceof Error ? err.message : String(err)}` }) }
  }
  return out
}
