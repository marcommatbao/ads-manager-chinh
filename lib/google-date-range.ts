// ============================================================
// Mệnh đề ngày cho GAQL — nguồn DUY NHẤT.
// ------------------------------------------------------------
// VÌ SAO CÓ FILE NÀY. Toán tử `DURING` của Google Ads chỉ nhận đúng 12 chuỗi
// cố định. Viết một chuỗi nghe rất hợp lý mà không có trong danh sách thì
// truy vấn hỏng 100% — và vì các chỗ gọi đều bọc try/catch nên nó hỏng IM
// LẶNG, hiện ra như "không có dữ liệu".
//
// Đã dính đúng lỗi này ít nhất ba lần, cùng lúc, ở sáu chỗ khác nhau:
//   • `LAST_3_DAYS` — 4 chỗ (root-cause, bid-tracker, budget-optimizer,
//     google monitor). Log production báo liên tục:
//     "Invalid date literal supplied for DURING operator: LAST_3_DAYS."
//   • `LAST_60_DAYS` / `LAST_90_DAYS` — nằm trong danh sách "an toàn" dùng
//     chung (lib/google-ads-guards.ts) và có nút bấm thật trên giao diện
//     Manual Bid + Attribution.
// Một người đã tự phát hiện và né đúng bẫy này ở toolkit/ngram nhưng chỉ sửa
// tại chỗ, không sửa vào guard dùng chung — nên năm chỗ còn lại vẫn hỏng.
//
// Cách chặn tái phát: mọi mệnh đề ngày đi qua đây. Số ngày nào Google có mốc
// sẵn thì dùng `DURING`, không có thì tự dựng `BETWEEN` với ngày tường minh —
// giữ ĐÚNG khoảng thời gian mà nơi gọi muốn, thay vì làm tròn sang mốc gần
// nhất rồi âm thầm đổi ý nghĩa của con số.
//
// Có script chặn ở scripts/check-gaql-dates.mjs quét cả repo.
// ============================================================

/**
 * 12 giá trị `DURING` hợp lệ — chép từ type `DateConstant` của SDK đang cài
 * (node_modules/google-ads-api/build/src/types.d.ts). KHÔNG thêm giá trị nào
 * vào đây nếu không có trong type đó.
 */
export const GAQL_DATE_CONSTANTS = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_BUSINESS_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
  "THIS_WEEK_SUN_TODAY",
  "THIS_WEEK_MON_TODAY",
  "LAST_WEEK_SUN_SAT",
  "LAST_WEEK_MON_SUN",
] as const;

export type GaqlDateConstant = (typeof GAQL_DATE_CONSTANTS)[number];

export function isGaqlDateConstant(value: string): value is GaqlDateConstant {
  return (GAQL_DATE_CONSTANTS as readonly string[]).includes(value);
}

/** Số ngày ↔ mốc `LAST_N_DAYS` mà Google thật sự có. */
const DAYS_WITH_CONSTANT: Record<number, GaqlDateConstant> = {
  7: "LAST_7_DAYS",
  14: "LAST_14_DAYS",
  30: "LAST_30_DAYS",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Mệnh đề ngày cho `N` ngày gần nhất, sẵn sàng ghép vào GAQL.
 *
 * Trả về `segments.date DURING LAST_N_DAYS` khi Google có mốc đó, ngược lại
 * `segments.date BETWEEN 'aaaa-mm-nn' AND 'aaaa-mm-nn'`.
 *
 * Khoảng BETWEEN kết thúc ở HÔM QUA, không phải hôm nay: hôm nay còn đang
 * chạy, gộp một ngày dở vào rồi đem so với các ngày trọn là tự tạo ra một cú
 * tụt giả ở cuối chuỗi. (`LAST_N_DAYS` của Google cũng không tính hôm nay.)
 */
export function dateClauseForDays(days: number, now = new Date()): string {
  const n = Math.max(1, Math.floor(days));
  const konstant = DAYS_WITH_CONSTANT[n];
  if (konstant) return `segments.date DURING ${konstant}`;

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  return `segments.date BETWEEN '${ymd(start)}' AND '${ymd(end)}'`;
}

/**
 * Mệnh đề ngày từ một chuỗi mốc do người dùng chọn trên giao diện.
 * Mốc Google có → dùng thẳng. Mốc quen thuộc nhưng Google KHÔNG có
 * (LAST_60_DAYS, LAST_90_DAYS) → tự dựng BETWEEN, không vứt lựa chọn của
 * người dùng và cũng không gửi đi một chuỗi Google sẽ từ chối.
 */
const EXTRA_RANGE_DAYS: Record<string, number> = {
  LAST_3_DAYS: 3,
  LAST_60_DAYS: 60,
  LAST_90_DAYS: 90,
  LAST_180_DAYS: 180,
};

export function dateClauseForRange(range: string, now = new Date()): string {
  if (isGaqlDateConstant(range)) return `segments.date DURING ${range}`;
  const days = EXTRA_RANGE_DAYS[range];
  if (days) return dateClauseForDays(days, now);
  // Không nhận ra → ném lỗi thay vì đoán. Đoán ở đây nghĩa là trả về số liệu
  // của một khoảng thời gian khác cái người dùng đang nhìn trên màn hình.
  throw new Error(`Mốc thời gian không hợp lệ cho GAQL: ${range}`);
}
