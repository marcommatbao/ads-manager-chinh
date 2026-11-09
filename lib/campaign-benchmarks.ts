// ============================================================
// Ngưỡng đánh giá chiến dịch — NGUỒN SỰ THẬT DUY NHẤT
// ============================================================
// VÌ SAO FILE NÀY TỒN TẠI (23/09/2026):
//
// Trước file này, repo đã có HAI bản ngưỡng "campaign health" chạy song song
// và LỆCH NHAU — chính lib/campaign-health.ts có ghi cảnh báo đó ở đầu file:
//   · lib/campaign-health.ts        → CPC cảnh báo 35.000đ, CTR thấp cần >1.000 hiển thị
//   · components/CampaignTable.tsx  → CPC cảnh báo 20.000đ, CTR thấp cần >5.000 hiển thị
//
// Bản người dùng THẬT SỰ NHÌN THẤY trên bảng Chiến dịch là bản trong
// CampaignTable. Nên các con số dưới đây lấy theo BẢN ĐÓ, không phải bản kia —
// để tấm thẻ "Phân tích" trên trang chi tiết không bao giờ nói ngược lại cái
// huy hiệu mà cùng chiến dịch đó đang đeo ở bảng danh sách.
//
// LUẬT CHO NGƯỜI SỬA SAU: thêm ngưỡng mới thì thêm VÀO ĐÂY rồi import, đừng
// gõ số thẳng vào chỗ dùng. Một con số quảng cáo bị gõ ở hai nơi là chuyện
// đã xảy ra hai lần trong repo này rồi.
// ============================================================

/** CTR (%) — mốc tham chiếu chung cho quảng cáo hiển thị/tìm kiếm B2B VN. */
export const CTR_BENCHMARK_PCT = 2.0;
/** CTR dưới mức này là kém — nhưng chỉ kết luận khi đã đủ hiển thị (xem dưới). */
export const CTR_LOW_PCT = 0.5;
export const CTR_GOOD_PCT = 2.0;
export const CTR_EXCELLENT_PCT = 3.0;

/**
 * Số hiển thị tối thiểu trước khi được phép kết luận CTR tốt/xấu.
 * Dưới mức này, CTR là nhiễu thống kê chứ không phải tín hiệu.
 */
export const CTR_MIN_IMPRESSIONS = 5_000;

/** CPC (VND) vượt mức này là đắt. */
export const CPC_HIGH_VND = 20_000;

/** Tần suất (Meta): số lần trung bình một người thấy quảng cáo. */
export const FREQUENCY_WARN = 3.5;
export const FREQUENCY_CRITICAL = 5.0;

/**
 * ROAS — doanh thu trên mỗi đồng chi.
 * 1,0 là ĐIỂM HOÀ VỐN THEO ĐỊNH NGHĨA (thu về đúng bằng số đã tiêu), không
 * phải con số ai đó chọn. 0,5 là ngưỡng "đang lỗ" mà bảng Chiến dịch đang dùng.
 */
export const ROAS_BREAKEVEN = 1.0;
export const ROAS_LOSING = 0.5;

/** Chi tiêu tối thiểu (VND) trước khi được phép kết luận "đang lỗ". */
export const ROAS_MIN_SPEND_VND = 200_000;

/** Số click tối thiểu trước khi được phép kết luận "có click mà không ra đơn". */
export const CVR_MIN_CLICKS = 50;

/** Chiến dịch ACTIVE quá số ngày này mà 0 hiển thị = không phân phối. */
export const NO_DELIVERY_MIN_AGE_DAYS = 2;

/**
 * Số ngày tối thiểu để so xu hướng nửa đầu ↔ nửa sau.
 * Dưới 6 ngày thì mỗi nửa chỉ có 1-2 ngày — một ngày cuối tuần cũng đủ lật
 * ngược kết luận, nên thà nói "chưa đủ dữ liệu".
 */
export const TREND_MIN_DAYS = 6;

/** Biến động dưới mức này coi như đi ngang, không đáng gọi là xu hướng. */
export const TREND_SIGNIFICANT_PCT = 15;

/**
 * Một ad set/ad group tiêu từ mức này trở lên trong tổng chi của chiến dịch
 * mà không ra chuyển đổi nào thì đáng gọi tên. Dưới mức đó là nhiễu.
 */
export const ADSET_WASTE_SHARE = 0.15;

/**
 * Ngân sách ngày tối thiểu (VND) mà hệ thống chấp nhận.
 *
 * PHẢI khớp với chốt chặn ở CẢ HAI route ghi ngân sách:
 *   · app/api/meta/campaigns/[id]/budget/route.ts
 *   · app/api/google/campaigns/[id]/budget/route.ts
 * Hai nơi đó từ chối mọi giá trị dưới mức này. Đặt số ở đây thấp hơn chúng là
 * dựng ra một cái nút mà route sẽ trả 400 khi bấm.
 */
export const BUDGET_MIN_VND = 10_000;

/** Mức cắt khi đề xuất giảm ngân sách: giữ lại 70%, tức cắt 30%. */
export const BUDGET_CUT_RATIO = 0.7;
