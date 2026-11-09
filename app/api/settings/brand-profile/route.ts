// Đợt 21 A3 — Hồ sơ doanh nghiệp cho AI.
// GET ?company=          — hồ sơ đã lưu, hoặc mặc định (chưa lưu). `legacy` = MBC/MBI chưa lưu → AI đang dùng nội dung cũ trong mã.
// PUT {company, profile} — lưu (cần quyền sửa + quyền công ty). Lưu rồi thì AI dùng hồ sơ cho công ty đó.
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { BRAND_LIMITS, normalizeBrandProfile } from "@/lib/brand/types"
import { defaultBrandProfile, LEGACY_BRAND_COMPANIES, saveBrandProfile, savedBrandProfile } from "@/lib/brand/store"
import { allCompanyDefs, hasPack } from "@/lib/companies"
import { catalogOf, type CompanyInfo } from "@/lib/case/product-catalog"
import { companyInfo } from "@/lib/case/targets"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  const saved = savedBrandProfile(co.value)
  // 19/10: xem trước tool hiểu gì là thương hiệu / dịch vụ. Gói Mắt Bão dùng bảng cố định; công ty khác dựng từ hồ sơ.
  const fixed = hasPack(co.value, "matbao") ? catalogOf(co.value) ?? null : null
  const others = allCompanyDefs().filter((c) => c.id !== co.value).map((c) => companyInfo(c.id)).filter((x): x is CompanyInfo => !!x)
    // chỉ cần thương hiệu + sản phẩm của công ty khác
    .map((o) => ({ id: o.id, label: o.label, domain: o.domain, brandTerms: o.brandTerms, brandName: o.brandName, industry: o.industry, products: o.products }))
  return NextResponse.json({
    lexicon: { fixed, self: companyInfo(co.value), others },
    success: true, profile: saved ?? defaultBrandProfile(co.value), saved: !!saved,
    legacy: !saved && LEGACY_BRAND_COMPANIES.includes(co.value), limits: BRAND_LIMITS, canEdit: hasPermission(u.value.role, "can_edit"),
  })
}

export async function PUT(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; profile?: unknown }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  try {
    const n = normalizeBrandProfile(co.value, b.profile)
    if (!n.profile) return NextResponse.json({ success: false, error: n.errors.join(" · ") }, { status: 400 })
    return NextResponse.json({ success: true, profile: await saveBrandProfile(n.profile, actorOf(u.value)) })
  } catch (e) { return fail(e) }
}
