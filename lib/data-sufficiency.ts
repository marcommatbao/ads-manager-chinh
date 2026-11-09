// ============================================================
// Đợt 23 Bước 2 — "đủ dữ liệu để chấm đỏ chưa?" — MỘT bộ ngưỡng cho cảnh báo / NBA / tấm Phân tích
// ============================================================
// Vì sao: CPL tính từ 1 chuyển đổi, "0 chuyển đổi" sau 50K, chiến dịch mới vài ngày… đều từng bị chấm đỏ → báo nhầm,
// khuyên cắt chiến dịch đúng lúc nó cần được để yên chạy. Chưa đủ dữ liệu thì nói "chưa đủ", không nói "kém".
import { getLearningStatus } from "@/lib/campaign-health"

/** Số chuyển đổi tối thiểu để CPL/CPA có nghĩa (1–2 đơn = may rủi). */
export const MIN_CONV_FOR_CPL = 3
/** "24h không có chuyển đổi": chỉ báo khi đã chi quá mức này trong ngày. */
export const ZERO_CONV_MIN_SPEND_24H = 200_000
/** "Chi tiền mà 0 chuyển đổi" trong kỳ (NBA, mặc định 7 ngày): chi tối thiểu + lượt bấm tối thiểu. */
export const ZERO_CONV_MIN_SPEND_PERIOD = 300_000
export const ZERO_CONV_MIN_CLICKS = 30

/** Chiến dịch đang trong giai đoạn học (mới < 3 ngày / chưa đủ 7 ngày & 50 chuyển đổi) — nền tảng còn dò, số dao động mạnh.
 *  Không rõ ngày tạo (vd chiến dịch Google) → coi là đã ổn định (như lib/campaign-health.ts). */
export function inLearning(c: Parameters<typeof getLearningStatus>[0]): boolean {
  try { return getLearningStatus(c).blockAutomation } catch { return false }
}
