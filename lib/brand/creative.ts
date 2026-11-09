// ============================================================
// Đợt 21 A3b — Creative AI theo hồ sơ thương hiệu của TỪNG công ty (chỉ máy chủ)
// ============================================================
// Công ty gói Mắt Bão (MBC / MBI — packs "matbao") → `legacy: true`: trang Creative + các API AI giữ NGUYÊN cách cũ
// (danh sách sản phẩm cố định, kho kiến thức lib/products-knowledge.ts, gợi ý USP…). Kể cả khi đã lưu hồ sơ cho MBC/MBI,
// Creative vẫn đi đường cũ — bản Mắt Bão không đổi.
// Công ty khác (bản cài khách) → `legacy: false`: CHỈ dùng hồ sơ ở Cài đặt → Hồ sơ doanh nghiệp. Không bao giờ dùng sản phẩm,
// persona, đối thủ, câu mẫu hay tên miền của Mắt Bão. Chưa lưu hồ sơ → danh sách sản phẩm rỗng (giao diện nhắc đi điền hồ sơ).

import { hasPack, companyDef } from "@/lib/companies"
import { brandOverride, defaultBrandProfile } from "./store"
import { brandPromptBlock, type BrandProfile } from "./types"

export interface CreativeProduct { id: string; label: string; description?: string; url?: string }
export interface CreativeBrand {
  company: string
  legacy: boolean
  /** true = đã lưu hồ sơ (chỉ có nghĩa khi legacy=false). */
  hasProfile: boolean
  brandName: string
  domain: string
  persona: string
  strengths: string[]
  tone?: string
  forbidden: string[]
  products: CreativeProduct[]
}

export const isLegacyCreativeCompany = (company: string): boolean => hasPack(company, "matbao")

/** Mã sản phẩm theo hồ sơ — cùng quy ước `custom_<tên>` với lib/brand/catalog.ts và trang Creative. */
export const profileProductId = (name: string): string => `custom_${name}`

function profileOf(company: string): { p: BrandProfile; saved: boolean } {
  const o = brandOverride(company)
  return o ? { p: o, saved: !!o.updatedAt } : { p: defaultBrandProfile(company), saved: false }
}

export function creativeBrandFor(company: string): CreativeBrand {
  const legacy = isLegacyCreativeCompany(company)
  const { p, saved } = profileOf(company)
  return {
    company, legacy, hasProfile: saved,
    brandName: p.brandName || companyDef(company)?.label || company,
    domain: p.domain || companyDef(company)?.domain || "",
    persona: p.persona ?? "", strengths: p.strengths ?? [], tone: p.tone, forbidden: p.forbidden ?? [],
    products: legacy ? [] : (p.products ?? []).filter((x) => x.name?.trim()).map((x) => ({ id: profileProductId(x.name.trim()), label: x.name.trim(), description: x.description, url: x.url })),
  }
}

/** Khối thương hiệu cho lời nhắc AI. Công ty gói Mắt Bão → "" (lời nhắc cũ giữ nguyên từng chữ). */
export function creativeBrandPrompt(company: string | undefined | null): string {
  if (!company || isLegacyCreativeCompany(company)) return ""
  const { p } = profileOf(company)
  const block = brandPromptBlock(p)
  const name = p.brandName || companyDef(company)?.label || company
  return `\n\nTHƯƠNG HIỆU ĐANG QUẢNG CÁO: ${name}${p.domain ? ` (${p.domain})` : ""}${p.industry ? ` — ngành: ${p.industry}` : ""}
${block}
CHỈ viết cho thương hiệu này. KHÔNG nhắc tới Mắt Bão, MIFI, tên miền, hosting hay bất kỳ sản phẩm / con số / khách hàng nào không có trong hồ sơ trên (trừ khi chính hồ sơ có).`
}

/** Mô tả sản phẩm theo hồ sơ cho mã `custom_<tên>` (null = không phải sản phẩm của hồ sơ công ty này). */
export function profileProduct(company: string, productId: string): CreativeProduct | null {
  return creativeBrandFor(company).products.find((x) => x.id === productId || x.label === productId.replace(/^custom_/, "")) ?? null
}
