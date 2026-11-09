// Đợt 10a · D1 — đầu vào luật tự động ngân sách cho PMax (hàm thuần).
// Luật cũ (budget-optimizer) dùng metrics.search_budget_lost_impression_share — chỉ Search có, PMax luôn 0 → PMax
// KHÔNG BAO GIỜ được tăng, chỉ có thể bị giảm. Và CPL tính trên MỌI chuyển đổi: PMax MBC có 96% "đơn" YouTube là
// engaged-view (đo 28/09) → CPL trông rẻ giả. Với PMax: chỉ đếm đơn TỪ LƯỢT BẤM, "giới hạn ngân sách" đọc từ
// campaign.primary_status_reasons (BUDGET_CONSTRAINED), và KHÔNG đụng chiến dịch đang học (BIDDING_STRATEGY_LEARNING).

export interface RuleInputs { conversions: number; budgetLost: number; skip: string | null; note: string }

export function ruleInputs(x: { isPmax: boolean; conversionsAll: number; clickConversions: number | null; statusReasons: string[]; searchBudgetLost: number }): RuleInputs {
  if (!x.isPmax) return { conversions: x.conversionsAll, budgetLost: x.searchBudgetLost, skip: null, note: "" }
  if (x.statusReasons.includes("BIDDING_STRATEGY_LEARNING")) return { conversions: 0, budgetLost: 0, skip: "PMax đang trong giai đoạn học — không đổi ngân sách", note: "" }
  if (x.clickConversions === null) return { conversions: 0, budgetLost: 0, skip: "Không đọc được đơn từ lượt bấm của PMax — bỏ qua lượt này", note: "" }
  return {
    conversions: x.clickConversions,
    // Giới hạn ngân sách thật → coi như mất 25% hiển thị để luật tăng (ngưỡng 10–20%) áp được như Search.
    budgetLost: x.statusReasons.includes("BUDGET_CONSTRAINED") ? 0.25 : 0,
    skip: null,
    note: ` [PMax · tính theo ${Math.round(x.clickConversions * 10) / 10} đơn từ lượt bấm / ${Math.round(x.conversionsAll * 10) / 10} tổng${x.statusReasons.includes("BUDGET_CONSTRAINED") ? " · đang giới hạn ngân sách" : ""}]`,
  }
}
