// ============================================================
// Campaign name → Ad Product mapping (NGUỒN SỰ THẬT DUY NHẤT)
// ------------------------------------------------------------
// Dùng cho khu vực "Chi phí Quảng Cáo Từng Sản Phẩm" (granular)
// VÀ để gom chi phí về nhóm doanh thu Odoo (revenueKey) cho bảng
// "Hiệu suất theo sản phẩm".
//
// THÊM CAMPAIGN MỚI: sửa biến môi trường AD_PRODUCTS_JSON rồi deploy lại
// (không còn sửa mã — xem khối giải thích ở dưới). Thứ tự QUAN TRỌNG —
// first-match-wins, đặt rule cụ thể TRƯỚC rule chung.
//
// So khớp KHÔNG phân biệt dấu/hoa-thường: tên campaign được normalize
// (bỏ dấu tiếng Việt + uppercase + gộp space + bỏ prefix "MBC -"/"MBI -")
// nên "MBC - TÊN MIỀN", "Chứ Ký Số", "Chữ Ký Số" đều khớp đúng.
// ============================================================

export type Company = string;

export interface AdProduct {
  key: string;          // slug ổn định (id nội bộ)
  label: string;        // hiển thị, vd "Tên miền"
  company: Company;
  icon: string;
  /** Nhóm doanh thu Odoo tương ứng (để vá cột Chi phí QC bảng trên). null = không có category doanh thu. */
  revenueKey: string | null;
  /** Các chuỗi khớp, đã ở dạng normalize (bỏ dấu, UPPERCASE). first-match-wins theo thứ tự mảng. */
  match: string[];
}

// ── Normalize: bỏ dấu tiếng Việt + uppercase + gộp space ─────
export function normalize(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // bỏ dấu thanh (combining marks)
    .replace(/đ/gi, "D")              // đ/Đ → D
    .toUpperCase()
    .replace(/[-_]+/g, " ")          // gạch nối/underscore → space (Matbao-Sign, Search-Domain)
    .replace(/\s+/g, " ")
    .trim();
}

/** Bỏ prefix "MBC -" / "MBI -" (đã normalize) để chỉ còn phần tên sản phẩm. */
function stripCompanyPrefix(normalized: string): string {
  return normalized.replace(/^MB[CI]\s*-?\s*/, "").trim();
}

// ── Bảng mapping — ĐỌC TỪ BIẾN MÔI TRƯỜNG ───────────────────
//
// Đổi 17/09/2026: danh mục chuyển từ mã sang biến `AD_PRODUCTS_JSON`.
//
// Vì sao: repo này sẽ ở trạng thái công khai. Bảng này không phải khoá bí mật,
// nhưng đọc nó là biết đủ danh mục sản phẩm Mắt Bão đang chạy quảng cáo, cách
// đặt tên campaign nội bộ, và sản phẩm nào được nối với nhóm doanh thu nào
// trên ERP. Đó là bản đồ chiến lược, không nên để mở.
//
// Định dạng: mảng JSON, THỨ TỰ GIỮ NGUYÊN (first-match-wins), mỗi phần tử:
//   { "key": "ten-mien", "label": "Tên miền", "company": "MBC",
//     "icon": "🌐", "revenueKey": "ten-mien", "match": ["TEN MIEN", "DOMAIN"] }
//
// Hai luật đã rút ra từ thực tế, ai sửa biến này phải giữ:
//   1. THỨ TỰ QUAN TRỌNG — đặt rule cụ thể TRƯỚC rule chung, vì so khớp dùng
//      `includes`. Rule chung đứng trước sẽ ăn hết campaign của rule cụ thể.
//   2. `revenueKey` chỉ đặt khi đã XÁC MINH trên ERP rằng nhóm doanh thu đó
//      đúng là của sản phẩm này. Gán bừa một revenueKey làm lệch bảng "Hiệu
//      suất theo sản phẩm" theo cả hai chiều: sản phẩm này được cộng thêm tiền
//      không phải của nó, sản phẩm kia bị hụt đúng số đó. Chưa chắc thì để
//      `null` — khi đó vẫn theo dõi được CHI PHÍ, chỉ không ghép doanh thu.
//
// Thiếu biến / JSON vỡ → danh mục RỖNG và ghi log. CỐ Ý không để bảng thật làm
// giá trị dự phòng (để vậy thì bảng vẫn nằm trong repo). Khi rỗng, khu vực
// "Chi phí Quảng Cáo Từng Sản Phẩm" không có dòng nào — hỏng thấy được, thay
// vì gom chi phí vào sai sản phẩm mà không ai biết.

