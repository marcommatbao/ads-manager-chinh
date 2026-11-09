// ============================================================
// Đợt 10c (C4) — Thí nghiệm loại trừ vùng cho PMax: CHỌN VÙNG + ĐỘ NHẠY + PHÂN TÍCH (hàm thuần)
// ============================================================
// Google API v23 không có loại thí nghiệm PMax và không cho tắt riêng YouTube trong PMax → tool tự dựng: TẮT PMax ở một
// nhóm tỉnh ("vùng tắt") trong N tuần, giữ nguyên nơi khác ("vùng đối chứng"), rồi so tỉ lệ ĐƠN THẬT vùng tắt / vùng đối
// chứng trước và trong thí nghiệm (khác-biệt-trong-khác-biệt trên log tỉ lệ theo tuần).
//   · Google đúng (đơn PMax là đơn thêm thật) → vùng tắt mất khoảng "đơn PMax Google ghi ở vùng đó".
//   · Đơn PMax không phải đơn thêm (khách đằng nào cũng mua) → đơn thật vùng tắt gần như không đổi.
// Đo 28/09: MBC dồn gần hết đơn vào TP.HCM (~1.166/30 ngày) + Hà Nội (~801); tỉnh thứ ba ~67 → phương án "các tỉnh
// khác" có ít đơn, nhiễu lớn. Vì vậy tool TÍNH độ nhạy (mức giảm nhỏ nhất phát hiện được) cho từng phương án để chọn.
//
// Chỉ số (KPI):
//   "orders"          — đơn thật MỌI kênh (GA4 hoặc CSV từ hệ thống bán hàng). Đúng nhất.
//   "google_non_pmax" — chuyển đổi Google của các chiến dịch KHÔNG phải PMax (khi chưa có GA4/CSV). Đo được "đơn PMax
//                       chạy sang Search" khi tắt PMax; đơn chạy sang tự nhiên/trực tiếp thì KHÔNG thấy → thiên về
//                       kết luận "PMax tạo đơn thêm". Luôn ghi rõ trên giao diện.

import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

export type KpiKind = "orders" | "google_non_pmax"
/** series[geoId][weekMonday] = KPI tuần đó. */
export type WeeklySeries = Record<string, Record<string, number>>

export const HCM = "9040373"
export const HANOI = "9040331"
const Z_POWER = 2.8 // 80% độ mạnh, α = 5% hai phía
const Z_CI = 1.96
const SMOOTH = 0.5 // cộng vào tuần có 0 đơn để log không vỡ
/** Dưới mức này/tuần thì log tỉ lệ chỉ là nhiễu làm tròn (đo 28/09: MBI Search ngoài PMax ~0,1 đơn/tuần ở HN nhưng
 *  độ lệch tính ra ≈ 0 → báo "đủ nhạy" SAI). Không đủ số → không cho coi là đo được. */
export const MIN_KPI_PER_WEEK = 5

export interface DesignCandidate {
  id: "hn" | "hcm" | "tinh"
  label: string
  holdout: string[]
  /** Tỉ phần KPI của vùng tắt trong kỳ trước. */
  holdoutShare: number
  kpiHoldoutPerWeek: number
  /** Đơn PMax Google ghi ở vùng tắt / tuần (gồm cả đơn sau lượt xem). */
  pmaxClaimPerWeek: number
  pmaxCostPerWeek: number
  /** Nếu Google đúng: KPI vùng tắt giảm bao nhiêu (0..1). Với google_non_pmax: tăng bao nhiêu nếu đơn PMax KHÔNG phải đơn thêm. */
  expectedEffect: number
  preWeeks: number
  logRatioSd: number
  /** Mức thay đổi nhỏ nhất phát hiện được (0..1) theo số tuần chạy. */
  mde: Record<number, number>
  sensitive: boolean
  note: string
}

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0)
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const sd = (xs: number[]) => { if (xs.length < 2) return Infinity; const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)) }

/** Log tỉ lệ vùng tắt / vùng đối chứng theo từng tuần (chỉ tuần có số ở cả hai phía). */
export function logRatios(series: WeeklySeries, holdout: string[], weeks: string[]): number[] {
  const H = new Set(holdout)
  return weeks.map((w) => {
    let h = 0, c = 0
    for (const [g, s] of Object.entries(series)) { const v = s[w] ?? 0; if (H.has(g)) h += v; else c += v }
    return c > 0 ? Math.log((h + SMOOTH) / (c + SMOOTH)) : NaN
  }).filter((x) => Number.isFinite(x))
}

export const mdeFor = (sdLog: number, nPre: number, nTest: number) => (Number.isFinite(sdLog) && nPre > 1 ? 1 - Math.exp(-Z_POWER * sdLog * Math.sqrt(1 / nPre + 1 / nTest)) : 1)

