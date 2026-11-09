import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// Đợt 14e — Danh sách bấm thử trên PRODUCTION (user tự bấm: từ workspace không vào được app production — IP chặn)
// ============================================================
// Mỗi mục: đường dẫn, bấm gì, KẾT QUẢ MONG ĐỢI. Không mục nào ghi lên tài khoản quảng cáo (chỉ Kiểm trước / Huỷ). Module THUẦN
// (client import được). Cập nhật khi có tính năng mới.
export interface CheckItem { id: string; area: string; href: string; steps: string; expect: string }
export const PROD_CHECKLIST: CheckItem[] = [
  { id: "health", area: "Sức khoẻ tool", href: "/settings/health", steps: "Bấm \"Gửi thử cảnh báo\".", expect: "Teams kênh IT nhận thẻ \"Thẻ thử\" trong 1 phút; bảng job không có dòng \"Lỡ lịch\"." },
  { id: "overview", area: "Tổng quan", href: "/", steps: "Chọn 7 ngày gần nhất, so chi Google + Meta với Google Ads / Ads Manager cùng khoảng.", expect: "Lệch ≤ 5% (tool cũng tự đối chiếu mỗi thứ Hai)." },
  { id: "search_xray", area: "Google Search → X-quang", href: "/google-search?tab=xray", steps: "Mở; bấm \"Tách lượt tìm chung…\" ở thẻ chiến dịch Brand; bấm Kiểm trước.", expect: "Có mục Đánh giá & lộ trình; Kiểm trước báo \"qua\" (chưa tạo gì). Đóng hộp, KHÔNG bấm Tạo." },
  { id: "search_guard", area: "Google Search → Cụm tìm kiếm", href: "/google-search?tab=terms", steps: "Chọn 1 cụm → \"Thêm từ khoá\".", expect: "Hiện hộp bắt gõ XAC NHAN (không ghi thẳng). Bấm Huỷ." },
  { id: "pmax_xray", area: "PMax Insights → X-quang", href: "/google-pmax?tab=xray", steps: "Bấm Kiểm trước ở một thẻ Việc nên làm.", expect: "Kiểm trước qua, không có lỗi đỏ." },
  { id: "pmax_exp", area: "PMax Insights → Thí nghiệm", href: "/google-pmax?tab=experiment", steps: "Xem thẻ thí nghiệm đang chạy; bấm \"Đo lại\".", expect: "Thí nghiệm Hà Nội đang chạy (bật 29/09, 6 tuần → kết thúc dự kiến 15/11); đo lại ra \"chưa đủ tuần\" cho tới khi qua 2 tuần trọn." },
  { id: "pmax_assets", area: "PMax Insights → Asset", href: "/google-pmax?tab=assets", steps: "Tích 1 dòng yếu → \"Viết bản thay (Gemini)\".", expect: "Có 1–3 phương án tiếng Việt kèm số ký tự. Không bấm Áp dụng." },
  { id: "meta_xray", area: "Meta X-quang", href: "/meta-xray", steps: "Mở trang (tốn 2 lượt gọi Meta).", expect: "Có số Từ lượt bấm / Chỉ xem / GA4; bảng chiến dịch có cờ đỏ ở chiến dịch chỉ-xem." },
  { id: "meta_case", area: "Meta → Mở phiên xử lý", href: "/meta-xray", steps: "Bấm \"Mở phiên xử lý\" ở việc P1 → đi hết bước tới Kiểm trước.", expect: "Phiên có nguyên nhân \"… chỉ xem\" và việc \"Tạo nhóm mới … CHỈ tính lượt bấm 7 ngày\"; Kiểm trước qua. KHÔNG ghi." },
  { id: "adsbot", area: "AdsBot", href: "/", steps: "Hỏi: \"PMax có tạo đơn thật không, thí nghiệm đang ra sao?\"", expect: "Trả lời có số (không trả rỗng), nhắc thí nghiệm Hà Nội." },
  { id: "mornings", area: "Báo sáng (Teams)", href: "/settings/health", steps: "Sáng hôm sau kiểm kênh Teams IT.", expect: "08:00 thẻ đường lead form ↔ CRM; 08:05 thẻ báo sáng hệ thống. Thiếu thẻ nào = báo lại." },
]

/** Danh sách theo ngôn ngữ (PROD_CHECKLIST giữ tiếng Việt). */
export function prodChecklist(t: TFunction = makeT("vi")): CheckItem[] {
  return PROD_CHECKLIST.map((c) => ({ ...c, area: t(`libcase.r.pc.${c.id}.area` as never), steps: t(`libcase.r.pc.${c.id}.steps` as never), expect: t(`libcase.r.pc.${c.id}.expect` as never) }))
}
