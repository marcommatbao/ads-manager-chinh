// ============================================================
// Ad platform character-limit validation
//
// Prompts *ask* Gemini to respect these limits, but nothing re-checked the
// response. Module này kiểm lại đầu ra của AI để chỗ gọi còn biết mà sinh lại.
//
// ⚠️ HAI LOẠI GIỚI HẠN, ĐỪNG ĐỐI XỬ NHƯ NHAU:
//
//  - GOOGLE (RSA 30/90, PMax): giới hạn CỨNG. Google API từ chối thật.
//  - FACEBOOK (40/125/30): chỉ là mức KHUYẾN NGHỊ HIỂN THỊ của Ads Manager.
//    Đo trực tiếp 25/08/2026 bằng validate_only trên tài khoản thật
//    (app/api/creative/diagnose-text-limits): Meta CHẤP NHẬN cả headline 45,
//    primaryText 154 lẫn description 33 — kèm biến thể đối chứng trong hạn cũng
//    chấp nhận, nên phép đo không bị nhiễu.
//
// Chú thích trước đây ở đây viết rằng text vượt hạn "chỉ lộ ra khi Facebook API
// từ chối lúc launch". Điều đó CHƯA TỪNG được kiểm, và preflight đã dựa vào nó
// để CHẶN launch — chặn người dùng vì một giới hạn không tồn tại. Vượt mức
// khuyến nghị của Facebook chỉ khiến chữ bị cắt kèm "Xem thêm"; đó là lý do
// đáng để viết ngắn lại, không phải lý do để chặn.
// ============================================================

export const FACEBOOK_LIMITS = { headline: 40, primaryText: 125, description: 30 } as const;

// generate-text's "google" mode packs extra headlines/descriptions into
// primaryText/description as "|"- and "."-separated sub-fields (see
// buildPrompt() in generate-text/route.ts) — validate each sub-field.
export const GOOGLE_TEXT_LIMITS = { headline: 30, subHeadline: 30, subDescription: 90 } as const;

export const GOOGLE_RSA_LIMITS  = { headline: 30, description: 90 } as const;
export const GOOGLE_PMAX_LIMITS = { headline: 30, longHeadline: 90, description: 90 } as const;

export interface LimitViolation {
  field:  string;
  text:   string;
  length: number;
  limit:  number;
  excess: number;
}

function pushViolation(out: LimitViolation[], field: string, text: string, limit: number): void {
  // Chuẩn hoá NFC trước khi đếm. Tiếng Việt có hai cách mã hoá cùng một chữ: dựng
  // sẵn (NFC) và tách dấu (NFD). "Triển khai Web 1 Click VibeHost" là 31 ký tự ở
  // NFC nhưng 33 đơn vị ở NFD. Google đếm theo ký tự dựng sẵn, nên `text.length`
  // trên chuỗi NFD sẽ đếm dư và chặn nhầm nội dung hợp lệ.
  const length = text.normalize("NFC").length;
  if (length > limit) out.push({ field, text, length, limit, excess: length - limit });
}

export interface SimpleCreative {
  headline: string;
  primaryText: string;
  description: string;
}

export function checkFacebookLimits(c: SimpleCreative): LimitViolation[] {
  const v: LimitViolation[] = [];
  pushViolation(v, "headline",    c.headline,    FACEBOOK_LIMITS.headline);
  pushViolation(v, "primaryText", c.primaryText, FACEBOOK_LIMITS.primaryText);
  pushViolation(v, "description", c.description, FACEBOOK_LIMITS.description);
  return v;
}

// RSA count requirements — Google hard-requires 3-15 headlines and 2-4
// descriptions per ad; requests outside this range are rejected by the
// API. lib/launch-preflight.ts's runPreflightGoogleSearch already checks
// the minimums inline (not exported/reusable), but nowhere enforces the
// maximums — this is additive, doesn't touch that existing check.
export const RSA_COUNT_LIMITS = { minHeadlines: 3, maxHeadlines: 15, minDescriptions: 2, maxDescriptions: 4 } as const;

