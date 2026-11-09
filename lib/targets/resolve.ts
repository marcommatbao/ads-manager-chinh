// ============================================================
// Đợt 23 (3a) — MỘT nguồn ngưỡng cho mọi nơi chấm chiến dịch
// ============================================================
// Nguồn chuẩn = mục tiêu ở Xử lý chiến dịch → Mục tiêu (data/case-targets.json, lib/case/targets.ts), theo (công ty, nhóm sản
// phẩm), nhóm không có thì lấy dòng "Mặc định". Nơi nào CHƯA có mục tiêu ở đây → dùng `fallback` = ngưỡng cũ của chính nơi đó
// (cảnh báo / NBA / tấm Phân tích / Improvements) để bản Mắt Bão giữ NGUYÊN con số cho tới khi chủ sản phẩm nhập mục tiêu mới.
//   sales (bán hàng): basis cpa | roas, target, ceiling của dòng.
//   leads (thu lead): cplTarget / cplCeiling của dòng (basis "cpl").

import { listTargets, type TargetRow } from "@/lib/case/targets"
import { productGroupOf, type ProductGroup } from "@/lib/case/product"
import { getCplThresholds } from "@/lib/cpl-calculator"

export type GoalKind = "sales" | "leads"
export type ResolvedBasis = "cpa" | "roas" | "cpl"
export interface ResolvedTarget {
  basis: ResolvedBasis
  /** cpa / cpl: chi phí mỗi kết quả MUỐN đạt · roas: ROAS muốn đạt */
  target: number
  /** cpa / cpl: chi phí mỗi kết quả TỐI ĐA · roas: ROAS tối thiểu */
  ceiling: number
  group: ProductGroup
  /** case_target = mục tiêu bán hàng · case_target_cpl = CPL thu lead · còn lại = nguồn cũ của nơi gọi */
  source: string
}
export interface ResolveInput {
  company: string
  campaignName: string
  goalKind: GoalKind
  /** Ngưỡng cũ của nơi gọi khi chưa có mục tiêu — giữ nguyên hành vi hiện tại. */
  fallback?: { basis?: ResolvedBasis; target: number; ceiling: number; source: string } | null
}

/** HÀM THUẦN — test được với danh sách dòng bất kỳ. */
export function resolveFrom(rows: TargetRow[], input: ResolveInput): ResolvedTarget | null {
  const group = productGroupOf(input.campaignName)
  const mine = rows.filter((r) => r.company === input.company)
  const pick = (ok: (r: TargetRow) => boolean) => mine.find((r) => r.group === group && ok(r)) ?? mine.find((r) => r.group === "DEFAULT" && ok(r))
  if (input.goalKind === "leads") {
    const r = pick((x) => Number(x.cplTarget) > 0 && Number(x.cplCeiling) > 0)
    if (r) return { basis: "cpl", target: Number(r.cplTarget), ceiling: Number(r.cplCeiling), group, source: "case_target_cpl" }
  } else {
    const r = pick((x) => Number(x.target) > 0 && Number(x.ceiling) > 0)
    if (r) return { basis: r.basis, target: Number(r.target), ceiling: Number(r.ceiling), group, source: "case_target" }
  }
  const f = input.fallback
  if (f && f.target > 0 && f.ceiling > 0) return { basis: f.basis ?? (input.goalKind === "leads" ? "cpl" : "cpa"), target: f.target, ceiling: f.ceiling, group, source: f.source }
  return null
}

export function resolveTarget(input: ResolveInput): ResolvedTarget | null {
  return resolveFrom(listTargets(), input)
}

/** Mức theo ngưỡng chi phí (cpa / cpl): ≤ target tốt · ≤ ceiling theo dõi · > ceiling đỏ. */
export function costLevel(cost: number, t: Pick<ResolvedTarget, "target" | "ceiling">): "good" | "warning" | "critical" {
  return cost <= t.target ? "good" : cost <= t.ceiling ? "warning" : "critical"
}

/** Chi phí MỖI LEAD mục tiêu cho các nơi chỉ cần MỘT con số (Improvements…): mục tiêu CPL ở Xử lý chiến dịch → Mục tiêu nếu
 *  đã nhập; chưa → `legacy` (ngưỡng cũ của nơi gọi, vd getCPLTarget từ CPL_TARGETS_JSON) — giữ nguyên số. */
export function leadCostTarget(company: string | null | undefined, campaignName: string, legacy: number): number {
  if (!company) return legacy
  const t = resolveTarget({ company, campaignName, goalKind: "leads" })
  return t && t.source === "case_target_cpl" ? t.target : legacy
}

/** Đợt 23 (3d): mục tiêu CPL cho tổng quan / phiên của chiến dịch thu lead. CPL ở Xử lý chiến dịch → Mục tiêu nếu đã nhập;
 *  chưa → ngưỡng cũ của bộ tính CPL (tốt / cảnh báo — như NBA đang dùng); công ty không có ngưỡng cũ (bản cài khách) → null. */
export function leadCaseTarget(company: string, campaignName: string): { basis: "cpl"; target: number; ceiling: number; source: string } | null {
  const old = getCplThresholds()[company]
  const t = resolveTarget({ company, campaignName, goalKind: "leads", fallback: old ? { target: old.good, ceiling: old.warning, source: "cpl_calculator" } : null })
  return t ? { basis: "cpl", target: t.target, ceiling: t.ceiling, source: t.source } : null
}
