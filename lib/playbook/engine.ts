// ============================================================
// Sổ kinh nghiệm (Đợt 7 · 7a) — lõi chấm + bóc đặc điểm, HÀM THUẦN
// ============================================================
// Thiết kế: docs/DESIGN-DOT7.md. Không phụ thuộc ERP: chỉ dùng số Meta/Google.
//
// Mô hình chung cho cả hai nền tảng: "đơn vị" (nhóm quảng cáo, lát cắt vị trí,
// cụm tìm kiếm, trang đích…) có chi phí + kết quả theo từng chỉ số, tách hai
// nửa kỳ, và mang một danh sách "đặc điểm". So thắng/thua CHỈ trong cùng nhóm
// (công ty × sản phẩm × nền tảng × loại đơn vị) — so cụm tìm kiếm với nhóm
// quảng cáo là vô nghĩa.
//
// Mọi ngưỡng dưới đây là QUY ƯỚC của tool (ghi trong thiết kế), hiện trên màn hình.

import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { Company } from "@/lib/case/types"

export type Platform = "facebook" | "google"
export type Metric = "purchase" | "initiate_checkout" | "landing_view"
export type FeatureKind =
  | "age" | "gender" | "interest" | "advantage_audience" | "custom_audience" | "opt_event" | "placement" | "budget_tier"
  | "ad_format" | "hook" | "headline" | "cta" | "landing"
  | "search_theme" | "keyword" | "rsa_headline" | "device" | "hour"
  | "pmax_text" | "channel"

export interface Half { cost: number; purchase: number; initiate_checkout: number; landing_view: number }
export interface Unit {
  platform: Platform
  company: Company
  product: string
  /** Loại đơn vị — chỉ so các đơn vị cùng loại. */
  unitType: string
  unitId: string
  unitName: string
  campaignId: string
  campaignName: string
  h1: Half
  h2: Half
  features: { kind: FeatureKind; value: string; label?: string }[]
  /** Nhóm đơn vị KHÔNG phải khách mới (thương hiệu/tra cứu/đối thủ) — kinh nghiệm tối đa Trung bình + ghi chú này. */
  nonIncremental?: string
}

export const METRIC_ORDER: Metric[] = ["purchase", "initiate_checkout", "landing_view"]
export const METRIC_LABEL: Record<Metric, string> = { purchase: "Mua hàng", initiate_checkout: "Bắt đầu thanh toán", landing_view: "Xem trang đích" }
/** Nhãn chỉ số theo ngôn ngữ (METRIC_LABEL giữ tiếng Việt cho nơi không có t). */
export const metricLabel = (m: Metric, t: TFunction = makeT("vi")): string => t(`libcase.w.metric.${m}` as never)

/** Chỉ số dùng được khi nhóm có ít nhất ngần này đơn vị đạt ≥ MIN_UNIT_RESULTS kết quả. */
export const MIN_SCORABLE_UNITS = 4
export const MIN_UNIT_RESULTS = 5
export const WIN_RATIO = 0.8
export const LOSE_RATIO = 1.25
/** Độ tin cậy CAO — tool tự dùng. */
export const HIGH = { winUnits: 3, campaigns: 2, results: 30, lift: 1.3 }
/** Độ tin cậy TRUNG BÌNH — gợi ý. */
export const MEDIUM = { winUnits: 2, results: 10, lift: 1.2 }
/** Nên tránh: ≥ ngần này đơn vị thua, tổng chi ≥ AVOID_COST_X × trung vị chi phí/kết quả mà 0 kết quả. */
export const AVOID = { loseUnits: 3, costX: 3 }

const total = (u: Unit): Half => ({
  cost: u.h1.cost + u.h2.cost, purchase: u.h1.purchase + u.h2.purchase,
  initiate_checkout: u.h1.initiate_checkout + u.h2.initiate_checkout, landing_view: u.h1.landing_view + u.h2.landing_view,
})
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Chỉ số sâu nhất đủ mẫu trong một nhóm đơn vị; null = chưa đủ dữ liệu. */
export function chooseMetric(units: Unit[]): Metric | null {
  for (const m of METRIC_ORDER) if (units.filter((u) => total(u)[m] >= MIN_UNIT_RESULTS).length >= MIN_SCORABLE_UNITS) return m
  return null
}

