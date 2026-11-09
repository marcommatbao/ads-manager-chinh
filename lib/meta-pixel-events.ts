// ============================================================
// Meta Pixel — Danh mục sự kiện chuyển đổi (nguồn sự thật DUY NHẤT)
// ============================================================
// Trước file này, cùng một danh mục sự kiện bị chép ở 3 nơi và ĐÃ LỆCH NHAU:
//
//   • app/(dashboard)/creative/_constants.ts  → value "CONTENT_VIEW"
//   • app/api/creative/launch-campaign/route.ts (EVENT_NORMALIZE)
//                                             → chỉ nhận "VIEW_CONTENT"
//   • lib/meta-conversion-goal.ts             → khoá "VIEW_CONTENT"
//
// Hậu quả thật: chọn "ViewContent" ở giao diện gửi lên "CONTENT_VIEW",
// EVENT_NORMALIZE không có khoá đó nên rơi vào nhánh mặc định và chiến dịch
// được tạo với custom_event_type = PURCHASE — người dùng tưởng đang tối ưu
// lượt xem nội dung nhưng Meta lại tối ưu lượt mua, im lặng, không báo lỗi.
// Chiều ngược lại, cột "Kết quả"/CPL của chiến dịch ViewContent thật cũng bị
// đếm nhầm sang purchase vì bảng tra ở meta-conversion-goal.ts dùng khoá sai.
//
// `enumValue` dưới đây là giá trị enum `custom_event_type` THẬT của Meta
// Marketing API v19 (CONTENT_VIEW, INITIATED_CHECKOUT… — không phải
// VIEW_CONTENT / INITIATE_CHECKOUT), `pixelName` là tên sự kiện đúng như
// Pixel bắn về và như /{pixel_id}/stats trả ra, `actionTypes` là slug trong
// insights `actions[].action_type`.

import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

export interface StandardPixelEvent {
  /** Giá trị enum gửi lên Meta trong promoted_object.custom_event_type */
  enumValue: string;
  /** Tên sự kiện Pixel bắn về (khớp với /{pixel_id}/stats) */
  pixelName: string;
  /** Nhãn tiếng Việt — bám theo cách Ads Manager bản tiếng Việt gọi tên */
  labelVi: string;
  /** Slug trong insights actions[].action_type dùng để đếm kết quả */
  actionTypes: string[];
}

export const STANDARD_PIXEL_EVENTS: StandardPixelEvent[] = [
  { enumValue: "PURCHASE",              pixelName: "Purchase",             labelVi: "Lượt mua",                    actionTypes: ["omni_purchase", "purchase"] },
  { enumValue: "LEAD",                  pixelName: "Lead",                 labelVi: "Khách hàng tiềm năng",        actionTypes: ["lead", "onsite_conversion.lead_grouped"] },
  { enumValue: "COMPLETE_REGISTRATION", pixelName: "CompleteRegistration", labelVi: "Hoàn tất đăng ký",            actionTypes: ["complete_registration"] },
  { enumValue: "INITIATED_CHECKOUT",    pixelName: "InitiateCheckout",     labelVi: "Bắt đầu thanh toán",          actionTypes: ["initiate_checkout"] },
  { enumValue: "ADD_PAYMENT_INFO",      pixelName: "AddPaymentInfo",       labelVi: "Thêm thông tin thanh toán",   actionTypes: ["add_payment_info"] },
  { enumValue: "ADD_TO_CART",           pixelName: "AddToCart",            labelVi: "Thêm vào giỏ hàng",           actionTypes: ["add_to_cart"] },
  { enumValue: "ADD_TO_WISHLIST",       pixelName: "AddToWishlist",        labelVi: "Thêm vào danh sách yêu thích", actionTypes: ["add_to_wishlist"] },
  { enumValue: "CONTENT_VIEW",          pixelName: "ViewContent",          labelVi: "Xem nội dung",                actionTypes: ["view_content"] },
  { enumValue: "SEARCH",                pixelName: "Search",               labelVi: "Tìm kiếm",                    actionTypes: ["search"] },
  { enumValue: "CONTACT",               pixelName: "Contact",              labelVi: "Liên hệ",                     actionTypes: ["contact"] },
  { enumValue: "SUBMIT_APPLICATION",    pixelName: "SubmitApplication",    labelVi: "Gửi đơn đăng ký",             actionTypes: ["submit_application"] },
  { enumValue: "SCHEDULE",              pixelName: "Schedule",             labelVi: "Đặt lịch hẹn",                actionTypes: ["schedule"] },
  { enumValue: "START_TRIAL",           pixelName: "StartTrial",           labelVi: "Bắt đầu dùng thử",            actionTypes: ["start_trial"] },
  { enumValue: "SUBSCRIBE",             pixelName: "Subscribe",            labelVi: "Đăng ký thuê bao",            actionTypes: ["subscribe"] },
  { enumValue: "CUSTOMIZE_PRODUCT",     pixelName: "CustomizeProduct",     labelVi: "Tùy chỉnh sản phẩm",          actionTypes: ["customize_product"] },
  { enumValue: "FIND_LOCATION",         pixelName: "FindLocation",         labelVi: "Tìm địa điểm",                actionTypes: ["find_location"] },
  { enumValue: "DONATE",                pixelName: "Donate",               labelVi: "Quyên góp",                   actionTypes: ["donate"] },
];

const BY_ENUM = new Map(STANDARD_PIXEL_EVENTS.map((e) => [e.enumValue, e]));
const BY_PIXEL_NAME = new Map(STANDARD_PIXEL_EVENTS.map((e) => [e.pixelName.toLowerCase(), e]));

