import { STANDARD_PIXEL_EVENTS, normalizeStandardEvent } from "@/lib/meta-pixel-events";

// Maps a Meta ad set's optimization_goal / promoted_object.custom_event_type
// to the `actions[].action_type` slug(s) that event actually reports under
// in the Insights API — i.e. what Ads Manager's own "Kết quả"/CPL column is
// counting for that specific campaign. Many callers in this codebase
// previously hardcoded action_type === "purchase" for every campaign
// regardless of what it's actually optimizing for, which silently produces
// a wrong "Kết quả" count (and therefore wrong CPL) whenever a campaign
// optimizes for something else (add_payment_info, lead, complete_registration,
// etc.) — confirmed live 2026-07-30: "MBC - VIBE HOSTING - 27/7/2026" opt-
// imizes for ADD_PAYMENT_INFO (11 results, CPL 35.395đ in Ads Manager) but
// the old purchase-only filter picked up an unrelated 17 "purchase" events,
// showing CPL 22.903đ instead.
//
// Standard Meta pixel event taxonomy (Marketing API v19) — not account-
// specific, so safe to hardcode without live-verifying every branch.

// Bảng tra này TỪNG được gõ tay ở đây và đã lệch enum thật của Meta:
// khoá "VIEW_CONTENT" và "INITIATE_CHECKOUT" không bao giờ khớp, vì Meta trả
// về "CONTENT_VIEW" / "INITIATED_CHECKOUT" — nên một chiến dịch tối ưu Xem
// nội dung rơi thẳng vào nhánh fallback purchase bên dưới và bị đếm kết quả
// bằng số lượt MUA của chiến dịch khác. Nay dựng từ danh mục chung ở
// lib/meta-pixel-events.ts để không thể lệch thêm lần nữa.
const CUSTOM_EVENT_ACTION_TYPE: Record<string, string[]> = Object.fromEntries(
  STANDARD_PIXEL_EVENTS.map((e) => [e.enumValue, e.actionTypes])
);

// Fallback when the ad set has no promoted_object (native on-platform goals).
const OPTIMIZATION_GOAL_ACTION_TYPE: Record<string, string[]> = {
  LEAD_GENERATION: ["lead", "onsite_conversion.lead_grouped"],
  LINK_CLICKS: ["link_click"],
  LANDING_PAGE_VIEWS: ["landing_page_view"],
};

export interface AdSetGoalInfo {
  optimization_goal?: string;
  custom_event_type?: string;
}

/**
 * Resolves which `actions[].action_type` slug(s) match what a campaign is
 * actually optimizing for. Falls back to the legacy purchase-only guess
 * when the goal isn't one we have a confirmed mapping for (e.g. LINK_CLICKS/
 * REACH campaigns where a "purchase-style" CPL isn't really meaningful
 * anyway — same behavior as before for those).
 */
export function resolveConversionActionTypes(goal?: AdSetGoalInfo): string[] {
  // normalizeStandardEvent() nhận cả enum đúng lẫn các biến thể cũ từng lưu
  // trong bản nháp/chiến dịch cũ, nên chiến dịch tạo trước bản sửa vẫn đếm đúng.
  const customEventType = normalizeStandardEvent(goal?.custom_event_type);
  if (customEventType && CUSTOM_EVENT_ACTION_TYPE[customEventType]) {
    return CUSTOM_EVENT_ACTION_TYPE[customEventType];
  }
  const optimizationGoal = goal?.optimization_goal;
  if (optimizationGoal && OPTIMIZATION_GOAL_ACTION_TYPE[optimizationGoal]) {
    return OPTIMIZATION_GOAL_ACTION_TYPE[optimizationGoal];
  }
  return ["omni_purchase", "purchase"];
}

/** Builds campaign_id → first ad set's goal info (campaigns are assumed single-goal, matching Meta's own UI). */
export function buildGoalByCampaignMap<T extends { campaign_id: string; optimization_goal?: string; promoted_object?: { custom_event_type?: string } }>(
  adSetGoals: T[]
): Map<string, AdSetGoalInfo> {
  const map = new Map<string, AdSetGoalInfo>();
  for (const as of adSetGoals) {
    if (map.has(as.campaign_id)) continue;
    map.set(as.campaign_id, {
      optimization_goal: as.optimization_goal,
      custom_event_type: as.promoted_object?.custom_event_type,
    });
  }
  return map;
}

/** Cộng số kết quả từ `actions[]` theo ĐÚNG một loại hành động.
 *
 *  Vì sao không lọc rồi cộng cả mảng: mảng trả về từ
 *  resolveConversionActionTypes() là DANH SÁCH ƯU TIÊN, không phải tập hợp
 *  để cộng dồn. `omni_purchase` là TẬP CHA của `purchase` trong taxonomy của
 *  Meta — cùng một lượt mua xuất hiện ở cả hai dòng, nên cộng cả hai là nhân
 *  đôi. Luật này đã được ghi rõ ở app/api/cpl/route.ts ("summing it together
 *  with 'purchase' double-counts the same conversion event") và
 *  app/api/attribution/route.ts ("bỏ omni_purchase để không đếm trùng"),
 *  nhưng hai chỗ đọc mảng này lại cộng cả mảng — nên "Kết quả" và CPL bị sai
 *  gấp đôi ở /campaigns (bảng chiến dịch) và ở bảng so sánh creative.
 *
 *  Lấy loại ĐẦU TIÊN CÓ MẶT thay vì luôn lấy phần tử [0]: tài khoản nào Meta
 *  không trả `omni_purchase` thì vẫn còn `purchase` để dùng, không mất số. */
export function sumConversionActions(
  actions: Array<{ action_type: string; value: string }> | null | undefined,
  actionTypes: string[],
): number {
  if (!actions?.length) return 0;
  for (const type of actionTypes) {
    const rows = actions.filter((a) => a.action_type === type);
    if (rows.length > 0) {
      return rows.reduce((sum, a) => sum + Number(a.value || 0), 0);
    }
  }
  return 0;
}

/** "Giá trị kết quả" (như cột Ads Manager): cộng `action_values[]` theo ĐÚNG loại kết quả mà cột "Kết quả" đang đếm
 *  (cùng danh sách ưu tiên, cùng luật lấy loại đầu tiên có mặt — omni_purchase/purchase không cộng đôi).
 *  null = Meta không trả giá trị cho loại đó (vd chiến dịch tối ưu click, khách tiềm năng không gắn giá trị) → giao diện
 *  hiện "—" như Ads Manager, KHÔNG hiện 0. */
export function sumConversionValues(
  actionValues: Array<{ action_type: string; value: string }> | null | undefined,
  actionTypes: string[],
): number | null {
  if (!actionValues?.length) return null;
  for (const type of actionTypes) {
    const rows = actionValues.filter((a) => a.action_type === type);
    if (rows.length > 0) return rows.reduce((sum, a) => sum + Number(a.value || 0), 0);
  }
  return null;
}