export type Verdict = "win" | "lose" | "neutral"
export function classify(units: Unit[], metric: Metric): { median: number; verdicts: Map<string, Verdict> } {
  const cprs = units.map((u) => { const t = total(u); return t[metric] >= MIN_UNIT_RESULTS ? t.cost / t[metric] : null }).filter((x): x is number => x !== null)
  const M = median(cprs)
  const verdicts = new Map<string, Verdict>()
  for (const u of units) {
    const t = total(u)
    let v: Verdict = "neutral"
    if (M > 0) {
      if (t[metric] >= MIN_UNIT_RESULTS && t.cost / t[metric] <= WIN_RATIO * M) v = "win"
      else if ((t[metric] > 0 && t.cost / t[metric] >= LOSE_RATIO * M) || (t[metric] === 0 && t.cost >= 2 * M)) v = "lose"
    }
    verdicts.set(u.unitId, v)
  }
  return { median: M, verdicts }
}

export interface PlaybookStat {
  results: number; cost: number; cpr: number | null; lift: number | null
  winUnits: number; loseUnits: number; campaigns: number; halvesAgree: boolean
}
export interface Finding {
  key: string
  company: Company; product: string; platform: Platform; unitType: string
  kind: FeatureKind; value: string; label: string
  direction: "use" | "avoid"
  metric: Metric
  confidence: "high" | "medium"
  stat: PlaybookStat
  evidence: { unitName: string; campaignName: string; cost: number; results: number; verdict: Verdict }[]
  /** Vì sao không được tự dùng dù số đẹp (vd tìm thương hiệu = khách cũ). */
  note?: string
  /** Từng đặc điểm con khi dòng là GỘP (value "a+b"), cùng thứ tự với value — để 7b điền đúng id ↔ tên. */
  parts?: { value: string; label: string }[]
}

