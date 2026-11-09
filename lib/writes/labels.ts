import { makeT, type TFunction } from "@/lib/i18n/translate"
// Nhãn tiếng Việt cho mã sự kiện decision-memory trên trang "Đã làm & kết quả" — tệp THUẦN, dùng được ở trình duyệt.
export const EVENT_LABEL: Record<string, string> = {
  "budget.increase": "tăng ngân sách", "budget.decrease": "giảm ngân sách", "budget.redistribute": "chia lại ngân sách",
  "budget.cap_set": "đặt trần ngân sách", "budget.cap_removed": "bỏ trần ngân sách",
  "campaign.pause": "tạm dừng chiến dịch", "campaign.resume": "bật lại chiến dịch", "campaign.archive": "lưu trữ chiến dịch",
  "adset.pause": "tạm dừng nhóm quảng cáo", "adset.resume": "bật lại nhóm quảng cáo", "adset.audience_change": "đổi tệp khách",
  "adset.placement_change": "đổi vị trí hiển thị", "adset.schedule_change": "đổi lịch chạy", "adset.bid_strategy_change": "đổi chiến lược giá thầu",
  "creative.pause_fatigued": "tạm dừng mẫu quảng cáo đã mòn", "creative.promote_winner": "đẩy mẫu quảng cáo tốt nhất",
  "automation.rule_applied": "luật tự động đã áp", "automation.sim_approved": "duyệt mô phỏng luật tự động",
  "ab.variant_paused": "tạm dừng biến thể A/B", "nba.recommendation_applied": "áp đề xuất NBA",
}
const CODE = /: ([a-z_]+\.[a-z_]+)(?= — |$)/
/** Đổi mã sự kiện trong nhãn ("Tên: campaign.pause — …") sang tiếng Việt; nhãn khác giữ nguyên (cả bản đã lưu trước đây). */
export function prettyWriteLabel(label: string): string {
  return label.replace(CODE, (m, code: string) => (EVENT_LABEL[code] ? `: ${EVENT_LABEL[code]}` : m))
}

export const eventLabel = (code: string, t: TFunction = makeT("vi")): string => (code in EVENT_LABEL ? t(`libcase.event.${code}` as never) : code)
/** Bản theo ngôn ngữ của prettyWriteLabel. */
export function prettyWriteLabelT(label: string, t: TFunction = makeT("vi")): string {
  return label.replace(CODE, (m, code: string) => (EVENT_LABEL[code] ? `: ${eventLabel(code, t)}` : m))
}
