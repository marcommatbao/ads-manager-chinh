import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// Đợt 28d — tách số theo đối tượng / vị trí (Meta: tuổi, giới, vị trí; Google: thiết bị, khung giờ) — HÀM THUẦN
// ============================================================
// Mỗi dòng so với PHẦN CÒN LẠI của chính bảng đó (cùng kỳ, cùng loại kết quả): chi phí/kết quả đắt hay rẻ RÕ (Poisson, như
// thẻ so kỳ) — ít số thì không kết luận. Không có "kết quả" (chỉ có chi phí) thì chỉ hiện tỉ trọng chi.
import { judgeRatio, MIN_COUNT } from "./build"
import type { GoalKind } from "@/lib/case/goal-kind"

export interface BRow { key: string; label: string; spend: number; impressions: number; clicks: number; results: number }
export interface BRowOut extends BRow { share: number; costPerResult: number | null; ctr: number | null; tag: "dat_ro" | "re_ro" | null; note: string | null }
export interface BTable { dim: string; title: string; kind: GoalKind; rows: BRowOut[]; totalSpend: number; totalResults: number }

export function buildTable(dim: string, title: string, kind: GoalKind, input: BRow[], t: TFunction = makeT("vi")): BTable {
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(t("libcase.r.numLocale"))}`
  const word = t(kind === "leads" ? "libcase.r.tr.word.leads" : "libcase.r.tr.word.sales")
  const rows0 = input.filter((r) => r.spend > 0)
  const totalSpend = rows0.reduce((s, r) => s + r.spend, 0), totalResults = rows0.reduce((s, r) => s + r.results, 0)
  const rows: BRowOut[] = rows0.map((r) => {
    const cpr = r.results > 0 ? r.spend / r.results : null
    const restSpend = totalSpend - r.spend, restN = totalResults - r.results
    const restCpr = restN > 0 ? restSpend / restN : null
    let tag: BRowOut["tag"] = null, note: string | null = null
    if (r.results === 0 && restCpr && r.spend >= 3 * restCpr) { tag = "dat_ro"; note = t("libcase.r.tr.b.zero", { sp: vnd(r.spend), word, rest: vnd(restCpr) }) }
    else if (cpr && restCpr && r.results >= MIN_COUNT && restN >= MIN_COUNT) {
      const j = judgeRatio(cpr, restCpr, r.results, restN, true)
      if (j === "real_worse") { tag = "dat_ro"; note = t("libcase.r.tr.b.worse", { cpr: vnd(cpr), word, rest: vnd(restCpr) }) }
      if (j === "real_better") { tag = "re_ro"; note = t("libcase.r.tr.b.better", { cpr: vnd(cpr), word, rest: vnd(restCpr) }) }
    }
    return { ...r, share: totalSpend > 0 ? r.spend / totalSpend : 0, costPerResult: cpr, ctr: r.impressions > 0 ? r.clicks / r.impressions : null, tag, note }
  }).sort((a, b) => b.spend - a.spend)
  return { dim, title, kind, rows, totalSpend, totalResults }
}

export const GENDER_VI: Record<string, string> = { male: "Nam", female: "Nữ", unknown: "Không rõ" }
export const DEVICE_VI: Record<string, string> = { MOBILE: "Điện thoại", DESKTOP: "Máy tính", TABLET: "Máy tính bảng", CONNECTED_TV: "TV", OTHER: "Khác" }
/** Giờ (0–23) → khung 4 tiếng — gộp để mỗi khung đủ số. */
export const hourBlock = (h: number): { key: string; label: string } => { const s = Math.floor(h / 4) * 4; return { key: `h${String(s).padStart(2, "0")}`, label: `${s}h–${s + 4}h` } }

/** Cộng dồn theo khoá — HÀM THUẦN. */
export function sumBy(rows: (BRow & { key: string })[]): BRow[] {
  const m = new Map<string, BRow>()
  for (const r of rows) {
    const x = m.get(r.key) ?? { key: r.key, label: r.label, spend: 0, impressions: 0, clicks: 0, results: 0 }
    x.spend += r.spend; x.impressions += r.impressions; x.clicks += r.clicks; x.results += r.results
    m.set(r.key, x)
  }
  return [...m.values()]
}

export const genderLabel = (k: string, t: TFunction = makeT("vi")): string => (k in GENDER_VI ? t(`libcase.r.tr.gender.${k}` as never) : k)
export const deviceLabel = (k: string, t: TFunction = makeT("vi")): string => (k in DEVICE_VI ? t(`libcase.r.tr.device.${k}` as never) : k)

/** Vẽ lại một bảng tách (đã đệm bằng tiếng Việt) theo ngôn ngữ: tiêu đề, nhãn giới tính/thiết bị, ghi chú dòng.
 *  Nhãn "Vị trí hiển thị" (từ lib/case/meta-placements) giữ nguyên. Dựng lại từ số liệu nên không dịch chuỗi. */
export function localizeTable(tb: BTable, t: TFunction): BTable {
  const m = /^(meta|google)_(age|gender|placement|device|hour)_(sales|leads)$/.exec(tb.dim)
  if (!m) return tb
  const [, plat, what, kind] = m
  const title = t(plat === "meta" ? "libcase.r.tr.t.meta" : "libcase.r.tr.t.google", { what: t(`libcase.r.tr.t.${what}` as never), kind: t(`libcase.r.tr.kind.${kind}` as never) })
  const input: BRow[] = tb.rows.map((r) => ({ key: r.key, label: what === "gender" ? genderLabel(r.key, t) : what === "device" ? deviceLabel(r.key, t) : r.label, spend: r.spend, impressions: r.impressions, clicks: r.clicks, results: r.results }))
  const out = buildTable(tb.dim, title, tb.kind, input, t)
  if (what === "hour") out.rows.sort((a, b) => a.key.localeCompare(b.key))
  return out
}
