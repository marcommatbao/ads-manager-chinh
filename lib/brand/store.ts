// ============================================================
// Đợt 21 A3 — Kho hồ sơ doanh nghiệp (máy chủ): data/brand-profiles.json { [mã công ty]: BrandProfile }
// ============================================================
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { companiesConfig, companyDef } from "@/lib/companies"
import type { BrandProfile } from "./types"

const FILE = () => path.join(process.cwd(), "data", "brand-profiles.json")
/** Công ty có nội dung AI gắn cứng trong mã (bản Mắt Bão) — chưa lưu hồ sơ thì giữ đúng chuỗi cũ. */
export const LEGACY_BRAND_COMPANIES = ["MBC", "MBI"]

function readAll(): Record<string, BrandProfile> { try { return JSON.parse(fs.readFileSync(FILE(), "utf-8")) as Record<string, BrandProfile> } catch { return {} } }
export const savedBrandProfile = (co: string): BrandProfile | null => readAll()[co] ?? null

/** Hồ sơ mặc định để HIỆN ở Cài đặt (chưa lưu). MBC/MBI: tóm từ nội dung đang gắn trong mã. */
export function defaultBrandProfile(co: string): BrandProfile {
  if (co === "MBC") return { company: co, brandName: "Mắt Bão", domain: "matbao.net", displayPath: "matbao net", industry: "tên miền, hosting, email, máy chủ, Microsoft 365, Google Workspace", products: [], strengths: [], persona: "Chủ doanh nghiệp SME", forbidden: [] }
  if (co === "MBI") return { company: co, brandName: "Mắt Bão Invoice", domain: "matbao.in", displayPath: "matbao in", industry: "hoá đơn điện tử, hợp đồng điện tử, chữ ký số cho doanh nghiệp", products: [], strengths: [], persona: "Kế toán / Giám đốc SME", forbidden: [] }
  const d = companyDef(co)
  return { company: co, brandName: d?.label ?? co, domain: d?.domain ?? "", displayPath: (d?.domain ?? "").replace(/\./g, " ").slice(0, 15), industry: "", products: [], strengths: [], persona: "", forbidden: [] }
}

/**
 * Hồ sơ AI phải dùng, hoặc null = dùng chuỗi cũ trong mã (MBC/MBI chưa lưu hồ sơ → bản Mắt Bão y như trước).
 * Công ty khác chưa lưu → hồ sơ mặc định từ cấu hình công ty (tên + tên miền) — không bao giờ rơi về nội dung Mắt Bão.
 */
export function brandOverride(co: string): BrandProfile | null {
  const saved = savedBrandProfile(co)
  if (saved) return saved
  return LEGACY_BRAND_COMPANIES.includes(co) ? null : defaultBrandProfile(co)
}

export async function saveBrandProfile(p: BrandProfile, actor: string, now = new Date()): Promise<BrandProfile> {
  return withFileLock(FILE(), async () => {
    const all = readAll()
    all[p.company] = { ...p, updatedAt: now.toISOString(), updatedBy: actor }
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    writeFileAtomicSync(FILE(), JSON.stringify(all, null, 1))
    return all[p.company]
  })
}

/** Tên tổ chức của bản cài (AdsBot / phân tích tự giới thiệu). Bản Mắt Bão: "Mắt Bão" như cũ. */
export function orgName(): string {
  return companiesConfig().orgName ?? "Mắt Bão"
}
