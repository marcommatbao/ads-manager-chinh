// ============================================================
// Google Ads API — Enum helpers
// ============================================================
// Google Ads API trả về match_type dưới dạng số enum
// UNSPECIFIED = 0, UNKNOWN = 1, BROAD = 2, PHRASE = 3, EXACT = 4

const MATCH_TYPE_MAP: Record<number | string, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "BROAD",
  3: "PHRASE",
  4: "EXACT",
  // Đề phòng trường hợp đã là string
  UNSPECIFIED: "UNSPECIFIED",
  UNKNOWN:     "UNKNOWN",
  BROAD:       "BROAD",
  PHRASE:      "PHRASE",
  EXACT:       "EXACT",
}

/**
 * Convert matchType từ Google Ads API (số hoặc string)
 * → string an toàn để dùng toLowerCase(), display, v.v.
 */
export function resolveMatchType(
  matchType: number | string | null | undefined
): string {
  if (matchType === null || matchType === undefined) return "UNKNOWN"

  // Nếu đã là string hợp lệ
  if (typeof matchType === "string") {
    return MATCH_TYPE_MAP[matchType.toUpperCase()] || matchType.toUpperCase()
  }

  // Nếu là số enum
  if (typeof matchType === "number") {
    return MATCH_TYPE_MAP[matchType] || "UNKNOWN"
  }

  return "UNKNOWN"
}

/**
 * Format match type để hiển thị với ký hiệu
 * BROAD → "+broad", PHRASE → '"phrase"', EXACT → "[exact]"
 */
export function formatMatchType(
  matchType: number | string | null | undefined
): string {
  const mt = resolveMatchType(matchType)
  switch (mt) {
    case "BROAD":  return "+broad"
    case "PHRASE": return '"phrase"'
    case "EXACT":  return "[exact]"
    default:       return mt.toLowerCase()
  }
}

/**
 * Safe toLowerCase cho bất kỳ field nào từ Google Ads API
 * Dùng thay cho: (field || "").toLowerCase()
 */
export function safeString(
  value: number | string | null | undefined
): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  return String(value)
}

// ============================================================
// Khai báo quảng cáo chính trị EU — Google BẮT BUỘC khi tạo campaign
// ------------------------------------------------------------
// Từ khi quy định quảng cáo chính trị của EU (TTPA) có hiệu lực, Google Ads API
// **từ chối mọi lệnh tạo campaign** không có trường này:
//
//   field_error: 2 — "The required field was not present."
//   mutate_operations[N].campaign_operation.create.contains_eu_political_advertising
//
// Phát hiện 2026-08-24 qua phép thử rollback: mọi launch Google (Search lẫn
// PMax) đều hỏng ngay pha 1 vì thiếu đúng trường này, và người dùng chỉ nhận
// được một chữ "Launch failed" trống rỗng.
//
// Giá trị khai báo: Mắt Bão bán tên miền / hosting / hoá đơn điện tử — KHÔNG
// phải quảng cáo chính trị. Đây là một lời khai với Google, nên để ở một chỗ
// duy nhất, đặt tên rõ ràng: nếu có ngày công ty thật sự chạy quảng cáo thuộc
// diện đó thì sửa đúng hằng số này, không đi sửa rải rác trong từng route.
// ============================================================
export const EU_POLITICAL_ADVERTISING_DECLARATION =
  "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" as const;

// ============================================================
// Đường dẫn hiển thị (display path) của quảng cáo Search
// ============================================================
//
// LỖI THẬT 27/08/2026, launch bị Google từ chối:
//   "The input string value contains disallowed characters."
//   trường: ...responsive_search_ad.path2  [string_format_error: 2]
//
// Thủ phạm: `path2` được đặt cứng là "matbao.net" — **dấu chấm** không hợp lệ.
// `path1` cũng rủi ro y hệt vì nó lấy thẳng tên sản phẩm, tức có DẤU CÁCH và
// DẤU TIẾNG VIỆT.
//
// path1/path2 KHÔNG phải một phần của URL thật (URL đích nằm ở `final_urls`) —
// nó chỉ là đoạn chữ hiển thị sau tên miền cho đẹp. Google chỉ nhận chữ và số.
// Nên bỏ dấu, bỏ mọi ký tự đặc biệt, cắt còn 15 ký tự.