/** lift = chi phí/kết quả khi KHÔNG có ÷ khi CÓ (>1 = có đặc điểm thì rẻ hơn). */
function liftOf(withU: Unit[], withoutU: Unit[], metric: Metric, half?: "h1" | "h2"): number | null {
  const sum = (us: Unit[]) => us.reduce((a, u) => { const h = half ? u[half] : total(u); return { c: a.c + h.cost, r: a.r + h[metric] } }, { c: 0, r: 0 })
  const a = sum(withU), b = sum(withoutU)
  if (!a.r || !b.r) return null
  return (b.c / b.r) / (a.c / a.r)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Bóc kinh nghiệm cho MỘT nhóm đơn vị (cùng công ty × sản phẩm × nền tảng × loại đơn vị). */
export function extractGroup(units: Unit[]): { metric: Metric | null; median: number; findings: Finding[] } {
  if (!units.length) return { metric: null, median: 0, findings: [] }
  const metric = chooseMetric(units)
  if (!metric) return { metric: null, median: 0, findings: [] }
  const { median: M, verdicts } = classify(units, metric)
  const base = units[0]
  const byFeature = new Map<string, { kind: FeatureKind; value: string; label: string; units: Unit[]; parts?: { value: string; label: string }[] }>()
  for (const u of units) for (const f of u.features) {
    const k = `${f.kind}|${f.value}`
    const cur = byFeature.get(k) ?? { kind: f.kind, value: f.value, label: f.label ?? f.value, units: [] }
    if (!cur.units.includes(u)) cur.units.push(u)
    byFeature.set(k, cur)
  }
  // Đặc điểm LUÔN đi cùng nhau (cùng đúng một tập đơn vị — vd 12 sở thích đặt chung trong 2 nhóm) → gộp một dòng.
  // Đo 28/09: không gộp thì Sổ có 12 dòng "Sở thích: …" số y hệt nhau.
  const bySig = new Map<string, { kind: FeatureKind; values: string[]; labels: string[]; units: Unit[] }>()
  for (const f of byFeature.values()) {
    const sig = `${f.kind}|${f.units.map((u) => u.unitId).sort().join(",")}`
    const cur = bySig.get(sig)
    if (cur) { cur.values.push(f.value); cur.labels.push(f.label) } else bySig.set(sig, { kind: f.kind, values: [f.value], labels: [f.label], units: f.units })
  }
  byFeature.clear()
  for (const g of bySig.values()) {
    const label = g.labels.length === 1 ? g.labels[0]
      : g.kind === "interest" ? `Bộ sở thích (luôn đi chung): ${g.labels.map((l) => l.replace(/^Sở thích: /, "")).slice(0, 6).join(", ")}${g.labels.length > 6 ? ` +${g.labels.length - 6}` : ""}`
      : g.labels.slice(0, 4).join(" + ")
    // Sắp CẶP (mã, tên) cùng nhau — sắp riêng mã thì tên lệch chỗ (bộ sở thích điền nhầm tên).
    const parts = g.values.map((value, i) => ({ value, label: g.labels[i] })).sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    const value = parts.map((x) => x.value).join("+")
    byFeature.set(`${g.kind}|${value}`, { kind: g.kind, value, label, units: g.units, ...(parts.length > 1 ? { parts } : {}) })
  }
  const findings: Finding[] = []
  // Chỉ số trung gian, hoặc nhóm không phải khách mới (đo 27/09: 15/15 kinh nghiệm "cao" đầu tiên của Google là
  // tìm "id matbao", "đăng nhập" — khách cũ vào gia hạn) → tối đa Trung bình, không bao giờ tự dùng.
  const intermediate = metric !== "purchase" || !!base.nonIncremental
  for (const [k, f] of byFeature) {
    const withIds = new Set(f.units.map((u) => u.unitId))
    const without = units.filter((u) => !withIds.has(u.unitId))
    if (!without.length) continue // mọi đơn vị đều có → không so được
    const t = f.units.reduce((a, u) => { const h = total(u); return { c: a.c + h.cost, r: a.r + h[metric] } }, { c: 0, r: 0 })
    const winners = f.units.filter((u) => verdicts.get(u.unitId) === "win")
    const losers = f.units.filter((u) => verdicts.get(u.unitId) === "lose")
    const lift = liftOf(f.units, without, metric)
    const l1 = liftOf(f.units, without, metric, "h1"), l2 = liftOf(f.units, without, metric, "h2")
    const stat: PlaybookStat = {
      results: t.r, cost: Math.round(t.c), cpr: t.r ? Math.round(t.c / t.r) : null, lift: lift === null ? null : round2(lift),
      winUnits: winners.length, loseUnits: losers.length, campaigns: new Set(winners.map((u) => u.campaignId)).size,
      halvesAgree: l1 !== null && l2 !== null && l1 > 1 && l2 > 1,
    }
    const evidence = f.units.map((u) => ({ unitName: u.unitName, campaignName: u.campaignName, cost: Math.round(total(u).cost), results: total(u)[metric], verdict: verdicts.get(u.unitId) ?? "neutral" }))
      .sort((a, b) => Number(b.verdict === "win") - Number(a.verdict === "win") || b.results - a.results).slice(0, 8)
    const common = { key: `${base.company}|${base.product}|${base.platform}|${base.unitType}|${k}`, company: base.company, product: base.product, platform: base.platform, unitType: base.unitType, kind: f.kind, value: f.value, label: f.label, metric, stat, evidence, ...(base.nonIncremental ? { note: base.nonIncremental } : {}), ...(f.parts ? { parts: f.parts } : {}) }
    // Nên dùng
    if (lift !== null) {
      const high = !intermediate && stat.winUnits >= HIGH.winUnits && stat.campaigns >= HIGH.campaigns && t.r >= HIGH.results && lift >= HIGH.lift && stat.halvesAgree
      const medium = stat.winUnits >= MEDIUM.winUnits && t.r >= MEDIUM.results && lift >= MEDIUM.lift
      if (high || medium) { findings.push({ ...common, direction: "use", confidence: high ? "high" : "medium" }); continue }
    }
    // Nên tránh: nhiều đơn vị thua, tiêu đủ nhiều mà 0 kết quả.
    if (stat.loseUnits >= AVOID.loseUnits && t.r === 0 && t.c >= AVOID.costX * M) {
      const high = !intermediate && stat.loseUnits >= HIGH.winUnits && new Set(losers.map((u) => u.campaignId)).size >= HIGH.campaigns
      findings.push({ ...common, direction: "avoid", confidence: high ? "high" : "medium" })
    }
  }
  findings.sort((a, b) => Number(b.confidence === "high") - Number(a.confidence === "high") || (b.stat.lift ?? 0) - (a.stat.lift ?? 0))
  return { metric, median: Math.round(M), findings }
}

/** Gom đơn vị thành nhóm so sánh rồi bóc từng nhóm. */
export function extractAll(units: Unit[]): { groups: { key: string; metric: Metric | null; median: number; units: number }[]; findings: Finding[] } {
  const groups = new Map<string, Unit[]>()
  for (const u of units) {
    const k = `${u.company}|${u.product}|${u.platform}|${u.unitType}`
    groups.set(k, [...(groups.get(k) ?? []), u])
  }
  const out: { key: string; metric: Metric | null; median: number; units: number }[] = []
  const findings: Finding[] = []
  for (const [k, us] of groups) {
    const r = extractGroup(us)
    out.push({ key: k, metric: r.metric, median: r.median, units: us.length })
    findings.push(...r.findings)
  }
  return { groups: out, findings }
}