export interface RsaCountViolation {
  field: "headlines" | "descriptions";
  count: number;
  min: number;
  max: number;
}

export function checkRsaCountLimits(headlines: string[], descriptions: string[]): RsaCountViolation[] {
  const v: RsaCountViolation[] = [];
  if (headlines.length < RSA_COUNT_LIMITS.minHeadlines || headlines.length > RSA_COUNT_LIMITS.maxHeadlines) {
    v.push({ field: "headlines", count: headlines.length, min: RSA_COUNT_LIMITS.minHeadlines, max: RSA_COUNT_LIMITS.maxHeadlines });
  }
  if (descriptions.length < RSA_COUNT_LIMITS.minDescriptions || descriptions.length > RSA_COUNT_LIMITS.maxDescriptions) {
    v.push({ field: "descriptions", count: descriptions.length, min: RSA_COUNT_LIMITS.minDescriptions, max: RSA_COUNT_LIMITS.maxDescriptions });
  }
  return v;
}

/** Character-limit check for a plain headline/description array (not the SimpleCreative shape checkGoogleTextLimits expects). */
export function checkRsaCharLimits(headlines: string[], descriptions: string[]): LimitViolation[] {
  const v: LimitViolation[] = [];
  headlines.forEach((h, i) => pushViolation(v, `headline[${i + 1}]`, h, GOOGLE_RSA_LIMITS.headline));
  descriptions.forEach((d, i) => pushViolation(v, `description[${i + 1}]`, d, GOOGLE_RSA_LIMITS.description));
  return v;
}

export function checkGoogleTextLimits(c: SimpleCreative): LimitViolation[] {
  const v: LimitViolation[] = [];
  pushViolation(v, "headline", c.headline, GOOGLE_TEXT_LIMITS.headline);

  c.primaryText.split("|").map(s => s.trim()).filter(Boolean)
    .forEach((h, i) => pushViolation(v, `primaryText[${i + 1}]`, h, GOOGLE_TEXT_LIMITS.subHeadline));

  c.description.split(/\.\s+/).map(s => s.trim()).filter(Boolean)
    .forEach((d, i) => pushViolation(v, `description[${i + 1}]`, d, GOOGLE_TEXT_LIMITS.subDescription));

  return v;
}

export function checkCreativeLimits(platform: "facebook" | "google", c: SimpleCreative): LimitViolation[] {
  return platform === "google" ? checkGoogleTextLimits(c) : checkFacebookLimits(c);
}

/** Khoảng dự phòng khi bảo AI viết lại.
 *
 *  Mô hình đếm ký tự rất kém và luôn vượt một chút — số thật đo được ở prod
 *  25/08: description 33/30 (+3), headline 45/40 (+5), primaryText 129/125 (+4).
 *  Bảo nó "đúng 30" thì nó ra 33; bảo nó "tối đa 26" thì phần thừa quen thuộc
 *  vẫn rơi vào trong giới hạn. Đây là cách vòng vo nhưng hiệu quả hơn là hò hét
 *  "đếm cẩn thận" với một thứ không đếm được. */
function targetWithHeadroom(limit: number): number {
  return limit <= 45 ? Math.max(10, limit - 4) : Math.max(40, limit - 10);
}

export function formatViolationsForRetry(violations: LimitViolation[]): string {
  const lines = violations.map(v =>
    `- ${v.field}: bản trước dài ${v.length} ký tự, TRẦN CỨNG là ${v.limit}. ` +
    `Lần này viết field đó DƯỚI ${targetWithHeadroom(v.limit)} ký tự. ` +
    `Nội dung cũ: "${v.text}"`
  );
  return `\n\nBẢN NHÁP TRƯỚC VƯỢT GIỚI HẠN KÝ TỰ CỦA NỀN TẢNG.\n${lines.join("\n")}\n` +
    `Quy tắc bắt buộc khi viết lại:\n` +
    `- CHỈ rút gọn các field nêu trên. Các field khác giữ nguyên ý, đừng viết dài thêm.\n` +
    `- Ký tự tính CẢ dấu cách và dấu câu. Tiếng Việt có dấu vẫn tính 1 ký tự mỗi chữ cái.\n` +
    `- Cắt bớt từ đệm ("ngay", "hôm nay", "siêu", dấu chấm than lặp) trước khi cắt ý chính.\n` +
    `- Thà ngắn hơn mức cần còn hơn vượt trần: vượt trần thì quảng cáo BỊ CHẶN, không đăng được.`;
}