/** Bỏ dấu tiếng Việt: "Tên miền" → "Ten mien". */
function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/**
 * Chuẩn hoá một đoạn đường dẫn hiển thị cho quảng cáo Search.
 *
 * Chỉ giữ CHỮ và SỐ (đã bỏ dấu), cắt tối đa 15 ký tự theo đúng giới hạn của
 * Google. Trả chuỗi rỗng nếu không còn ký tự hợp lệ nào — chuỗi rỗng là hợp lệ
 * (Google hiểu là không dùng đường dẫn hiển thị), khác hẳn một chuỗi có ký tự
 * cấm vốn làm hỏng CẢ lệnh tạo quảng cáo.
 */
export function sanitizeDisplayPath(input: string | null | undefined): string {
  if (!input) return "";
  return stripDiacritics(String(input))
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 15);
}

// ============================================================
// Hành động chuyển đổi — enum số → tên đọc được
// ============================================================
//
// LỖI THẬT 27/08/2026: màn hình chọn mục tiêu hiện "4 · 2" thay vì
// "PURCHASE · WEBSITE", và tệ hơn — luật gợi ý mặc định
// (`/PURCHASE/i.test(category)`) KHÔNG BAO GIỜ khớp, nên `Purchase` không được
// đánh dấu NÊN CHỌN và không được tự chọn. Người dùng phải tự mò.
//
// Cùng một cái bẫy mà `resolveMatchType` ở trên đã xử cho match_type: Google Ads
// API trả enum dưới dạng SỐ, không phải chuỗi.
// https://developers.google.com/google-ads/api/reference/rpc/v23/ConversionActionCategoryEnum

const CONVERSION_CATEGORY_MAP: Record<string, string> = {
  "0": "UNSPECIFIED", "1": "UNKNOWN", "2": "DEFAULT", "3": "PAGE_VIEW",
  "4": "PURCHASE", "5": "SIGNUP", "6": "LEAD", "7": "DOWNLOAD",
  "8": "ADD_TO_CART", "9": "BEGIN_CHECKOUT", "10": "SUBSCRIBE_PAID",
  "11": "PHONE_CALL_LEAD", "12": "IMPORTED_LEAD", "13": "SUBMIT_LEAD_FORM",
  "14": "BOOK_APPOINTMENT", "15": "REQUEST_QUOTE", "16": "GET_DIRECTIONS",
  "17": "OUTBOUND_CLICK", "18": "CONTACT", "19": "ENGAGEMENT",
  "20": "STORE_VISIT", "21": "STORE_SALE", "22": "QUALIFIED_LEAD",
  "23": "CONVERTED_LEAD",
};

const CONVERSION_ORIGIN_MAP: Record<string, string> = {
  "0": "UNSPECIFIED", "1": "UNKNOWN", "2": "WEBSITE", "3": "GOOGLE_HOSTED",
  "4": "APP", "5": "CALL_FROM_ADS", "6": "STORE", "7": "YOUTUBE_HOSTED",
};

function resolveEnum(map: Record<string, string>, v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "UNKNOWN";
  const key = String(v);
  // Đã là tên thì trả nguyên — thư viện có thể đổi cách trả giữa các phiên bản.
  if (Object.values(map).includes(key)) return key;
  return map[key] ?? key;
}

export function resolveConversionCategory(v: number | string | null | undefined): string {
  return resolveEnum(CONVERSION_CATEGORY_MAP, v);
}

export function resolveConversionOrigin(v: number | string | null | undefined): string {
  return resolveEnum(CONVERSION_ORIGIN_MAP, v);
}

/** Tên tiếng Việt cho nhóm hành động, để người đọc không phải dịch enum. */
export const CONVERSION_CATEGORY_VI: Record<string, string> = {
  PURCHASE: "Đơn hàng",
  SUBMIT_LEAD_FORM: "Gửi form",
  QUALIFIED_LEAD: "Lead đạt chuẩn",
  CONVERTED_LEAD: "Lead đã chốt",
  LEAD: "Lead",
  IMPORTED_LEAD: "Lead nhập vào",
  PHONE_CALL_LEAD: "Gọi điện",
  CONTACT: "Liên hệ",
  SIGNUP: "Đăng ký",
  ADD_TO_CART: "Thêm giỏ hàng",
  BEGIN_CHECKOUT: "Bắt đầu thanh toán",
  SUBSCRIBE_PAID: "Đăng ký trả phí",
  PAGE_VIEW: "Xem trang",
  DOWNLOAD: "Tải xuống",
  OUTBOUND_CLICK: "Nhấp ra ngoài",
  ENGAGEMENT: "Tương tác",
  BOOK_APPOINTMENT: "Đặt lịch",
  REQUEST_QUOTE: "Xin báo giá",
  GET_DIRECTIONS: "Chỉ đường",
  STORE_VISIT: "Ghé cửa hàng",
  STORE_SALE: "Bán tại cửa hàng",
  DEFAULT: "Mặc định",
};
