// ============================================================
// Mục tiêu theo sản phẩm + từ điển thương hiệu/đối thủ — lưu trong data/
// ============================================================
// Số tiền là thông tin kinh doanh → KHÔNG nằm trong mã (repo sẽ công khai,
// cùng lý do CPL_TARGETS_JSON ra env). Người có quyền `can_edit_thresholds`
// đặt ở màn "Mục tiêu theo sản phẩm". Thiếu thì trả null — màn tổng quan ghi
// "chưa đặt mục tiêu", không đoán.
// Tên thương hiệu đối thủ là thông tin công khai nên có mặc định trong mã.

import fs from "fs"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { withFileLock } from "@/lib/file-lock"
import { DEFAULT_BRAND, DEFAULT_COMPETITORS, type IntentLexicon } from "./intent"
import { catalogOf, deriveCatalog, type CompanyInfo, type ProductCatalog } from "./product-catalog"
import { allCompanyDefs } from "@/lib/companies/registry"
import { savedBrandProfile } from "@/lib/brand/store"
import { companyDef, hasPack } from "@/lib/companies/registry"
import type { ProductGroup } from "./product"
import type { Company } from "./types"
import type { CaseTarget, TargetBasis } from "./verdict"
import { isCompany } from "@/lib/companies/registry";

const TARGETS_FILE = path.join(process.cwd(), "data", "case-targets.json")
const LEXICON_FILE = path.join(process.cwd(), "data", "case-lexicon.json")

export interface TargetRow extends Omit<CaseTarget, "basis"> {
  /** Dòng mục tiêu chỉ chấm bán hàng (cpa/roas); CPL nằm ở cplTarget/cplCeiling. */
  basis: TargetBasis
  company: Company
  group: ProductGroup
  /** Giá trị đơn trung bình dùng để đề xuất mục tiêu (tham khảo, không dùng để chấm). */
  aov?: number | null
  /** Đợt 23 (3a): ngưỡng CHI PHÍ MỖI LEAD cho chiến dịch thu lead của nhóm này — bỏ trống = chưa đặt (dùng ngưỡng cũ của từng nơi).
   *  Dòng có thể CHỈ có CPL (target/ceiling = 0: chưa đặt mục tiêu bán hàng). */
  cplTarget?: number | null
  cplCeiling?: number | null
  updatedBy: string
  updatedAt: string
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T
  } catch (err) {
    console.error(`[case-targets] không đọc được ${path.basename(file)}:`, err)
    return fallback
  }
}
function writeJson(file: string, data: unknown) {
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  writeFileAtomicSync(file, JSON.stringify(data, null, 2))
}

export function listTargets(): TargetRow[] {
  const rows = readJson<TargetRow[]>(TARGETS_FILE, [])
  return Array.isArray(rows) ? rows : []
}

/** Mục tiêu của (công ty, nhóm); không có thì lấy (công ty, DEFAULT); vẫn không có → null. */
export function targetFor(company: Company, group: ProductGroup): CaseTarget | null {
  const rows = listTargets().filter((r) => Number(r.target) > 0 && Number(r.ceiling) > 0) // Đợt 23: dòng chỉ có CPL không phải mục tiêu bán hàng
  const hit = rows.find((r) => r.company === company && r.group === group)
    ?? rows.find((r) => r.company === company && r.group === "DEFAULT")
  return hit ? { basis: hit.basis, target: hit.target, ceiling: hit.ceiling } : null
}

