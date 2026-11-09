// ============================================================
// Đợt 21a — Danh sách công ty MẶC ĐỊNH (bản Mắt Bão). Dùng được ở cả máy chủ lẫn trình duyệt (không đọc tệp).
// ============================================================
// Mỗi bản cài khác (vd khách matbao.ws) ghi đè bằng data/companies.json — xem lib/companies/index.ts.
// Giá trị ở đây PHẢI tái tạo đúng hành vi trước Đợt 21 (đối chứng: tests/case/dot21-golden.test.ts):
//   - nhận biết công ty: mã Google → tên tài khoản Google → chữ trong tên chiến dịch → mặc định MBC;
//   - mã tích hợp đọc từ biến môi trường theo hậu tố _MBC / _MBI / _SALE_AI.
// Không ghi mã thật vào tệp: chỉ ghi TÊN biến môi trường.

export interface CompanyDef {
  /** Mã ngắn, chữ hoa/số/_ — dùng làm khoá dữ liệu, KHÔNG đổi sau khi đã có dữ liệu. */
  id: string
  label: string
  domain: string
  /** Tên màu tailwind (blue, indigo…). */
  color: string
  /** false = chỉ có pixel/GA4, không chạy quảng cáo (vd SALE_AI) — không xuất hiện trong bộ chọn công ty. */
  ads: boolean
  /** Hậu tố biến môi trường cho mã tích hợp: GOOGLE_ADS_CUSTOMER_ID_<envSuffix>, NEXT_PUBLIC_META_PIXEL_ID_<envSuffix>… */
  envSuffix: string
  match: {
    /** Tên tài khoản Google (chữ thường, khớp NGUYÊN) → công ty này. */
    googleAccountNames?: string[]
    /** Tên tài khoản Google CHỨA chuỗi (chữ thường). */
    googleAccountContains?: string[]
    /** Tên chiến dịch CHỨA chuỗi (so chữ hoa) → công ty này. */
    campaignContains?: string[]
  }
  /** Từ khoá thương hiệu / đối thủ mặc định (người dùng sửa được trong tool — data/case-lexicon.json). Trống = mặc định chung. */
  brandTerms?: string[]
  competitors?: string[]
  /** Gói tính năng riêng (Đợt 21c), vd ["matbao"]. */
  packs?: string[]
}

/**
 * Đợt 21 A2 — mô-đun của BẢN CÀI (docs/DESIGN-DOT21.md §8):
 *   marketing — lõi quản lý quảng cáo Google + Meta (luôn bật)
 *   orders    — đơn hàng & CRM: nguồn đơn, Google/Facebook học theo đơn thật, Creative theo đơn thật, chất lượng lead
 *   matbao    — riêng Mắt Bão: Odoo MBI, P&L Report API, cảnh báo đơn/lead matbao.in
 */
export type ModuleId = "marketing" | "orders" | "matbao"
export const MODULE_IDS: ModuleId[] = ["marketing", "orders", "matbao"]
export const MODULE_LABEL: Record<ModuleId, string> = { marketing: "Marketing (Google + Meta)", orders: "Đơn hàng & CRM", matbao: "Gói Mắt Bão" }

export interface CompaniesConfig {
  /** Tên tổ chức của bản cài (AdsBot / phân tích tự giới thiệu là "trợ lý của …"). Bỏ trống = "Mắt Bão" (bản gốc). */
  orgName?: string
  /** Mô-đun bật ở bản cài. Thiếu = chỉ "marketing" (bản cài mới gọn nhất). Bản Mắt Bão (mặc định) bật đủ. */
  modules?: ModuleId[]
  companies: CompanyDef[]
  /** Không khớp quy tắc nào → công ty này (bản Mắt Bão: MBC — đúng hành vi cũ). */
  fallback: string
}

export const DEFAULT_COMPANIES: CompaniesConfig = {
  modules: ["marketing", "orders", "matbao"],
  fallback: "MBC",
  companies: [
    {
      id: "MBC", label: "MBC", domain: "matbao.net", color: "blue", ads: true, envSuffix: "MBC",
      match: { googleAccountNames: ["mắt bão - vnd", "mat bao - vnd", "matbao - vnd"] },
      packs: ["matbao"],
    },
    {
      id: "MBI", label: "MBI", domain: "matbao.in", color: "indigo", ads: true, envSuffix: "MBI",
      match: { googleAccountNames: ["mifi active", "mifi"], googleAccountContains: ["mifi"], campaignContains: ["MBI"] },
      packs: ["matbao"],
    },
    { id: "SALE_AI", label: "Sale.AI", domain: "sale.ai.vn", color: "emerald", ads: false, envSuffix: "SALE_AI", match: {} },
  ],
}

export const COMPANY_ID_RE = /^[A-Z][A-Z0-9_]{1,15}$/

/** Kiểm cấu hình — HÀM THUẦN. Trả lỗi đọc được, rỗng = hợp lệ. */
export function validateCompanies(c: CompaniesConfig): string[] {
  const errs: string[] = []
  const ids = new Set<string>()
  if (!Array.isArray(c.companies) || !c.companies.length) return ["Chưa khai báo công ty nào"]
  for (const x of c.companies) {
    if (!COMPANY_ID_RE.test(String(x.id))) errs.push(`Mã công ty "${x.id}" không hợp lệ (chữ hoa/số/_, 2–16 ký tự, bắt đầu bằng chữ)`)
    if (ids.has(x.id)) errs.push(`Mã công ty "${x.id}" bị trùng`)
    ids.add(x.id)
    if (!x.label) errs.push(`Công ty ${x.id} thiếu tên`)
    if (!/^[A-Z0-9_]{1,16}$/.test(String(x.envSuffix ?? ""))) errs.push(`Công ty ${x.id}: envSuffix không hợp lệ`)
  }
  if (!c.companies.some((x) => x.ads)) errs.push("Phải có ít nhất một công ty chạy quảng cáo (ads: true)")
  if (!ids.has(c.fallback)) errs.push(`fallback "${c.fallback}" không có trong danh sách`)
  if (c.modules !== undefined) {
    if (!Array.isArray(c.modules)) errs.push("modules phải là danh sách")
    else for (const m of c.modules) if (!MODULE_IDS.includes(m)) errs.push(`Mô-đun "${m}" không có (dùng: ${MODULE_IDS.join(", ")})`)
  }
  return errs
}
