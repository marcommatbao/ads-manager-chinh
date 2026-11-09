// ============================================================
// Tiện ích hình ảnh cho quảng cáo Search (Image asset)
// ------------------------------------------------------------
// Quảng cáo Search KHÔNG có ảnh trong bản thân nó — đó là bản chất của Google
// Search, không phải thiếu sót. Nhưng Google cho gắn "tiện ích hình ảnh" ở cấp
// campaign/ad group: ảnh hiện BÊN CẠNH quảng cáo, chủ yếu trên di động.
//
// Google đòi HAI tỉ lệ:
//   • 1.91:1  (ngang)  — tối thiểu 600×314,  khuyến nghị 1200×628
//   • 1:1     (vuông)  — tối thiểu 300×300,  khuyến nghị 1200×1200
// và tối đa 5.120 KB mỗi ảnh.
//
// Kiểm kích thước Ở ĐÂY, trước khi gọi API. Gửi ảnh sai tỉ lệ lên rồi để Google
// từ chối thì vừa tốn lượt gọi vừa đẩy người dùng vào một thông báo lỗi tiếng
// Anh không nói được phải sửa gì.
// ============================================================

export const IMAGE_MAX_BYTES = 5_120 * 1024;

/** Google giới hạn 20 ảnh mỗi campaign. Vượt là bị từ chối lúc gắn. */
export const MAX_IMAGES_PER_CAMPAIGN = 20;

/** Sai số cho phép khi so tỉ lệ — ảnh cắt tay hiếm khi tròn tuyệt đối. */
const RATIO_TOLERANCE = 0.02;

export type ImageFieldType =
  | "MARKETING_IMAGE"           // 1.91:1 ngang
  | "SQUARE_MARKETING_IMAGE"    // 1:1 vuông
  | "PORTRAIT_MARKETING_IMAGE"  // 4:5 dọc
  | "LOGO"                      // 1:1 logo
  | "LANDSCAPE_LOGO";           // 4:1 logo ngang

/** Ảnh này dùng làm gì. KHÔNG suy ra được từ tỉ lệ: logo vuông và ảnh
 *  marketing vuông đều là 1:1 — chỉ người tải lên mới biết đó là cái nào.
 *  Đoán hộ là đoán sai một nửa số lần. */
export type ImagePurpose = "MARKETING" | "LOGO";

/**
 * Các khuôn ảnh Google nhận, tách theo mục đích.
 *
 * MỘT PHÂN BIỆT QUAN TRỌNG: chỉ **vuông** và **ngang** dùng được cho tiện ích
 * hình ảnh của quảng cáo TÌM KIẾM. **Dọc (4:5)** và **logo** là của Performance
 * Max — gắn vào campaign Search thì Google nhận nhưng không bao giờ hiển thị.
 *
 * PMax BẮT BUỘC có logo + ảnh ngang + ảnh vuông thì nhóm tài sản mới đủ điều
 * kiện phục vụ. Thiếu là campaign tạo ra không chạy được lượt nào.
 */
export const IMAGE_SPECS: Array<{
  fieldType: ImageFieldType;
  purpose: ImagePurpose;
  ratio: number;
  label: string;
  minW: number;
  minH: number;
  recommended: string;
  usedBy: "SEARCH_AND_PMAX" | "PMAX_ONLY";
  /** PMax không phục vụ được nếu thiếu loại này. */
  requiredForPMax?: boolean;
}> = [
  { fieldType: "MARKETING_IMAGE",          purpose: "MARKETING", ratio: 1.91, label: "Ngang 1.91:1", minW: 600, minH: 314, recommended: "1200×628",  usedBy: "SEARCH_AND_PMAX", requiredForPMax: true },
  { fieldType: "SQUARE_MARKETING_IMAGE",   purpose: "MARKETING", ratio: 1,    label: "Vuông 1:1",    minW: 300, minH: 300, recommended: "1200×1200", usedBy: "SEARCH_AND_PMAX", requiredForPMax: true },
  { fieldType: "PORTRAIT_MARKETING_IMAGE", purpose: "MARKETING", ratio: 0.8,  label: "Dọc 4:5",      minW: 480, minH: 600, recommended: "960×1200",  usedBy: "PMAX_ONLY" },
  { fieldType: "LOGO",                     purpose: "LOGO",      ratio: 1,    label: "Logo vuông 1:1", minW: 128, minH: 128, recommended: "1200×1200", usedBy: "PMAX_ONLY", requiredForPMax: true },
  { fieldType: "LANDSCAPE_LOGO",           purpose: "LOGO",      ratio: 4,    label: "Logo ngang 4:1", minW: 512, minH: 128, recommended: "1200×300",  usedBy: "PMAX_ONLY" },
];