/** Bảng nhận diện các cách viết cũ/lệch từng tồn tại trong codebase và trong
 *  bản nháp đã lưu của người dùng, để một chiến dịch lưu từ trước không âm
 *  thầm bị đổi mục tiêu khi mở lại. Chỉ dịch về enum ĐÚNG của Meta. */
const LEGACY_ALIASES: Record<string, string> = {
  VIEW_CONTENT: "CONTENT_VIEW",
  INITIATE_CHECKOUT: "INITIATED_CHECKOUT",
  PAGE_VIEW: "CONTENT_VIEW",
};

/** Chuẩn hoá một giá trị sự kiện bất kỳ (enum, tên Pixel, biến thể cũ) về
 *  đúng enum custom_event_type của Meta. Trả null nếu không phải sự kiện
 *  tiêu chuẩn — khi đó nó là sự kiện tuỳ chỉnh, phải đi đường pixel_rule. */
export function normalizeStandardEvent(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (BY_ENUM.has(upper)) return upper;
  if (LEGACY_ALIASES[upper] && BY_ENUM.has(LEGACY_ALIASES[upper])) return LEGACY_ALIASES[upper];
  const byName = BY_PIXEL_NAME.get(trimmed.toLowerCase());
  return byName ? byName.enumValue : null;
}

/** Nhãn tiếng Việt của một enum sự kiện tiêu chuẩn (fallback: chính enum đó). */
export function labelForStandardEvent(enumValue: string, t?: TFunction): string {
  const ev = BY_ENUM.get(enumValue);
  if (ev && t) return t(`libmeta.pixel.ev.${ev.enumValue}` as MessageKey);
  return ev?.labelVi ?? enumValue;
}

export function findStandardEvent(enumValue: string): StandardPixelEvent | undefined {
  return BY_ENUM.get(enumValue);
}

// ─────────────────────────────────────────────
// Kiểu dữ liệu trả cho giao diện chọn sự kiện
// ─────────────────────────────────────────────

export type ConversionEventKind = "standard" | "custom_event" | "custom_conversion";

export interface ConversionEventOption {
  /** Khoá duy nhất trong danh sách — giao diện dùng làm value của radio. */
  key: string;
  kind: ConversionEventKind;
  /** Nhãn hiển thị: nhãn tiếng Việt cho sự kiện tiêu chuẩn, tên thô cho sự
   *  kiện tuỳ chỉnh, tên chuyển đổi tuỳ chỉnh do người dùng đặt. */
  label: string;
  /** Dòng phụ nhỏ dưới nhãn (vd "Chuyển đổi tùy chỉnh"). */
  sublabel?: string;
  /** enum custom_event_type — chỉ có với kind = "standard", và với
   *  custom_conversion thì là custom_event_type mà Meta gán cho nó. */
  enumValue?: string;
  /** Tên sự kiện Pixel thô — cần cho kind = "custom_event" (pixel_rule). */
  pixelEventName?: string;
  /** ID chuyển đổi tuỳ chỉnh — chỉ có với kind = "custom_conversion". */
  customConversionId?: string;
  /** Số lần sự kiện bắn về trong cửa sổ thống kê. undefined = KHÔNG BIẾT
   *  (gọi /stats thất bại), khác hẳn 0 = biết chắc là không bắn lần nào.
   *  Giao diện phải phân biệt hai trạng thái này, không được gộp. */
  count?: number;
  /** true khi có ghi nhận hoạt động trong cửa sổ thống kê; undefined = không rõ. */
  active?: boolean;
}

export interface PixelEventsPayload {
  pixelId: string;
  options: ConversionEventOption[];
  /** Số ngày của cửa sổ thống kê hoạt động. */
  statsWindowDays: number;
  /** false khi không lấy được thống kê hoạt động — giao diện KHÔNG được vẽ
   *  chấm "đang hoạt động" trong trường hợp này (sẽ là số liệu bịa). */
  activityKnown: boolean;
  /** "live" khi ít nhất một lệnh gọi Meta thành công; "fallback" khi chỉ còn
   *  danh mục sự kiện tiêu chuẩn tĩnh. */
  source: "live" | "fallback";
  warnings: string[];
}

// ─────────────────────────────────────────────
// Đọc thống kê hoạt động của Pixel
// ─────────────────────────────────────────────

interface PixelStatEntry {
  value?: string;
  count?: number | string;
  /** Một số phiên bản trả tên sự kiện ở khoá "event" thay vì "value". */
  event?: string;
}

/** /{pixel_id}/stats đã từng đổi hình dạng giữa các bản Graph API: có bản trả
 *  `data[].data[]` (nhóm theo mốc thời gian), có bản trả thẳng `data[]`. Đọc
 *  cả hai thay vì cược vào một dạng — nếu đọc trượt thì triệu chứng là danh
 *  sách "đang hoạt động" rỗng chứ không phải một lỗi nhìn thấy được. */
export function parsePixelStats(json: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const root = (json as { data?: unknown })?.data;
  if (!Array.isArray(root)) return counts;

  const absorb = (entry: PixelStatEntry) => {
    const name = (entry.value ?? entry.event ?? "").toString().trim();
    if (!name) return;
    const n = Number(entry.count ?? 0);
    counts.set(name, (counts.get(name) ?? 0) + (Number.isFinite(n) ? n : 0));
  };

  for (const group of root as Array<PixelStatEntry & { data?: PixelStatEntry[] }>) {
    if (Array.isArray(group?.data)) group.data.forEach(absorb);
    else absorb(group);
  }
  return counts;
}

