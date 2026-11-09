// ============================================================
// Đợt 23 (3d) — chiến dịch BÁN HÀNG hay THU LEAD — HÀM THUẦN, dùng được ở trình duyệt (chỉ import type)
// ============================================================
// Meta: theo mục tiêu chiến dịch (OUTCOME_LEADS / LEAD_GENERATION).
// Google: theo hạng mục chuyển đổi chiến dịch ĐANG ĐẶT GIÁ — không có Mua hàng mà có hạng mục lead → thu lead.
// Suy từ bằng chứng đã lưu nên phiên cũ (bán hàng) không cần di chuyển dữ liệu.
import type { CaseEvidence } from "./types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type GoalKind = "sales" | "leads"

export const META_SALES_OBJECTIVES = new Set(["OUTCOME_SALES", "CONVERSIONS", "PRODUCT_CATALOG_SALES"])
export const META_LEAD_OBJECTIVES = new Set(["OUTCOME_LEADS", "LEAD_GENERATION"])
/** Thứ tự ưu tiên — "lead" là số gộp (form trên Meta + pixel); omni/pixel là cùng sự kiện, KHÔNG cộng (xem pickAction). */
export const META_LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]
/** Hạng mục chuyển đổi Google tính là "lead". */
export const GOOGLE_LEAD_CATEGORIES = new Set(["SUBMIT_LEAD_FORM", "CONTACT", "PHONE_CALL_LEAD", "IMPORTED_LEAD", "QUALIFIED_LEAD", "CONVERTED_LEAD", "BOOK_APPOINTMENT", "REQUEST_QUOTE", "SIGNUP"])

export function metaGoalKind(objective: string | null | undefined): GoalKind {
  return META_LEAD_OBJECTIVES.has(String(objective ?? "")) ? "leads" : "sales"
}
export function googleGoalKind(biddableCategories: string[] | null | undefined): GoalKind {
  const cats = biddableCategories ?? []
  return !cats.includes("PURCHASE") && cats.some((c) => GOOGLE_LEAD_CATEGORIES.has(c)) ? "leads" : "sales"
}
export function evidenceGoalKind(ev: CaseEvidence | null | undefined): GoalKind {
  if (!ev) return "sales"
  return ev.kind === "meta" ? metaGoalKind(ev.campaign.objective) : googleGoalKind(ev.biddableCategories)
}
/** Kết quả Meta theo loại chiến dịch: lượt mua hoặc lead (phiên cũ chưa có `leads` → 0). */
export function metaResults(x: { purchases: number; leads?: number }, kind: GoalKind): number {
  return kind === "leads" ? x.leads ?? 0 : x.purchases
}
/** Nhóm quảng cáo đã tối ưu theo lead: sự kiện Lead của pixel, hoặc form trên Meta (LEAD_GENERATION / QUALITY_LEAD). */
export function isLeadOptimized(a: { optEvent: { type: string }; optimizationGoal: string }): boolean {
  return a.optEvent.type === "LEAD" || a.optimizationGoal === "LEAD_GENERATION" || a.optimizationGoal === "QUALITY_LEAD"
}
/** Nhóm dùng form trên Meta — nhóm mới phải chọn form nên tool không tự dựng. */
export function isInstantForm(a: { optimizationGoal: string }): boolean {
  return a.optimizationGoal === "LEAD_GENERATION" || a.optimizationGoal === "QUALITY_LEAD"
}
/** Từ gọi một kết quả trong câu ("0 đơn", "₫X/lead"). */
export const RESULT_WORD: Record<GoalKind, string> = { sales: "đơn", leads: "lead" }

/** Từ chỉ kết quả theo ngôn ngữ (RESULT_WORD giữ bản tiếng Việt). */
export const resultWord = (kind: GoalKind, t: TFunction = makeT("vi")): string => t(`libcase.c.result.${kind}` as never)
