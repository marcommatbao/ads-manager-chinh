// ============================================================
// Chữ hiển thị riêng cho Facebook/Meta — dùng chung giữa các trang
// ------------------------------------------------------------
// KHÔNG đặt trong lib/case/ (thư mục backend đã khoá, xem AGENTS.md của phần
// việc này) — đây chỉ là nhãn hiển thị, không phải nghiệp vụ.
// ============================================================

import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

/** Mục tiêu chiến dịch Meta (campaign.objective) → tiếng Việt. Không có trong bảng → giữ nguyên chuỗi gốc. */
export const META_OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_SALES: "Bán hàng",
  OUTCOME_LEADS: "Khách hàng tiềm năng",
  OUTCOME_ENGAGEMENT: "Tương tác",
  OUTCOME_AWARENESS: "Nhận diện",
  OUTCOME_TRAFFIC: "Lưu lượng truy cập",
  OUTCOME_APP_PROMOTION: "Quảng bá ứng dụng",
  CONVERSIONS: "Chuyển đổi",
  PRODUCT_CATALOG_SALES: "Bán hàng theo danh mục",
  LINK_CLICKS: "Lượt click liên kết",
  REACH: "Số người tiếp cận",
  BRAND_AWARENESS: "Nhận diện thương hiệu",
  VIDEO_VIEWS: "Lượt xem video",
  MESSAGES: "Tin nhắn",
};

/** `t` (tuỳ chọn, useT()) → nhãn theo ngôn ngữ; không truyền → tiếng Việt như cũ. */
export const metaObjectiveLabel = (objective: string, t?: TFunction): string =>
  t && objective in META_OBJECTIVE_LABEL
    ? t(`common.meta.objective.${objective}` as MessageKey)
    : META_OBJECTIVE_LABEL[objective] ?? objective;

/** Nhãn trạng thái học của nhóm quảng cáo (learning_stage_info.status). */
export const META_LEARNING_LABEL: Record<string, string> = {
  LEARNING: "Đang học",
  SUCCESS: "Học xong",
  FAIL: "Học thất bại ✕",
};

/** Thứ tự + nhãn sự kiện phễu dùng cho danh sách eventsPerWeek ở Bước 2. */
export const META_EVENT_ORDER = [
  "purchase", "add_payment_info", "initiate_checkout", "add_to_cart",
  "complete_registration", "lead", "custom", "landing_page_view",
] as const;

export const META_EVENT_LABEL: Record<string, string> = {
  purchase: "Mua hàng",
  add_payment_info: "Thêm thông tin thanh toán (chuẩn)",
  initiate_checkout: "Bắt đầu thanh toán",
  add_to_cart: "Thêm vào giỏ",
  complete_registration: "Hoàn tất đăng ký",
  lead: "Khách hàng tiềm năng",
  custom: "Sự kiện tự đặt (gộp)",
  landing_page_view: "Xem trang đích",
};

export const metaLearningLabel = (status: string, t?: TFunction): string | undefined =>
  t && status in META_LEARNING_LABEL ? t(`common.meta.learning.${status}` as MessageKey) : META_LEARNING_LABEL[status];

export const metaEventLabel = (event: string, t?: TFunction): string | undefined =>
  t && event in META_EVENT_LABEL ? t(`common.meta.event.${event}` as MessageKey) : META_EVENT_LABEL[event];
