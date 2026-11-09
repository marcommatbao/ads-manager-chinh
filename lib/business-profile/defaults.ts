// ============================================================
// Business Profile — Default Profiles
//
// Extracts hardcoded data from:
//   - lib/company-config.ts  (domain, GA4, FB pixel)
//   - lib/cpl-calculator.ts  (CPL thresholds)
//   - lib/product-parser.ts  (products + detection keywords)
//
// These are used as seed values.  Runtime can override via
// data/business-profiles.json (see registry.ts).
// ============================================================

import type { BusinessProfile, BusinessCplThresholds, ProductProfile } from "./types";
import { metaAccountIds, ga4Ids } from "@/lib/meta-accounts";
import type { MetaCompany } from "@/lib/meta-accounts";

// ── Ngưỡng CPL theo công ty — ĐỌC TỪ BIẾN MÔI TRƯỜNG ───────
//
// Đổi 17/09/2026 (chuẩn bị đưa repo lên công khai). Ba con số này nói cho đối
// thủ biết Mắt Bão coi bao nhiêu tiền một khách hàng tiềm năng là "tốt", là
// "đắt quá" — theo từng công ty. Không phải khoá bí mật, nhưng là thông tin
// kinh doanh, không nên để mở.
//
// Định dạng biến `CPL_THRESHOLDS_JSON`, khoá là tenantId:
//   {"mbc":{"good":60000,"warning":99000,"critical":100000},
//    "mbi":{"good":150000,"warning":250000,"critical":251000}}
//
// Thiếu biến / thiếu công ty → `cplThresholds: null`, đúng như Sale.AI hiện
// nay (kiểu đã cho phép null). Chỗ dùng sẽ không hiện phần so ngưỡng thay vì
// so với một con số không ai đặt.

/** 60000 → "60K", 60500 → "60.5K". */
function fmtK(v: number): string {
  const k = v / 1000;
  return `${Number.isInteger(k) ? k : Math.round(k * 10) / 10}K`;
}

/**
 * Nhãn sinh TỪ chính ba con số, không lưu rời trong cấu hình. Trước đây nhãn
 * là chuỗi ghi cứng cạnh số — sửa số mà quên sửa nhãn là giao diện nói một
 * đằng, phép so làm một nẻo. Sinh ra thì không lệch được.
 */
function cplThresholdsFor(tenantId: string): BusinessCplThresholds | null {
  const raw = process.env.CPL_THRESHOLDS_JSON;
  if (!raw || !raw.trim()) return null;
  let parsed: Record<string, { good?: unknown; warning?: unknown; critical?: unknown }>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[business-profile] CPL_THRESHOLDS_JSON không phải JSON hợp lệ:", err instanceof Error ? err.message : err);
    return null;
  }
  const t = parsed?.[tenantId];
  if (!t) return null;
  const good = Number(t.good), warning = Number(t.warning), critical = Number(t.critical);
  if (![good, warning, critical].every(n => Number.isFinite(n) && n > 0)) {
    console.error(`[business-profile] CPL_THRESHOLDS_JSON["${tenantId}"] thiếu hoặc sai good/warning/critical.`);
    return null;
  }
  if (!(good < warning && warning < critical)) {
    // Thứ tự sai thì mọi lead đều rơi vào một bậc — báo động luôn đỏ hoặc luôn
    // xanh. Thà không có ngưỡng còn hơn có ngưỡng vô nghĩa.
    console.error(`[business-profile] CPL_THRESHOLDS_JSON["${tenantId}"] phải theo thứ tự good < warning < critical (nhận ${good}/${warning}/${critical}).`);
    return null;
  }
  return {
    good, warning, critical,
    labels: {
      good:     `Tốt (≤ ₫${fmtK(good)})`,
      warning:  `Theo dõi (₫${fmtK(good + 1000)}–₫${fmtK(warning)})`,
      critical: `Đắt quá (≥ ₫${fmtK(critical)})`,
    },
  };
}

/** Bộ ID phân tích + pixel của một công ty, đọc từ env (xem lib/meta-accounts.ts). */
function analyticsFor(company: MetaCompany) {
  const g = ga4Ids(company);
  return { ga4PropertyId: g.propertyId, ga4StreamId: g.streamId, ga4MeasurementId: g.measurementId };
}

// ── Shared product catalogue ──────────────────────────────
// Keywords from product-parser.ts PRODUCT_COLORS + parseProductFromCampaign()