/** Ba loại PMax bắt buộc phải có mới phục vụ được. */
export const PMAX_REQUIRED_FIELD_TYPES: ImageFieldType[] =
  IMAGE_SPECS.filter((s) => s.requiredForPMax).map((s) => s.fieldType);

export interface ImageCheck {
  ok: boolean;
  /** Loại tiện ích suy ra từ tỉ lệ. `null` khi ảnh không hợp lệ. */
  fieldType: ImageFieldType | null;
  ratioLabel: string;
  /** Cảnh báo — ảnh hợp lệ nhưng sẽ KHÔNG hiện ở loại campaign đang tạo. */
  warning: string | null;
  problems: string[];
}

/**
 * Đối chiếu một ảnh với yêu cầu của Google và suy ra loại tiện ích.
 *
 * Trả về DANH SÁCH vấn đề chứ không chỉ true/false: ảnh vừa sai tỉ lệ vừa quá
 * nặng thì người dùng cần biết cả hai, không phải sửa xong cái này mới lòi ra
 * cái kia.
 */
export function checkImage(
  width: number,
  height: number,
  bytes: number,
  campaignType: "SEARCH" | "PMAX" | "BOTH" = "SEARCH",
  purpose: ImagePurpose = "MARKETING",
): ImageCheck {
  const problems: string[] = [];
  let warning: string | null = null;
  const ratio = height > 0 ? width / height : 0;

  // Lọc theo MỤC ĐÍCH trước rồi mới so tỉ lệ. Logo vuông và ảnh marketing
  // vuông cùng là 1:1 — không tách theo mục đích thì luôn rơi vào cái đầu tiên.
  const candidates = IMAGE_SPECS.filter((sp) => sp.purpose === purpose);
  const spec = candidates.find((sp) => Math.abs(ratio - sp.ratio) <= sp.ratio * RATIO_TOLERANCE);

  let fieldType: ImageFieldType | null = null;
  let ratioLabel = `${width}×${height}`;

  if (spec) {
    fieldType = spec.fieldType;
    ratioLabel = `${spec.label} (${width}×${height})`;
    if (width < spec.minW || height < spec.minH) {
      problems.push(`${spec.label} phải tối thiểu ${spec.minW}×${spec.minH}, ảnh này ${width}×${height}. Khuyến nghị ${spec.recommended}.`);
    }
    if (spec.usedBy === "PMAX_ONLY" && campaignType === "SEARCH") {
      warning = `${spec.label} chỉ dùng cho Performance Max. Campaign Search sẽ nhận nhưng KHÔNG bao giờ hiển thị nó — dùng ảnh ngang 1.91:1 hoặc vuông 1:1.`;
    }
  } else {
    problems.push(
      `Tỉ lệ ${ratio.toFixed(2)}:1 không hợp với ${purpose === "LOGO" ? "logo" : "ảnh marketing"}. ` +
      `Chỉ nhận: ` + candidates.map((sp) => `${sp.label} (${sp.recommended})`).join(" · ") + ".",
    );
  }

  if (bytes > IMAGE_MAX_BYTES) {
    problems.push(`Ảnh nặng ${(bytes / 1024 / 1024).toFixed(1)}MB — Google giới hạn 5MB.`);
  }

  return { ok: problems.length === 0, fieldType, ratioLabel, warning, problems };
}