// ── Google RSA/PMax item re-validation ──────────────────────────
// generate-creative's prompt asks Gemini to self-report charCount/isValid
// per item — never verified. Recompute from the actual string so the UI
// badge and launch-preflight checks reflect reality, not AI self-report.

export interface GoogleAdItem {
  text?: string;
  charCount?: number;
  isValid?: boolean;
  [key: string]: unknown;
}

export function recomputeGoogleAdItems(items: unknown, limit: number): GoogleAdItem[] {
  if (!Array.isArray(items)) return [];
  return (items as GoogleAdItem[]).map(item => {
    const text = typeof item.text === "string" ? item.text : "";
    return { ...item, text, charCount: text.length, isValid: text.length <= limit };
  });
}


// ── Chuẩn hoá nội dung quảng cáo về mảng CHUỖI ───────────────────────

/** Một dòng nội dung: chuỗi thuần, hoặc object do recomputeGoogleAdItems sinh. */
export type TextLike = string | { text?: string } | null | undefined;

export interface NormalizedTexts {
  /** Đủ điều kiện gửi lên Google. */
  kept: string[];
  /** Bị bỏ vì vượt giới hạn ký tự — PHẢI báo cho người dùng, không được im. */
  tooLong: { text: string; length: number; limit: number }[];
  /** Bị bỏ vì vượt số lượng tối đa Google cho phép. */
  overflow: string[];
}

/**
 * Đưa headlines/descriptions về mảng chuỗi hợp lệ.
 *
 * VÌ SAO CẦN: generate-creative chạy recomputeGoogleAdItems() nên dữ liệu lưu
 * trong data/google-creatives.json là mảng OBJECT {text, charCount, isValid},
 * trong khi cả preflight lẫn route launch đều khai `as string[]` rồi đọc
 * `.length` của từng phần tử. Với object thì `.length` là undefined, nên
 * `undefined <= 30` = false và TOÀN BỘ bị lọc sạch: preflight báo "cần ≥3
 * headlines, hiện có 0" ngay khi màn hình đang hiện đủ 15. PMax vì thế chưa
 * bao giờ launch được — nhưng không ai phát hiện vì chưa ai bấm.
 *
 * Gom về một chỗ để preflight và launch không thể lệch nhau lần nữa: chính
 * kiểu lệch đó (phép kiểm xác nhận một thứ, lệnh thật gửi một thứ khác) đã
 * gây ra lỗi path2 và lỗi bidding trước đây.
 */
export function normalizeAdTexts(items: unknown, limit: number, max: number): NormalizedTexts {
  const raw: string[] = Array.isArray(items)
    ? (items as TextLike[])
        .map((it) => (typeof it === "string" ? it : (it?.text ?? "")))
        .map((t) => String(t).trim())
        .filter(Boolean)
    : [];

  const seen = new Set<string>();
  const valid: string[] = [];
  const tooLong: NormalizedTexts["tooLong"] = [];
  for (const t of raw) {
    if (t.length > limit) { tooLong.push({ text: t, length: t.length, limit }); continue; }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(t);
  }
  return { kept: valid.slice(0, max), tooLong, overflow: valid.slice(max) };
}

/** Số lượng tối đa mỗi loại nội dung trong MỘT nhóm tài sản PMax.
 *  Bản cũ cắt headlines còn 5 — Google cho tới 15, nên 10 headline đã sinh ra
 *  bị vứt đi trong im lặng, đúng phần nguyên liệu mà PMax cần để ghép. */
export const GOOGLE_PMAX_MAX = { headline: 15, longHeadline: 5, description: 5 } as const;