const VALID_COMPANIES = new Set<Company>(companyIds());

function loadAdProducts(): AdProduct[] {
  const raw = process.env.AD_PRODUCTS_JSON;
  if (!raw || !raw.trim()) {
    console.warn(
      "[ad-product-mapping] Thiếu AD_PRODUCTS_JSON — danh mục sản phẩm quảng cáo RỖNG. " +
      "Khu vực 'Chi phí Quảng Cáo Từng Sản Phẩm' sẽ không có dòng nào."
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[ad-product-mapping] AD_PRODUCTS_JSON không phải JSON hợp lệ:", err instanceof Error ? err.message : err);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[ad-product-mapping] AD_PRODUCTS_JSON phải là một MẢNG JSON, nhận được:", typeof parsed);
    return [];
  }

  const out: AdProduct[] = [];
  const seenKeys = new Set<string>();

  parsed.forEach((item, idx) => {
    const e = item as Record<string, unknown>;
    const key = typeof e.key === "string" ? e.key.trim() : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    const company = e.company as Company;
    const match = Array.isArray(e.match)
      // normalize() ngay khi nạp: người sửa biến gõ "Tên miền" có dấu vẫn khớp,
      // không phải tự nhớ luật "phải viết dạng đã bỏ dấu + in hoa".
      // normalize() lũy đẳng nên chuỗi đã chuẩn đi qua không đổi.
      ? e.match.filter((m): m is string => typeof m === "string" && m.trim() !== "").map(normalize)
      : [];

    const problems: string[] = [];
    if (!key) problems.push("thiếu 'key'");
    if (!label) problems.push("thiếu 'label'");
    if (!VALID_COMPANIES.has(company)) problems.push(`'company' phải là MBC hoặc MBI (nhận '${String(e.company)}')`);
    if (match.length === 0) problems.push("'match' phải là mảng chuỗi không rỗng");
    if (key && seenKeys.has(key)) problems.push(`'key' trùng với dòng trước`);

    if (problems.length > 0) {
      // BỎ dòng lỗi chứ không vá tạm: một dòng thiếu 'match' mà vẫn nạp sẽ
      // hiện trong giao diện như sản phẩm luôn 0đ — người xem tưởng không tiêu
      // đồng nào, trong khi thật ra chi phí đang rơi vào sản phẩm khác.
      console.error(`[ad-product-mapping] Bỏ dòng ${idx} của AD_PRODUCTS_JSON: ${problems.join("; ")}`);
      return;
    }

    seenKeys.add(key);
    out.push({
      key,
      label,
      company,
      icon: typeof e.icon === "string" ? e.icon : "",
      revenueKey: typeof e.revenueKey === "string" && e.revenueKey.trim() !== "" ? e.revenueKey.trim() : null,
      match,
    });
  });

  if (out.length === 0) {
    console.error("[ad-product-mapping] AD_PRODUCTS_JSON đọc được nhưng KHÔNG có dòng nào hợp lệ.");
  }
  return out;
}

export const AD_PRODUCTS: AdProduct[] = loadAdProducts();

/** true = đã cấu hình danh mục. Giao diện dùng để hiện "chưa cấu hình" thay vì bảng rỗng vô nghĩa. */
export function adProductsConfigured(): boolean {
  return AD_PRODUCTS.length > 0;
}

/**
 * Khớp 1 campaign → AdProduct (theo company đã biết).
 * @param campaignName tên campaign gốc (chưa normalize)
 * @param company      MBC | MBI (đã suy từ detectCompany)
 * @returns AdProduct hoặc null nếu không khớp rule nào.
 */
export function matchAdProduct(campaignName: string, company: Company): AdProduct | null {
  const full = normalize(campaignName);
  const body = stripCompanyPrefix(full);
  for (const p of AD_PRODUCTS) {
    if (p.company !== company) continue;
    if (p.match.some(m => body.includes(m) || full.includes(m))) return p;
  }
  return null;
}

/** Danh sách sản phẩm quảng cáo theo company (giữ nguyên thứ tự khai báo). */
export function adProductsForCompany(company: Company): AdProduct[] {
  return AD_PRODUCTS.filter(p => p.company === company);
}

import { companyIds } from "@/lib/companies"