export function validateTarget(t: Partial<TargetRow>, tr: TFunction = makeT("vi")): string | null {
  if (!isCompany(t.company)) return tr("libcase.c.target.company")
  if (!t.group) return tr("libcase.c.target.group")
  if (t.basis !== "cpa" && t.basis !== "roas") return tr("libcase.c.target.basis")
  const target = Number(t.target), ceiling = Number(t.ceiling)
  // Đợt 23 (3a): CPL cho chiến dịch thu lead — tuỳ chọn, nhưng đã điền thì đủ cả hai và mục tiêu ≤ trần.
  const hasCpl = t.cplTarget != null || t.cplCeiling != null
  if (hasCpl) {
    const ct = Number(t.cplTarget), cc = Number(t.cplCeiling)
    if (!(ct > 0) || !(cc > 0)) return tr("libcase.c.target.cplPos")
    if (ct > cc) return tr("libcase.c.target.cplOrder")
  }
  // Dòng chỉ đặt CPL (chưa có mục tiêu bán hàng) → hợp lệ.
  if (hasCpl && !(target > 0) && !(ceiling > 0)) return null
  if (!(target > 0) || !(ceiling > 0)) return tr("libcase.c.target.pos")
  if (t.basis === "cpa" && target > ceiling) return tr("libcase.c.target.cpaOrder")
  if (t.basis === "roas" && target < ceiling) return tr("libcase.c.target.roasOrder")
  return null
}

export async function saveTargets(rows: Omit<TargetRow, "updatedBy" | "updatedAt">[], actor: string): Promise<void> {
  await withFileLock(TARGETS_FILE, async () => {
    const now = new Date().toISOString()
    const cur = listTargets()
    for (const r of rows) {
      const i = cur.findIndex((x) => x.company === r.company && x.group === r.group)
      const cpl = r.cplTarget != null && r.cplCeiling != null ? { cplTarget: Number(r.cplTarget), cplCeiling: Number(r.cplCeiling) } : { cplTarget: null, cplCeiling: null }
      const next: TargetRow = { ...r, target: Number(r.target) || 0, ceiling: Number(r.ceiling) || 0, ...cpl, updatedBy: actor, updatedAt: now }
      if (i >= 0) cur[i] = next
      else cur.push(next)
    }
    writeJson(TARGETS_FILE, cur)
  })
}

export function lexiconFor(company: Company): IntentLexicon {
  const all = readJson<Partial<Record<Company, Partial<IntentLexicon>>>>(LEXICON_FILE, {})
  const x = all[company] ?? {}
  // 19/10: gói Mắt Bão phân biệt sản phẩm MBC (matbao.net) ↔ MBI (matbao.in) — xem lib/case/product-catalog.ts.
  // Công ty khác (bản cài khách): dựng từ cấu hình công ty + Hồ sơ doanh nghiệp; công ty cùng bản cài là "công ty anh em".
  const cat = hasPack(company, "matbao") ? catalogOf(company) : catalogForCustomer(company)
  return {
    catalog: cat,
    // Đợt 21a: mặc định theo công ty của bản cài (brandTerms/competitors), không có thì mặc định chung (Mắt Bão).
    // Đợt 21 B: mặc định chung (matbao / đối thủ hoá đơn điện tử) CHỈ cho công ty gói Mắt Bão — công ty bản cài khách để trống.
    brand: x.brand?.length ? x.brand : companyDef(company)?.brandTerms?.length ? companyDef(company)!.brandTerms! : cat?.brand.length ? cat.brand : hasPack(company, "matbao") ? DEFAULT_BRAND : [],
    competitors: x.competitors?.length ? x.competitors : companyDef(company)?.competitors?.length ? companyDef(company)!.competitors! : cat?.competitors.length ? cat.competitors : hasPack(company, "matbao") ? DEFAULT_COMPETITORS : [],
  }
}

/** Thông tin công ty để dựng bảng thương hiệu/sản phẩm — cấu hình công ty + Hồ sơ doanh nghiệp ĐÃ LƯU. */
export function companyInfo(id: string): CompanyInfo | null {
  const d = allCompanyDefs().find((c) => c.id === id)
  if (!d) return null
  const p = savedBrandProfile(id)
  return { id, label: d.label, domain: p?.domain || d.domain, brandTerms: d.brandTerms, competitors: d.competitors,
    brandName: p?.brandName, industry: p?.industry, products: (p?.products ?? []).map((x) => x.name).filter(Boolean) }
}

function catalogForCustomer(company: Company): ProductCatalog | undefined {
  const self = companyInfo(company)
  if (!self) return undefined
  const others = allCompanyDefs().filter((c) => c.id !== company).map((c) => companyInfo(c.id)).filter((x): x is CompanyInfo => !!x)
  return deriveCatalog(self, others)
}