// ============================================================
// Gắn ảnh vào campaign SEARCH — loại liên kết KHÁC loại ảnh
// ------------------------------------------------------------
// Đây là chỗ app đã hỏng suốt: `checkImage()` phân loại ảnh theo TỈ LỆ và trả
// về MARKETING_IMAGE / SQUARE_MARKETING_IMAGE, rồi bước launch đem đúng chuỗi
// đó đi gắn vào campaign. Google từ chối:
//
//   [asset_link_error: 5] The specified field type is incompatible with the
//   given campaign type.
//
// Vì hai thứ này không cùng một khái niệm:
//   • MARKETING_IMAGE… = vai trò của ảnh TRONG NHÓM TÀI SẢN Performance Max.
//   • AD_IMAGE         = tiện ích hình ảnh của campaign TÌM KIẾM.
// Cùng một tấm ảnh, gắn vào PMax thì là MARKETING_IMAGE, gắn vào Search thì
// phải là AD_IMAGE. Không có cách nào suy ra từ tỉ lệ.
//
// Đo thật bằng validate_only trên tài khoản MBC ngày 18/09/2026:
//   ❌ MARKETING_IMAGE + campaign Search      → từ chối (câu lỗi trên)
//   ❌ SQUARE_MARKETING_IMAGE + Search        → từ chối (câu lỗi trên)
//   ✅ AD_IMAGE + ảnh vuông 1:1               → chấp nhận
//   ✅ AD_IMAGE + ảnh ngang 1.91:1            → chấp nhận
//   ❌ AD_IMAGE + ảnh dọc 4:5                 → từ chối
//        → "The aspect ratio of the image does not match the expected aspect
//           ratios provided in the asset spec."
//
// Ảnh dọc bị loại phải LỌC RA TRƯỚC KHI GỬI, không phải gửi rồi chịu lỗi: cả
// lô đi trong một lệnh mutate, một ảnh dọc làm rớt luôn những ảnh hợp lệ khác.
// ============================================================

/** Loại liên kết Google dùng cho tiện ích hình ảnh của quảng cáo Tìm kiếm. */
export const SEARCH_IMAGE_FIELD_TYPE = "AD_IMAGE" as const;

/** Tỉ lệ ảnh mà Search chấp nhận, theo loại đã phân lúc tải lên. */
export const SEARCH_LINKABLE_FIELD_TYPES: ImageFieldType[] = ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE"];
const SEARCH_LINKABLE = SEARCH_LINKABLE_FIELD_TYPES;

export interface SearchImagePlan {
  /** Ảnh gắn được — đã đổi sang AD_IMAGE. */
  links: Array<{ resourceName: string; fieldType: typeof SEARCH_IMAGE_FIELD_TYPE }>;
  /** Ảnh phải bỏ, kèm lý do nói được cho người dùng. */
  skipped: Array<{ label: string; reason: string }>;
}

/**
 * Chọn ra những ảnh gắn được vào campaign Search và đổi sang loại liên kết đúng.
 *
 * Trả về cả phần BỎ QUA chứ không im lặng lọc: người dùng đã chọn tấm ảnh đó,
 * nó không lên thì phải biết vì sao — chứ không phải mở Google Ads ra rồi mới
 * phát hiện thiếu.
 */
