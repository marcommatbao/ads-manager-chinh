// ============================================================
// Đợt 21 A6 — Ghi data/companies.json từ trình thiết lập (CHỈ máy chủ)
// ============================================================
// Chỉ gọi từ /api/setup/companies (super_admin + SETUP_WIZARD=on). Bản Mắt Bão không bật trình thiết lập → không bao giờ ghi.
// An toàn dữ liệu:
//   - nhận ĐÚNG các trường cho phép (không nhận packs / mô-đun "matbao" — gói riêng Mắt Bão không bật được từ giao diện);
//   - sau khi đã hoàn tất thiết lập, KHÔNG được xoá / đổi mã công ty đang có (mã là khoá của mọi dữ liệu đã lưu);
//   - giữ bản sao tệp cũ data/companies.json.bak-<thời điểm> trước khi ghi; ghi nguyên tử. Bộ nạp tự đọc lại theo mtime.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { COMPANY_ID_RE, validateCompanies, type CompaniesConfig, type CompanyDef, type ModuleId } from "./defaults"

export const WIZARD_MODULES: ModuleId[] = ["marketing", "orders"]
export const WIZARD_COLORS = ["blue", "indigo", "emerald", "teal", "violet", "rose", "amber", "orange", "cyan", "slate"]

const FILE = () => path.join(process.cwd(), "data", "companies.json")
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const strList = (v: unknown, lower = false, max = 30) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [])
    .map((x) => str(x, 80)).filter(Boolean).map((x) => (lower ? x.toLowerCase() : x)).slice(0, max)

export interface WizardCompanyInput {
  id?: unknown; label?: unknown; domain?: unknown; color?: unknown
  googleAccountNames?: unknown; campaignContains?: unknown; brandTerms?: unknown; competitors?: unknown
}
export interface WizardCompaniesInput { orgName?: unknown; modules?: unknown; fallback?: unknown; companies?: unknown }

/** Dựng cấu hình từ dữ liệu người dùng gửi — HÀM THUẦN. */
export function buildWizardConfig(input: WizardCompaniesInput): CompaniesConfig {
  const list = Array.isArray(input.companies) ? (input.companies as WizardCompanyInput[]).slice(0, 10) : []
  const companies: CompanyDef[] = list.map((c) => {
    const id = str(c.id, 16).toUpperCase()
    const color = str(c.color, 20)
    const def: CompanyDef = {
      id, label: str(c.label, 60), domain: str(c.domain, 120).replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase(),
      color: WIZARD_COLORS.includes(color) ? color : "blue", ads: true, envSuffix: id, match: {},
    }
    const names = strList(c.googleAccountNames, true), camp = strList(c.campaignContains).map((x) => x.toUpperCase())
    if (names.length) def.match.googleAccountNames = names
    if (camp.length) def.match.campaignContains = camp
    const brand = strList(c.brandTerms, true), comp = strList(c.competitors, true)
    if (brand.length) def.brandTerms = brand
    if (comp.length) def.competitors = comp
    return def
  })
  const mods = Array.isArray(input.modules) ? (input.modules as unknown[]).filter((m): m is ModuleId => WIZARD_MODULES.includes(m as ModuleId)) : []
  const fallback = str(input.fallback, 16).toUpperCase()
  const orgName = str(input.orgName, 80)
  return {
    ...(orgName ? { orgName } : {}),
    modules: ["marketing", ...mods.filter((m) => m !== "marketing")],
    fallback: companies.some((c) => c.id === fallback) ? fallback : companies[0]?.id ?? "",
    companies,
  }
}

/** Mã công ty đang có trong data/companies.json (rỗng nếu chưa có tệp / tệp hỏng). */
export function savedCompanyIds(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8")) as CompaniesConfig
    return Array.isArray(raw?.companies) ? raw.companies.map((c) => String(c.id)).filter((id) => COMPANY_ID_RE.test(id)) : []
  } catch { return [] }
}

export function companiesFileExists(): boolean {
  try { return fs.statSync(FILE()).isFile() } catch { return false }
}

function pruneBackups(f: string, keep: number): void {
  try {
    const dir = path.dirname(f), base = path.basename(f) + ".bak-"
    const olds = fs.readdirSync(dir).filter((n) => n.startsWith(base)).sort().reverse().slice(keep)
    for (const n of olds) fs.rmSync(path.join(dir, n), { force: true })
  } catch { /* không xoá được bản cũ thì thôi — không chặn việc lưu */ }
}

/** Kiểm + ghi. `lockIds` = đã hoàn tất thiết lập → không được bỏ mã công ty nào đang có. Trả lỗi (rỗng = đã ghi). */
export function saveWizardCompanies(cfg: CompaniesConfig, opts: { lockIds: boolean }): string[] {
  const errs = validateCompanies(cfg)
  if (cfg.companies.some((c) => !c.domain)) errs.push("Mỗi công ty cần tên miền website")
  if (opts.lockIds) {
    const gone = savedCompanyIds().filter((id) => !cfg.companies.some((c) => c.id === id))
    if (gone.length) errs.push(`Không được xoá / đổi mã công ty đã có dữ liệu: ${gone.join(", ")}`)
  }
  if (errs.length) return errs
  const f = FILE()
  if (companiesFileExists()) fs.copyFileSync(f, `${f}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  pruneBackups(f, 10) // soát bảo mật 03/10: giữ 10 bản gần nhất, không để bản sao tăng vô hạn
  writeFileAtomicSync(f, JSON.stringify(cfg, null, 2))
  return []
}
