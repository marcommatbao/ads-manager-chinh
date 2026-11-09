// ============================================================
// Chấm một chiến dịch so với mục tiêu + trần của sản phẩm
// ============================================================
// Hai cách chấm (chốt với user 25/09):
//   - "cpa":  MBI — chi phí/đơn. Mục tiêu = 50% giá trị đơn, trần do user đặt.
//   - "roas": MBC — doanh thu/chi phí. Mục tiêu 5, trần 3 (dưới 3 là đỏ).
// Xếp hạng theo "chi vượt trần" = số tiền đã chi vượt mức lẽ ra được chi:
//   cpa:  chi phí − trần × số đơn
//   roas: chi phí − doanh thu ÷ ROAS trần
// 0 đơn mà chưa chi đủ để kết luận → "chưa đủ dữ liệu", KHÔNG đánh đỏ vội.

import { makeT, type TFunction } from "@/lib/i18n/translate"

export type TargetBasis = "cpa" | "roas"
/** Đợt 23 (3d): "cpl" = chi phí mỗi lead — chỉ cho phiên chiến dịch thu lead (dòng mục tiêu lưu CPL ở cplTarget/cplCeiling). */
export type CaseBasis = TargetBasis | "cpl"

export interface CaseTarget {
  basis: CaseBasis
  /** cpa: VND/đơn muốn đạt · roas: ROAS muốn đạt */
  target: number
  /** cpa: VND/đơn tối đa · roas: ROAS tối thiểu */
  ceiling: number
}

export interface CampaignPerf {
  cost: number
  clicks: number
  /** Đơn mua = chuyển đổi dùng để đặt giá (Mua hàng), KHÔNG phải all_conversions. */
  orders: number
  orderValue: number
}

export type VerdictStatus = "red" | "amber" | "green" | "grey" | "no_target"

export interface Verdict {
  status: VerdictStatus
  /** VND đã chi vượt trần; null khi không vượt hoặc chưa kết luận được. */
  overCeiling: number | null
  cpa: number | null
  roas: number | null
  label: string
  /** Cờ phụ, ví dụ tỉ lệ click→đơn cao bất thường (nghi đếm sai chuyển đổi). */
  flags: string[]
}

/** Click→đơn trên mức này hiếm khi thật với sản phẩm B2B — nghi đo lường. Đo 25/09: Workspace MBC 21%. */
export const SUSPICIOUS_CVR = 0.15
/** cpa/cpl: 0 đơn/lead chỉ đánh ĐỎ (và đề xuất dừng nhóm) khi đã chi ≥ hệ số này × trần — 07/10 chủ tool duyệt 1× → 2×.
 *  Nếu chi phí thật đúng bằng trần, chi 1× trần mà 0 kết quả vẫn xảy ra ~37% do may rủi (e^-1); 2× còn ~13,5% (e^-2).
 *  Từ 1× đến dưới 2×: VÀNG "đáng lo, chưa đủ kết luận". */
export const ZERO_RESULT_SPEND_MULT = 2
/** roas: 0 đơn chỉ kết luận khi đã chi ít nhất mức này. */
export const ROAS_MIN_SPEND_TO_JUDGE = 1_000_000

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`
const times = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })

export function verdictOf(p: CampaignPerf, tg: CaseTarget | null, t: TFunction = makeT("vi")): Verdict {
  const cpa = p.orders > 0 ? p.cost / p.orders : null
  const roas = p.cost > 0 ? p.orderValue / p.cost : null
  const flags: string[] = []
  // Click → lead > 15% là bình thường với form trên Meta — cờ "nghi đếm sai" chỉ cho đơn mua.
  if (tg?.basis !== "cpl" && p.clicks >= 50 && p.orders / p.clicks > SUSPICIOUS_CVR) {
    flags.push(t("libcase.s.verdict.cvrFlag", { pct: Math.round((p.orders / p.clicks) * 100) }))
  }
  const base = { cpa, roas, flags }

  if (!tg) return { ...base, status: "no_target", overCeiling: null, label: t("libcase.s.verdict.noTarget") }

  if (tg.basis === "cpa" || tg.basis === "cpl") {
    const w = tg.basis === "cpl" ? t("libcase.s.word.lead") : t("libcase.s.word.order")
    if (p.orders === 0) {
      if (p.cost >= tg.ceiling * ZERO_RESULT_SPEND_MULT) {
        return { ...base, status: "red", overCeiling: p.cost, label: t("libcase.s.verdict.zeroRed", { w, x: times(p.cost / tg.ceiling) }) }
      }
      if (p.cost >= tg.ceiling) {
        return { ...base, status: "amber", overCeiling: null, label: t("libcase.s.verdict.zeroAmber", { w, x: times(p.cost / tg.ceiling), n: ZERO_RESULT_SPEND_MULT }) }
      }
      return { ...base, status: "grey", overCeiling: null, label: t("libcase.s.verdict.notEnoughSpent", { x: times(p.cost / tg.ceiling) }) }
    }
    const over = p.cost - tg.ceiling * p.orders
    if (over > 0) return { ...base, status: "red", overCeiling: over, label: t("libcase.s.verdict.overCeil", { c: vnd(tg.ceiling), w }) }
    if (cpa! > tg.target) return { ...base, status: "amber", overCeiling: null, label: t("libcase.s.verdict.aboveTarget") }
    return { ...base, status: "green", overCeiling: null, label: t("libcase.s.verdict.onTarget") }
  }

  // roas
  if (p.orders === 0 || p.orderValue <= 0) {
    if (p.cost >= ROAS_MIN_SPEND_TO_JUDGE) {
      return { ...base, status: "red", overCeiling: p.cost, label: t("libcase.s.verdict.noRevenue") }
    }
    return { ...base, status: "grey", overCeiling: null, label: t("libcase.s.verdict.notEnough") }
  }
  const over = p.cost - p.orderValue / tg.ceiling
  if (over > 0) return { ...base, status: "red", overCeiling: over, label: t("libcase.s.verdict.roasBelow", { c: tg.ceiling }) }
  if (roas! < tg.target) return { ...base, status: "amber", overCeiling: null, label: t("libcase.s.verdict.belowTarget") }
  return { ...base, status: "green", overCeiling: null, label: t("libcase.s.verdict.onTarget") }
}

/** Thứ tự bảng tổng quan: đỏ theo tiền vượt trần giảm dần → vàng → xám → xanh → chưa đặt mục tiêu. */
export function compareVerdicts(a: { verdict: Verdict; perf: CampaignPerf }, b: { verdict: Verdict; perf: CampaignPerf }): number {
  const rank: Record<VerdictStatus, number> = { red: 0, amber: 1, grey: 2, green: 3, no_target: 4 }
  const r = rank[a.verdict.status] - rank[b.verdict.status]
  if (r !== 0) return r
  if (a.verdict.status === "red") return (b.verdict.overCeiling ?? 0) - (a.verdict.overCeiling ?? 0)
  return b.perf.cost - a.perf.cost
}
