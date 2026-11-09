// ============================================================
// Giá trị gửi Meta khi TẠO chiến dịch / đổi giới tính — hàm thuần, test được (route Next không xuất thêm hàm được).
// Task #7099 (26/10/2026): đối chiếu changelog Marketing API v22–v26.
// ============================================================

/** Meta: `targeting.genders` là mảng SỐ — 1 = Nam, 2 = Nữ. Không khai = mọi giới tính. */
export function metaGenderIds(gender: "male" | "female"): number[] {
  return gender === "female" ? [2] : [1]
}

export interface CampaignParamsInput {
  name: string
  objective: string
  status: "ACTIVE" | "PAUSED"
  budgetType?: string
  dailyBudget: number
  bidStrategy?: string
}

/**
 * Thân lệnh POST act_X/campaigns.
 * - Ngân sách chiến dịch (CBO): daily_budget (VND không nhân 100) + bid_strategy.
 * - Ngân sách nhóm (ABO): từ Marketing API v24 chiến dịch PHẢI khai is_adset_budget_sharing_enabled (thiếu → #100
 *   sub 4834011, đo 26/10/2026). User chốt 26/10 (task #7100): true — Meta khuyên, các nhóm được chia cho nhau tối đa
 *   20% ngân sách để tối ưu tổng thể (một nhóm có thể tiêu hơn số đặt, nhóm khác ít hơn).
 */
export function buildCampaignParams(c: CampaignParamsInput): Record<string, unknown> {
  const params: Record<string, unknown> = {
    name: c.name,
    objective: c.objective,
    status: c.status,
    special_ad_categories: [],
  }
  if (c.budgetType === "cbo" && c.dailyBudget > 0) {
    params.daily_budget = String(c.dailyBudget)
    params.bid_strategy = c.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP"
  } else {
    params.is_adset_budget_sharing_enabled = true
  }
  return params
}

/** Các trường của nhóm mẫu cần để nhân bản (đọc từ Graph: /{campaign}/adsets?fields=…). */
export interface AdsetTemplate {
  name: string
  daily_budget?: string
  lifetime_budget?: string
  end_time?: string
  optimization_goal?: string
  billing_event?: string
  promoted_object?: Record<string, unknown>
  destination_type?: string
  attribution_spec?: unknown[]
  bid_strategy?: string
  bid_amount?: string | number
}

/**
 * Thân lệnh tạo nhóm "ưu tiên giới tính" nhân bản từ nhóm mẫu (Tự động hoá đối tượng → focus_gender).
 * Trước 26/10/2026 luôn gửi daily_budget cấp nhóm + optimization_goal LINK_CLICKS cố định → chiến dịch CBO bị Meta từ
 * chối hai lần: ngân sách nhóm trong CBO (sub 1885621) và tối ưu khác các nhóm còn lại (sub 1885760, đo 26/10).
 * - Luôn chép tối ưu / sự kiện pixel / đích / ghi nhận của nhóm mẫu.
 * - Chiến dịch CBO (`campaignHasBudget`): KHÔNG ngân sách, KHÔNG chiến lược giá thầu ở nhóm (Meta phân bổ ở chiến dịch).
 * - Chiến dịch ABO: ngân sách = ngân sách nhóm mẫu × budgetRatio; giữ chiến lược + giá thầu của nhóm mẫu.
 * `targeting` truyền vào phải đã qua writableTargeting.
 */
export function buildGenderCloneBody(
  t: AdsetTemplate,
  o: { campaignId: string; campaignHasBudget: boolean; targeting: Record<string, unknown>; genderLabel: string; budgetRatio: number },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    campaign_id: o.campaignId,
    name: `${t.name} — ${o.genderLabel} ưu tiên`,
    status: "PAUSED",
    targeting: o.targeting,
    optimization_goal: t.optimization_goal ?? "LINK_CLICKS",
    billing_event: t.billing_event ?? "IMPRESSIONS",
  }
  if (t.promoted_object) body.promoted_object = t.promoted_object
  if (t.destination_type) body.destination_type = t.destination_type
  if (t.attribution_spec) body.attribution_spec = t.attribution_spec
  if (o.campaignHasBudget) return body

  const daily = Number(t.daily_budget) || 0
  const lifetime = Number(t.lifetime_budget) || 0
  if (daily > 0) body.daily_budget = String(Math.round(daily * o.budgetRatio))
  else if (lifetime > 0 && t.end_time) {
    body.lifetime_budget = String(Math.round(lifetime * o.budgetRatio))
    body.end_time = t.end_time
  } else throw new Error("Nhóm mẫu không có ngân sách riêng (chiến dịch ABO) — không biết đặt ngân sách cho nhóm mới")
  body.bid_strategy = t.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP"
  if (t.bid_amount !== undefined && body.bid_strategy !== "LOWEST_COST_WITHOUT_CAP") body.bid_amount = t.bid_amount
  return body
}