export function planSearchImageLinks(
  assets: Array<{ resourceName: string; fieldType?: string; name?: string; ratioLabel?: string; width?: number; height?: number }>,
  opts: { alreadyLinked?: number } = {},
): SearchImagePlan {
  const plan: SearchImagePlan = { links: [], skipped: [] };
  const budget = MAX_IMAGES_PER_CAMPAIGN - (opts.alreadyLinked ?? 0);
  const seen = new Set<string>();

  for (const a of assets) {
    if (!a.resourceName) continue;
    const label = a.ratioLabel || a.name || a.resourceName.split("/").pop() || "ảnh";
    const ft = a.fieldType as ImageFieldType | undefined;

    // Google: "Cannot mutate the same resource twice in one request." — và vì
    // cả lô đi chung một lệnh, một cặp trùng làm rớt hết. Dễ dính khi vừa tải
    // ảnh lên vừa chọn đúng tấm đó trong thư viện tài sản. Bỏ im lặng ở đây là
    // đúng: người dùng có ý chọn MỘT tấm ảnh, không phải hai.
    if (seen.has(a.resourceName)) continue;
    seen.add(a.resourceName);

    if (ft && SEARCH_LINKABLE.includes(ft)) {
      // Trần 20 ảnh/campaign tính CẢ ảnh đã gắn từ trước. Vượt trần thì Google
      // gạt CẢ LÔ ("The request would cause a limit ... to be exceeded"), nên
      // phải cắt ở đây chứ không để lô đi rồi mất luôn 20 ảnh hợp lệ.
      if (plan.links.length >= budget) {
        plan.skipped.push({ label, reason: `Vượt trần ${MAX_IMAGES_PER_CAMPAIGN} ảnh mỗi campaign của Google.` });
        continue;
      }
      // Kích thước tối thiểu: ảnh quá nhỏ bị Google từ chối bằng "The
      // dimensions of the image are not allowed" — và vì cả lô đi chung một
      // lệnh, một tấm favicon 32×32 lấy từ thư viện tài sản làm rớt hết.
      // Đo thật 18/09/2026: ảnh 32×32 trong tài khoản MBC → từ chối đúng câu trên.
      const spec = IMAGE_SPECS.find((s) => s.fieldType === ft);
      if (spec && a.width && a.height && (a.width < spec.minW || a.height < spec.minH)) {
        plan.skipped.push({ label, reason: `Google đòi ${spec.label} tối thiểu ${spec.minW}×${spec.minH}, ảnh này ${a.width}×${a.height}.` });
        continue;
      }
      plan.links.push({ resourceName: a.resourceName, fieldType: SEARCH_IMAGE_FIELD_TYPE });
      continue;
    }

    if (ft === "PORTRAIT_MARKETING_IMAGE") {
      plan.skipped.push({ label, reason: "Google không nhận ảnh dọc 4:5 cho quảng cáo Tìm kiếm — chỉ nhận ngang 1.91:1 và vuông 1:1. Ảnh này dùng cho Performance Max." });
    } else if (ft === "LOGO" || ft === "LANDSCAPE_LOGO") {
      plan.skipped.push({ label, reason: "Logo là tài sản của Performance Max, không phải tiện ích hình ảnh của quảng cáo Tìm kiếm." });
    } else {
      plan.skipped.push({ label, reason: `Không xác định được loại ảnh (${ft ?? "thiếu"}) — không gắn để tránh làm rớt cả lô ảnh còn lại.` });
    }
  }

  return plan;
}

/**
 * PMax đủ điều kiện phục vụ chưa?
 *
 * Google đòi nhóm tài sản có logo + ảnh ngang + ảnh vuông. Thiếu thì campaign
 * tạo ra KHÔNG chạy được lượt nào — mà Google không chặn lúc tạo, nó chỉ lặng
 * lẽ không phục vụ. Phải tự kiểm, không thì người dùng tưởng đã xong.
 */
export function checkPMaxImageCompleteness(fieldTypes: string[]): {
  ok: boolean; missing: Array<{ fieldType: ImageFieldType; label: string; recommended: string }>;
} {
  const have = new Set(fieldTypes);
  const missing = IMAGE_SPECS
    .filter((s) => s.requiredForPMax && !have.has(s.fieldType))
    .map((s) => ({ fieldType: s.fieldType, label: s.label, recommended: s.recommended }));
  return { ok: missing.length === 0, missing };
}

/** Tách phần dữ liệu khỏi chuỗi data URL của trình duyệt. */
export function decodeDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}
