// ============================================================
// NBA — Reason code registry (v2)
// reasonCode → category, recommendationType, default action mode,
// executor, link, destructive flag, action/outcome templates.
// Guards có thể HẠ cấp actionMode, không bao giờ nâng.
// ============================================================

import type {
  NbaReasonCode,
  NbaCategory,
  NbaActionMode,
  NbaExecutor,
  NbaRecommendationType,
} from "./types";

export interface ReasonCodeMeta {
  category: NbaCategory;
  recommendationType: NbaRecommendationType;
  defaultActionMode: NbaActionMode;
  executor: NbaExecutor;
  internalLink?: string;
  destructive: boolean;
  label: string;
  /** Mẫu hành động khuyến nghị (recommendedAction). */
  actionText: string;
  /** Mẫu kết quả kỳ vọng (expectedOutcome). */
  outcomeText: string;
}

export const REASON_CODES: Record<NbaReasonCode, ReasonCodeMeta> = {
  CPL_CRITICAL: {
    category: "campaign", recommendationType: "REDUCE_CPL",
    defaultActionMode: "manual", executor: "automation-engine", internalLink: "/campaigns",
    destructive: true, label: "CPL vượt ngưỡng đỏ",
    actionText: "Rà soát targeting/creative hoặc giảm bid; nếu xấu kéo dài cân nhắc tạm dừng.",
    outcomeText: "Đưa CPL về vùng an toàn của công ty, giảm chi phí mỗi lead.",
  },
  CPL_WARNING: {
    category: "campaign", recommendationType: "REDUCE_CPL",
    defaultActionMode: "advisory_only", executor: "manual-link", internalLink: "/campaigns",
    destructive: false, label: "CPL ở vùng theo dõi",
    actionText: "Theo dõi thêm, tối ưu nhẹ targeting/creative trước khi can thiệp mạnh.",
    outcomeText: "Ngăn CPL trượt lên vùng đỏ.",
  },
  ZERO_CONV_SPEND: {
    category: "campaign", recommendationType: "PAUSE_WASTE",
    defaultActionMode: "manual", executor: "automation-engine", internalLink: "/campaigns",
    destructive: true, label: "Tiêu tiền không có chuyển đổi",
    actionText: "Tạm dừng hoặc rà soát tracking/targeting để chặn chi phí lãng phí.",
    outcomeText: "Dừng dòng tiền không tạo kết quả.",
  },
  CREATIVE_FATIGUE: {
    category: "creative", recommendationType: "REFRESH_CREATIVE",
    defaultActionMode: "manual", executor: "manual-link", internalLink: "/creative",
    destructive: false, label: "Creative mệt mỏi",
    actionText: "Làm mới nội dung/hình ảnh hoặc đổi creative khác.",
    outcomeText: "Khôi phục CTR, giảm CPM do tần suất cao.",
  },
  SCALE_WINNER: {
    category: "budget", recommendationType: "SCALE_BUDGET",
    defaultActionMode: "auto_apply_eligible", executor: "automation-engine", internalLink: "/campaigns",
    destructive: false, label: "Tăng ngân sách campaign tốt",
    actionText: "Tăng ngân sách ~25% để mở rộng campaign hiệu quả.",
    outcomeText: "Tăng kết quả ở mức ROAS đang tốt.",
  },
  LOW_ROAS_REVIEW: {
    category: "budget", recommendationType: "REVIEW_BUDGET",
    defaultActionMode: "advisory_only", executor: "manual-link", internalLink: "/campaigns",
    destructive: true, label: "ROAS thấp — cần rà soát",
    actionText: "Rà soát trước khi giảm ngân sách (tránh cắt nhầm campaign đang học).",
    outcomeText: "Giảm lãng phí ở campaign dưới hoà vốn.",
  },
  // ── map từ /improvements ──
  FIX_LOW_QS_KEYWORD: {
    category: "keyword", recommendationType: "FIX_KEYWORD",
    defaultActionMode: "manual", executor: "actionExecutor", internalLink: "/toolkit/quality-score",
    destructive: false, label: "Quality Score thấp",
    actionText: "Cải thiện ad relevance / landing page cho keyword QS thấp.",
    outcomeText: "Tăng QS → giảm CPC, tăng vị trí.",
  },
  PAUSE_FB_AD_LOW_CTR: {
    category: "creative", recommendationType: "REFRESH_CREATIVE",
    defaultActionMode: "manual", executor: "manual-link", internalLink: "/creative",
    destructive: true, label: "FB Ad CTR quá thấp",
    actionText: "Tạm dừng ad CTR thấp và thay creative mới.",
    outcomeText: "Tăng CTR trung bình, giảm CPM.",
  },
  DAYPART_OPPORTUNITY: {
    category: "schedule", recommendationType: "ADJUST_SCHEDULE",
    defaultActionMode: "manual", executor: "actionExecutor", internalLink: "/toolkit/dayparting",
    destructive: false, label: "Cơ hội day-parting",
    actionText: "Tắt/giảm bid các khung giờ kém hiệu quả.",
    outcomeText: "Dồn ngân sách vào khung giờ CPL tốt.",
  },
  NEGATIVE_KEYWORD_WASTE: {
    category: "keyword", recommendationType: "FIX_KEYWORD",
    defaultActionMode: "manual", executor: "actionExecutor", internalLink: "/toolkit/ngram",
    destructive: false, label: "Search term lãng phí",
    actionText: "Thêm negative keyword cho các search term không chuyển đổi.",
    outcomeText: "Cắt chi phí cho truy vấn không liên quan.",
  },
  IMPROVEMENT_OTHER: {
    category: "account", recommendationType: "IMPORTED_IMPROVEMENT",
    defaultActionMode: "advisory_only", executor: "manual-link", internalLink: "/improvements",
    destructive: false, label: "Đề xuất tối ưu",
    actionText: "Xem chi tiết tại màn Improvements.",
    outcomeText: "Cải thiện hiệu quả theo gợi ý.",
  },
};
