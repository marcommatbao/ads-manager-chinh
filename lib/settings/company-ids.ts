// ============================================================
// Đợt 21 A4 — Mã tích hợp THEO CÔNG TY dán ở Cài đặt (mã khách hàng Google, pixel / trang Meta).
// ============================================================
// Không phải bí mật (mã tài khoản, pixel ID công khai trên website) nhưng vẫn chỉ super_admin sửa/xem (cùng trang API Keys).
// Lưu trong google-settings.json `customerIds` và meta-settings.json `companies`; nạp lúc khởi động bằng saved-credentials.ts.
import { companyDef, companyIds } from "@/lib/companies"

export const digitsOnly = (s: unknown, len?: [number, number]): string | null => {
  const d = String(s ?? "").replace(/[\s-]/g, "")
  if (!d) return ""
  if (!/^\d+$/.test(d)) return null
  if (len && (d.length < len[0] || d.length > len[1])) return null
  return d
}
export const envSuffix = (co: string) => companyDef(co)?.envSuffix ?? co

/** Kiểm map { [công ty]: mã } — HÀM THUẦN (trừ tra công ty). Trả map sạch + lỗi. Chuỗi rỗng = xoá giá trị đã lưu. */
export function cleanCompanyMap(raw: unknown, len?: [number, number]): { map: Record<string, string>; errors: string[] } {
  const out: Record<string, string> = {}, errors: string[] = []
  if (!raw || typeof raw !== "object") return { map: out, errors }
  for (const [co, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!companyIds().includes(co)) { errors.push(`Công ty "${co}" không có ở bản cài`); continue }
    const d = digitsOnly(v, len)
    if (d === null) { errors.push(`${co}: mã chỉ gồm chữ số${len ? ` (${len[0] === len[1] ? len[0] : `${len[0]}–${len[1]}`} số)` : ""}`); continue }
    out[co] = d
  }
  return { map: out, errors }
}