/** Chia các tỉnh còn lại thành 2 nửa cân KPI (kiểu "rắn": 1-2-2-1…) → nửa A là vùng tắt. */
export function splitProvinces(totals: Record<string, number>, exclude: string[]): string[] {
  const ex = new Set(exclude)
  const sorted = Object.entries(totals).filter(([g, v]) => !ex.has(g) && v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const a: string[] = []; let sa = 0, sb = 0
  for (const [g, v] of sorted) { if (sa <= sb) { a.push(g); sa += v } else sb += v }
  return a
}

export function designCandidates(input: {
  kpiKind: KpiKind
  series: WeeklySeries
  weeks: string[]
  /** Đơn PMax Google ghi theo vùng, tổng cả kỳ trước. */
  pmaxClaim: Record<string, number>
  pmaxCost: Record<string, number>
  testWeeks?: number[]
  tr?: TFunction
}): DesignCandidate[] {
  const tr = input.tr ?? viT
  const { series, weeks, kpiKind } = input
  const nPre = weeks.length
  const totals: Record<string, number> = {}
  for (const [g, s] of Object.entries(series)) totals[g] = sum(weeks.map((w) => s[w] ?? 0))
  const all = sum(Object.values(totals))
  const testWeeks = input.testWeeks ?? [4, 6, 8]
  const mk = (id: DesignCandidate["id"], label: string, holdout: string[]): DesignCandidate => {
    const kpiH = sum(holdout.map((g) => totals[g] ?? 0))
    const claim = sum(holdout.map((g) => input.pmaxClaim[g] ?? 0))
    const cost = sum(holdout.map((g) => input.pmaxCost[g] ?? 0))
    const lr = logRatios(series, holdout, weeks)
    const s = sd(lr)
    const kpiPerWeek = nPre ? kpiH / nPre : 0
    const claimPerWeek = nPre ? claim / nPre : 0
    // orders: Google đúng → mất claim/(kpi) phần đơn. google_non_pmax: đơn PMax KHÔNG phải đơn thêm → Search đón lại
    // tối đa claim/(kpi) phần (trần 95% cho đẹp số khi claim áp đảo).
    const expected = kpiPerWeek > 0 ? Math.min(0.95, claimPerWeek / (kpiKind === "orders" ? kpiPerWeek : kpiPerWeek + claimPerWeek)) : 0
    const controlPerWeek = nPre ? (all - kpiH) / nPre : 0
    const tooFew = kpiPerWeek < MIN_KPI_PER_WEEK || controlPerWeek < MIN_KPI_PER_WEEK
    const mde = Object.fromEntries(testWeeks.map((t) => [t, tooFew ? 1 : mdeFor(s, lr.length, t)]))
    const bestMde = Math.min(...Object.values(mde))
    // "Đủ nhạy" = phân biệt được "Google đúng" với "không tạo đơn thêm" (mức phát hiện ≤ 80% mức kỳ vọng). Đo được cả mức lưng
    // chừng (vd đúng một nửa) cần ≤ 50% — ghi trong câu chú thích. Đo 28/09 MBC Hà Nội (GA4 khách mới): kỳ vọng 30%, phát hiện ≥ 19%/6 tuần.
    const sensitive = !tooFew && expected > 0 && bestMde <= expected * 0.8
    const fine = !tooFew && expected > 0 && bestMde <= expected * 0.5
    const note = !lr.length ? tr("libgoogle.gd.noteNoData") :
      tooFew ? tr("libgoogle.gd.noteTooFew", { h: kpiPerWeek.toFixed(1), c: controlPerWeek.toFixed(1), min: MIN_KPI_PER_WEEK }) :
      fine ? tr("libgoogle.gd.noteFine", { mde: pct(bestMde), exp: pct(expected) }) :
      sensitive ? tr("libgoogle.gd.noteSensitive", { exp: pct(expected), mde: pct(bestMde), weeks: String(Object.entries(mde).find(([, v]) => v === bestMde)?.[0]) }) :
      tr("libgoogle.gd.noteWeak", { mde: pct(bestMde), exp: pct(expected) })
    return { id, label, holdout, holdoutShare: all ? kpiH / all : 0, kpiHoldoutPerWeek: kpiPerWeek, pmaxClaimPerWeek: claimPerWeek, pmaxCostPerWeek: nPre ? cost / nPre : 0,
      expectedEffect: expected, preWeeks: lr.length, logRatioSd: s, mde, sensitive, note }
  }
  const out: DesignCandidate[] = []
  if (totals[HANOI]) out.push(mk("hn", tr("libgoogle.gd.lblHn"), [HANOI]))
  if (totals[HCM]) out.push(mk("hcm", tr("libgoogle.gd.lblHcm"), [HCM]))
  const half = splitProvinces(totals, [HANOI, HCM])
  if (half.length) out.push(mk("tinh", tr("libgoogle.gd.lblTinh", { n: half.length }), half))
  return out
}

export interface ExperimentResult {
  testWeeks: number
  /** Thay đổi KPI vùng tắt so với dự đoán nếu không làm gì (âm = giảm). */
  change: number
  ciLow: number
  ciHigh: number
  /** KPI vùng tắt mất/thêm (đơn) trong thời gian chạy. */
  kpiDelta: number
  /** Đơn PMax Google ghi ở vùng tắt cho cùng số tuần (theo kỳ trước). */
  claimed: number
  /** Tỉ lệ đơn PMax là đơn thêm thật (0..1+) — orders: mất/claim; google_non_pmax: 1 − đón lại/claim. */
  incrementality: number | null
  verdict: "chua_du" | "google_dung" | "mot_phan" | "khong_them" | "khong_ro"
  text: string
}

/** Khác-biệt-trong-khác-biệt trên log tỉ lệ tuần. Cần ≥ 2 tuần chạy. */
export function analyzeExperiment(input: { kpiKind: KpiKind; series: WeeklySeries; holdout: string[]; preWeeks: string[]; testWeeks: string[]; pmaxClaimPerWeek: number; tr?: TFunction }): ExperimentResult {
  const tr = input.tr ?? viT
  const pre = logRatios(input.series, input.holdout, input.preWeeks)
  const test = logRatios(input.series, input.holdout, input.testWeeks)
  const H = new Set(input.holdout)
  const claimed = input.pmaxClaimPerWeek * test.length
  const base = { testWeeks: test.length, claimed }
  if (test.length < 2 || pre.length < 2) return { ...base, change: 0, ciLow: 0, ciHigh: 0, kpiDelta: 0, incrementality: null, verdict: "chua_du", text: tr("libgoogle.gd.notEnough", { n: test.length }) }
  const d = mean(test) - mean(pre)
  const se = sd(pre) * Math.sqrt(1 / pre.length + 1 / test.length)
  const change = Math.exp(d) - 1
  const ciLow = Math.exp(d - Z_CI * se) - 1, ciHigh = Math.exp(d + Z_CI * se) - 1
  // Đơn vùng tắt thực tế vs dự đoán (đối chứng tuần đó × tỉ lệ kỳ trước).
  const preRatio = Math.exp(mean(pre))
  let actual = 0, predicted = 0
  for (const w of input.testWeeks) {
    let h = 0, c = 0
    for (const [g, s] of Object.entries(input.series)) { const v = s[w] ?? 0; if (H.has(g)) h += v; else c += v }
    if (c > 0) { actual += h; predicted += c * preRatio }
  }
  const kpiDelta = actual - predicted
  let incrementality: number | null = null
  if (claimed > 0) incrementality = input.kpiKind === "orders" ? Math.max(0, -kpiDelta) / claimed : Math.max(0, 1 - Math.max(0, kpiDelta) / claimed)
  const expected = predicted > 0 ? claimed / (input.kpiKind === "orders" ? predicted : predicted + claimed) : 0
  let verdict: ExperimentResult["verdict"]
  if (input.kpiKind === "orders") {
    if (ciHigh < -expected * 0.7) verdict = "google_dung"
    else if (ciLow > -expected * 0.3) verdict = "khong_them"
    else if (ciHigh < 0) verdict = "mot_phan"
    else verdict = "khong_ro"
  } else {
    // KPI là đơn Search: tăng mạnh = đơn PMax chạy sang Search (không phải đơn thêm).
    if (ciLow > expected * 0.7) verdict = "khong_them"
    else if (ciHigh < expected * 0.3) verdict = "google_dung"
    else if (ciLow > 0) verdict = "mot_phan"
    else verdict = "khong_ro"
  }
  const inc = incrementality == null ? "" : tr("libgoogle.gd.incText", { pct: pct(Math.min(incrementality, 1)) })
  const TEXT: Record<ExperimentResult["verdict"], string> = {
    chua_du: "",
    google_dung: tr("libgoogle.gd.vGoogle", { what: input.kpiKind === "orders" ? tr("libgoogle.gd.kpiOrdersDown") : tr("libgoogle.gd.kpiSearchNoMake"), inc }),
    mot_phan: tr("libgoogle.gd.vPartial", { inc }),
    khong_them: tr("libgoogle.gd.vNone", { what: input.kpiKind === "orders" ? tr("libgoogle.gd.kpiOrdersFlat") : tr("libgoogle.gd.kpiSearchBack"), inc }),
    khong_ro: tr("libgoogle.gd.vUnclear", { lo: pct(ciLow), hi: pct(ciHigh) }),
  }
  return { ...base, change, ciLow, ciHigh, kpiDelta, incrementality, verdict, text: TEXT[verdict] }
}

export const pct = (x: number) => `${Math.round(x * 100)}%`

/** Thứ Hai (giờ VN) của tuần chứa ngày ymd — khớp segments.week của Google Ads. */
export function weekMonday(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
/** Các thứ Hai của những tuần TRỌN nằm trong [from, to]. */
export function fullWeeks(from: string, to: string): string[] {
  const out: string[] = []
  let m = weekMonday(from)
  if (m < from) m = addDaysUTC(m, 7)
  while (addDaysUTC(m, 6) <= to) { out.push(m); m = addDaysUTC(m, 7) }
  return out
}
function addDaysUTC(ymd: string, n: number): string { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
