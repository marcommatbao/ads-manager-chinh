// ============================================================
// Company detection (MBC vs MBI) — shared, server + client safe
// ------------------------------------------------------------
// Một campaign thuộc MBC hay MBI được suy theo thứ tự:
//   1. Google customer ID (env GOOGLE_ADS_CUSTOMER_ID_MBC / _MBI)
//   2. Google account name mapping
//   3. Prefix tên campaign ("MBI - ..." / "MBC - ...")
//   4. Mặc định MBC
// Facebook chỉ có 1 ad account → phân biệt hoàn toàn bằng prefix tên.
// ============================================================

// Đợt 21a: quy tắc lấy từ cấu hình công ty của bản cài (lib/companies). Bản Mắt Bão = lib/companies/defaults.ts, tái tạo
// ĐÚNG hành vi cũ (đối chứng tests/case/dot21-golden.test.ts). Thứ tự ưu tiên giữ nguyên:
//   1. mã Google (GOOGLE_ADS_CUSTOMER_ID_<hậu tố>)  2. tên tài khoản Google khớp nguyên  3. tên tài khoản CHỨA chuỗi
//   4. tên chiến dịch CHỨA chuỗi  5. công ty mặc định (fallback).
// Dùng ở CẢ trình duyệt (qua lib/utils) → chỉ import sổ công ty, không import lib/companies (đọc tệp).
import { allCompanyDefs, companyDef, fallbackCompany } from "@/lib/companies/registry"
import type { CompanyDef } from "@/lib/companies/defaults"

/** Chỉ giữ chữ số (so khớp customer ID kiểu "219-068-5994" vs "2190685994"). */
function digits(s?: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Bảng tên tài khoản Google → công ty (giữ export cũ cho chỗ đang dùng). */
export function googleAccountCompanyMap(): Record<string, string> {
  return Object.fromEntries(allCompanyDefs().flatMap((c) => (c.match.googleAccountNames ?? []).map((n) => [n, c.id])))
}

/** HÀM THUẦN theo danh sách công ty truyền vào — dễ test với cấu hình khác. */
export function detectCompanyWith(
  defs: CompanyDef[], fallback: string, googleIdOf: (id: string) => string,
  campaignName: string, accountName?: string, accountId?: string,
): string {
  const ads = defs.filter((c) => c.ads)
  // 1. Mã Google — nguồn chắc nhất. Duyệt NGƯỢC để giữ thứ tự cũ (MBI được so trước MBC).
  const id = digits(accountId)
  if (id) for (const c of [...ads].reverse()) { const g = digits(googleIdOf(c.id)); if (g && g === id) return c.id }
  // 2–3. Tên tài khoản Google
  if (accountName) {
    const key = accountName.toLowerCase().trim()
    for (const c of ads) if (c.match.googleAccountNames?.includes(key)) return c.id
    for (const c of ads) if (c.match.googleAccountContains?.some((x) => key.includes(x))) return c.id
  }
  // 4. Chữ trong tên chiến dịch (Facebook / đặt tay)
  const n = (campaignName ?? "").toUpperCase()
  for (const c of ads) if (c.match.campaignContains?.some((x) => n.includes(x.toUpperCase()))) return c.id
  // 5. Mặc định
  return fallback
}

/**
 * Suy công ty từ campaign.
 * @param campaignName tên campaign (luôn có)
 * @param accountName  tên account Google (nếu có)
 * @param accountId    customer ID Google (nếu có)
 */
export function detectCompany(campaignName: string, accountName?: string, accountId?: string): string {
  // Ở trình duyệt process.env chỉ có NEXT_PUBLIC_* → mã Google rỗng, bỏ qua bước 1 (đúng như trước Đợt 21).
  const googleId = (c: string) => (typeof process !== "undefined" ? process.env?.[`GOOGLE_ADS_CUSTOMER_ID_${companyDef(c)?.envSuffix ?? c}`] ?? "" : "")
  return detectCompanyWith(allCompanyDefs(), fallbackCompany(), googleId, campaignName, accountName, accountId)
}

/** @deprecated giữ tên cũ — dùng googleAccountCompanyMap(). */
export const GOOGLE_ACCOUNT_COMPANY = new Proxy({} as Record<string, string>, { get: (_t, k) => googleAccountCompanyMap()[String(k)], ownKeys: () => Object.keys(googleAccountCompanyMap()), getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true, value: googleAccountCompanyMap()[String(k)] }) })
