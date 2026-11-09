// Đợt 21 — mã CÔNG KHAI (đã hiện trên website khách: pixel, trang, GA4) theo công ty, cho phía trình duyệt khi bản build
// không mang sẵn giá trị (bản cài khách dán ở Cài đặt → API Keys → "Mã theo từng công ty"). CHỈ máy chủ. Không có khoá.
import { companiesConfig, companyDef } from "@/lib/companies"

export const PUBLIC_ID_PREFIXES = ["NEXT_PUBLIC_META_PIXEL_ID", "NEXT_PUBLIC_META_PAGE_ID", "NEXT_PUBLIC_META_PIXEL_LABEL", "NEXT_PUBLIC_META_PAGE_LABEL", "NEXT_PUBLIC_GA4_PROPERTY_ID", "NEXT_PUBLIC_GA4_STREAM_ID", "NEXT_PUBLIC_GA4_MEASUREMENT_ID"]

export function publicIdsFromEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of companiesConfig().companies) {
    for (const p of PUBLIC_ID_PREFIXES) {
      const n = `${p}_${companyDef(c.id)?.envSuffix ?? c.id}`
      const v = (process.env[n] ?? "").trim()
      if (v) out[n] = v
    }
  }
  return out
}