const MBC_PRODUCTS: ProductProfile[] = [
  {
    name:  "Tên miền",
    color: "#3B82F6",
    detectionKeywords: [
      "tên miền", "ten mien", "domain", ".vn", ".com", ".xyz",
      ".cloud", ".one", "thả ga", "tha ga",
    ],
  },
  {
    name:  "Hóa đơn ĐT",
    color: "#8B5CF6",
    detectionKeywords: ["hóa đơn", "hoa don", "hddt", "einvoice"],
  },
  {
    name:  "Chữ ký số",
    color: "#EF4444",
    detectionKeywords: ["chữ ký", "chu ky", "chký", "ký số"],
  },
  {
    name:  "Microsoft 365",
    color: "#10B981",
    detectionKeywords: ["microsoft", "ms365", "office"],
  },
  {
    name:  "Khóa học",
    color: "#F59E0B",
    detectionKeywords: ["khoá học", "khóa học", "khoa hoc", "thuế", "bctc", "webinar"],
  },
  {
    name:  "Hosting",
    color: "#06B6D4",
    detectionKeywords: ["hosting", "cloud server", "elastic cloud"],
  },
];

const MBI_PRODUCTS: ProductProfile[] = [
  {
    name:  "Tên miền",
    color: "#3B82F6",
    detectionKeywords: ["tên miền", "ten mien", "domain", ".vn", ".com"],
  },
  {
    name:  "Hosting",
    color: "#06B6D4",
    detectionKeywords: ["hosting", "cloud server"],
  },
  {
    name:  "Hóa đơn ĐT",
    color: "#8B5CF6",
    detectionKeywords: ["hóa đơn", "hddt"],
  },
  {
    name:  "Chữ ký số",
    color: "#EF4444",
    detectionKeywords: ["chữ ký", "ký số"],
  },
];

const SALE_AI_PRODUCTS: ProductProfile[] = [
  {
    name:  "Sale.ai",
    color: "#F97316",
    detectionKeywords: ["sale.ai", "sale ai", "trực page", "truc page"],
  },
  {
    name:  "MB Elastic",
    color: "#EC4899",
    detectionKeywords: ["mb elastic", "elastic"],
  },
];

// ── Default profiles ──────────────────────────────────────

export const DEFAULT_PROFILES: BusinessProfile[] = [
  // ─── MBC ───────────────────────────────────────────────
  {
    tenantId:   "mbc",
    name:       "Mắt Bão",
    shortLabel: "MBC",
    domain:     "matbao.net",
    colorClass: "blue",

    products: MBC_PRODUCTS,

    cplThresholds: cplThresholdsFor("mbc"),

    channels: [
      { platform: "facebook",   isPrimary: true,  pixelId: metaAccountIds("MBC").pixelId },
      { platform: "google_ads", isPrimary: false },
    ],

    analytics: analyticsFor("MBC"),

    reporting: {
      currency:     "VND",
      timezone:     "Asia/Ho_Chi_Minh",
      lookbackDays: 30,
    },

    notes: "Công ty mẹ — domain/hosting/tên miền/chứng chỉ số. Ads chủ yếu Facebook.",
  },

  // ─── MBI ───────────────────────────────────────────────
  {
    tenantId:   "mbi",
    name:       "Mắt Bão Indochina",
    shortLabel: "MBI",
    domain:     "matbao.in",
    colorClass: "indigo",

    products: MBI_PRODUCTS,

    cplThresholds: cplThresholdsFor("mbi"),

    channels: [
      { platform: "facebook",   isPrimary: true,  pixelId: metaAccountIds("MBI").pixelId },
      { platform: "google_ads", isPrimary: false },
    ],

    analytics: analyticsFor("MBI"),

    reporting: {
      currency:     "VND",
      timezone:     "Asia/Ho_Chi_Minh",
      lookbackDays: 30,
    },

    notes: "Công ty thứ hai — CPL target cao hơn MBC vì chu kỳ bán hàng dài hơn.",
  },

  // ─── SALE_AI ───────────────────────────────────────────
  {
    tenantId:   "sale_ai",
    name:       "Sale.AI",
    shortLabel: "SALE_AI",
    domain:     "sale.ai.vn",
    colorClass: "emerald",

    products: SALE_AI_PRODUCTS,

    cplThresholds: cplThresholdsFor("sale_ai"),

    channels: [
      { platform: "facebook",   isPrimary: true,  pixelId: metaAccountIds("SALE_AI").pixelId },
      { platform: "google_ads", isPrimary: false },
    ],

    analytics: analyticsFor("SALE_AI"),

    reporting: {
      currency:     "VND",
      timezone:     "Asia/Ho_Chi_Minh",
      lookbackDays: 30,
    },

    notes: "SaaS AI sales automation — CPL chưa được thiết lập, theo dõi riêng.",
  },
];

export const DEFAULT_PROFILES_BY_ID = Object.fromEntries(
  DEFAULT_PROFILES.map(p => [p.tenantId, p])
) as Record<string, BusinessProfile>;
