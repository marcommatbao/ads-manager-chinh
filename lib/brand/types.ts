// ============================================================
// Đợt 21 A3 — Hồ sơ doanh nghiệp cho AI (dùng được cả máy chủ lẫn trình duyệt)
// ============================================================
// AI viết quảng cáo (PMax asset/theme, quảng cáo Google, Creative) và trợ lý AdsBot đọc hồ sơ này thay cho nội dung Mắt Bão
// gắn cứng trong mã. QUY TẮC giữ bản Mắt Bão y như cũ: MBC/MBI CHƯA lưu hồ sơ → AI dùng đúng chuỗi cũ trong mã;
// đã lưu (hoặc công ty của bản cài khác) → dùng hồ sơ. Xem lib/brand/store.ts brandOverride().

export interface BrandProduct { name: string; description?: string; url?: string }

export interface BrandProfile {
  company: string
  /** Tên thương hiệu dùng trong quảng cáo, vd "Mắt Bão". */
  brandName: string
  domain: string
  /** Đường dẫn hiển thị quảng cáo Search (≤ 15 ký tự), vd "matbao net". */
  displayPath?: string
  /** Ngành / nhóm sản phẩm, vd "tên miền, hosting, email, máy chủ". */
  industry: string
  /** 1–2 câu giới thiệu. */
  description?: string
  products: BrandProduct[]
  /** Điểm mạnh / cam kết CÓ THẬT. AI chỉ được dùng đúng các ý này — không tự thêm con số, khuyến mãi. */
  strengths: string[]
  /** Khách hàng mục tiêu, vd "Chủ doanh nghiệp SME". */
  persona: string
  /** Giọng văn, vd "chuyên nghiệp, gần gũi". */
  tone?: string
  /** Điều KHÔNG được nói (vd "không hứa miễn phí", "không so sánh tên đối thủ"). */
  forbidden: string[]
  updatedAt?: string
  updatedBy?: string
}

export const BRAND_LIMITS = { brandName: 60, domain: 100, displayPath: 15, industry: 200, description: 400, productName: 80, productDesc: 200, url: 300, line: 150, persona: 150, tone: 100, maxProducts: 20, maxLines: 15 }

/** Kiểm + chuẩn hoá hồ sơ người dùng gửi — HÀM THUẦN. Trả lỗi đọc được. */
export function normalizeBrandProfile(company: string, x: unknown): { profile?: BrandProfile; errors: string[] } {
  const L = BRAND_LIMITS, e: string[] = []
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const str = (k: string, max: number, req = false) => {
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : ""
    if (req && !v) e.push(`Thiếu ${k}`)
    if (v.length > max) e.push(`${k} quá ${max} ký tự`)
    return v.slice(0, max)
  }
  const lines = (k: string) => {
    const a = Array.isArray(o[k]) ? (o[k] as unknown[]) : []
    if (a.length > L.maxLines) e.push(`${k}: tối đa ${L.maxLines} dòng`)
    return a.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean).slice(0, L.maxLines).map((s) => s.slice(0, L.line))
  }
  const url = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return /^https:\/\/[^\s]+$/.test(s) ? s.slice(0, L.url) : "" }
  const prodsRaw = Array.isArray(o.products) ? (o.products as unknown[]) : []
  if (prodsRaw.length > L.maxProducts) e.push(`Tối đa ${L.maxProducts} sản phẩm`)
  const products: BrandProduct[] = prodsRaw.slice(0, L.maxProducts).map((p) => (p && typeof p === "object" ? p as Record<string, unknown> : {})).map((p) => ({
    name: String(p.name ?? "").trim().slice(0, L.productName),
    ...(String(p.description ?? "").trim() ? { description: String(p.description).trim().slice(0, L.productDesc) } : {}),
    ...(url(p.url) ? { url: url(p.url) } : {}),
  })).filter((p) => p.name)
  for (const p of prodsRaw) { const u = (p as Record<string, unknown>)?.url; if (typeof u === "string" && u.trim() && !url(u)) e.push(`URL sản phẩm phải bắt đầu bằng https:// (${u.slice(0, 40)})`) }
  const domain = str("domain", L.domain, true).replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) e.push("Tên miền không hợp lệ (vd matbao.ws)")
  const profile: BrandProfile = {
    company, brandName: str("brandName", L.brandName, true), domain,
    ...(str("displayPath", L.displayPath) ? { displayPath: str("displayPath", L.displayPath) } : {}),
    industry: str("industry", L.industry, true),
    ...(str("description", L.description) ? { description: str("description", L.description) } : {}),
    products, strengths: lines("strengths"), persona: str("persona", L.persona, true),
    ...(str("tone", L.tone) ? { tone: str("tone", L.tone) } : {}),
    forbidden: lines("forbidden"),
  }
  return e.length ? { errors: e } : { profile, errors: [] }
}

/** Khối nhắc AI từ hồ sơ (điểm mạnh có thật, giọng văn, điều cấm) — HÀM THUẦN. Rỗng nếu hồ sơ không có gì thêm. */
export function brandPromptBlock(p: BrandProfile): string {
  const out: string[] = []
  if (p.description) out.push(`Giới thiệu: ${p.description}`)
  if (p.products.length) out.push(`Sản phẩm/dịch vụ: ${p.products.map((x) => x.description ? `${x.name} (${x.description})` : x.name).join("; ")}`)
  if (p.strengths.length) out.push(`Điểm mạnh CÓ THẬT (chỉ dùng đúng các ý này, KHÔNG tự thêm con số / khuyến mãi / cam kết khác): ${p.strengths.join("; ")}`)
  if (p.persona) out.push(`Khách hàng mục tiêu: ${p.persona}`)
  if (p.tone) out.push(`Giọng văn: ${p.tone}`)
  if (p.forbidden.length) out.push(`TUYỆT ĐỐI KHÔNG: ${p.forbidden.join("; ")}`)
  return out.join("\n")
}
