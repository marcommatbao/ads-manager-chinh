// ============================================================
// Đợt 21a — Sổ công ty đang dùng (KHÔNG đọc tệp → dùng được cả máy chủ lẫn trình duyệt).
// ============================================================
// Mặc định = lib/companies/defaults.ts (bản Mắt Bão). Máy chủ: lib/companies/index.ts đọc data/companies.json rồi nạp vào đây
// (instrumentation nạp lúc khởi động; mỗi lần gọi ở máy chủ kiểm tệp có đổi không). Trình duyệt: nạp qua /api/companies.

import { DEFAULT_COMPANIES, type CompaniesConfig, type CompanyDef, type ModuleId } from "./defaults"

// Trạng thái để trên globalThis: Next có thể nhân bản module này giữa các gói route của máy chủ — mọi bản sao trong CÙNG
// tiến trình phải thấy cùng cấu hình (nếu không, route chỉ import sổ này sẽ âm thầm dùng mặc định Mắt Bão).
const G = globalThis as unknown as { __adsCompanies?: { current: CompaniesConfig; refresh: (() => void) | null }; __adsCompaniesVer?: number }
const st = () => (G.__adsCompanies ??= { current: DEFAULT_COMPANIES, refresh: null })

/** Máy chủ đăng ký hàm đọc lại tệp (so mtime) — gọi trước mỗi lần tra. */
export function registerCompaniesRefresh(fn: () => void) { st().refresh = fn }
export function setCompaniesConfig(c: CompaniesConfig) { st().current = c; G.__adsCompaniesVer = (G.__adsCompaniesVer ?? 0) + 1; for (const l of listeners) l() }
const listeners = new Set<() => void>()
/** Giao diện: nghe khi danh sách công ty được nạp từ /api/companies. */
export function subscribeCompanies(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }
const cfg = (): CompaniesConfig => { st().refresh?.(); return st().current }

export const companiesConfig = (): CompaniesConfig => cfg()
/** Mọi công ty khai báo (kể cả chỉ có pixel/GA4). */
export const allCompanyDefs = (): CompanyDef[] => cfg().companies
/** Công ty CHẠY QUẢNG CÁO — bộ chọn công ty, vòng lặp job, kiểm đầu vào. Bản Mắt Bão: ["MBC","MBI"]. */
export const companyIds = (): string[] => cfg().companies.filter((c) => c.ads).map((c) => c.id)
export const isCompany = (x: unknown): x is string => typeof x === "string" && companyIds().includes(x)
export const companyDef = (id: string): CompanyDef | null => cfg().companies.find((c) => c.id === id) ?? null
export const fallbackCompany = (): string => { const c = cfg(); return c.companies.some((x) => x.ads && x.id === c.fallback) ? c.fallback : companyIds()[0] }
export const hasPack = (id: string, pack: string): boolean => !!companyDef(id)?.packs?.includes(pack)

/**
 * Chuẩn hoá mã công ty từ đầu vào: hợp lệ → giữ, không → công ty mặc định của bản cài.
 * Thay mẫu cũ `x === "MBI" ? "MBI" : "MBC"` — bản Mắt Bão cho ra đúng như cũ (MBI→MBI, còn lại→MBC).
 */
/** Đợt 25: công ty của bản cài theo thứ tự ưu tiên `preferred` (mã không có ở bản cài bị bỏ, mã còn lại nối sau).
 *  Thay cho các danh sách viết cứng ["MBI","MBC"]: bản Mắt Bão ra ĐÚNG thứ tự cũ; bản khách ra công ty của mình. */
export const orderedCompanyIds = (preferred: string[] = []): string[] => {
  const ids = companyIds()
  return [...preferred.filter((p) => ids.includes(p)), ...ids.filter((i) => !preferred.includes(i))]
}
export const pickCompany = (raw: unknown): string => (isCompany(raw) ? raw : fallbackCompany())

/** Tên hiển thị / URL gốc / đường dẫn hiển thị quảng cáo của công ty KHÔNG có chuỗi riêng trong mã (công ty mới của bản cài). */
export const companyLabel = (id: string): string => companyDef(id)?.label ?? id
export const companyUrl = (id: string): string => { const d = companyDef(id)?.domain; return d ? `https://${d}` : "" }
export const companyDisplayPath = (id: string): string => (companyDef(id)?.domain ?? "").replace(/\./g, " ")

/** Mô-đun bật ở bản cài (marketing luôn có). */
export const installModules = (): ModuleId[] => { const m = cfg().modules ?? ["marketing"]; return m.includes("marketing") ? m : ["marketing", ...m] }
export const hasModule = (m: ModuleId | null | undefined): boolean => !m || m === "marketing" || installModules().includes(m)
/** Số lần cấu hình đổi — để giao diện vẽ lại (useSyncExternalStore). */
export const companiesVersion = (): number => (G.__adsCompaniesVer ?? 0)

/** Đợt 21 A4: mã tích hợp CÔNG KHAI (pixel / trang Meta, GA4) theo tên biến NEXT_PUBLIC_* — trình duyệt nạp từ /api/companies. */
export function setPublicIds(m: Record<string, string>) { (G as { __adsPublicIds?: Record<string, string> }).__adsPublicIds = m }
export const publicIdFromConfig = (name: string): string | null => (G as { __adsPublicIds?: Record<string, string> }).__adsPublicIds?.[name] || null
