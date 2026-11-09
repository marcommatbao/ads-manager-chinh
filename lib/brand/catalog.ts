// ============================================================
// Đợt 21 A3 — Catalog sản phẩm cho tạo quảng cáo Google (máy chủ).
// ============================================================
// lib/google-creative-engine.ts (dùng cả ở trình duyệt) giữ catalog Mắt Bão gắn trong mã. Ở MÁY CHỦ, công ty có hồ sơ
// (brandOverride ≠ null) dùng sản phẩm trong hồ sơ: khoá `custom_<tên>` — đúng khuôn "sản phẩm tự nhập" giao diện đang gửi.
import { getProductCatalog, type ProductCatalogEntry } from "@/lib/google-creative-engine"
import { brandOverride } from "./store"

export function catalogFor(company: string): Record<string, ProductCatalogEntry> {
  const bp = brandOverride(company)
  if (!bp) return getProductCatalog(company)
  const out: Record<string, ProductCatalogEntry> = {}
  for (const p of bp.products) {
    out[`custom_${p.name}`] = {
      id: `custom_${p.name}`, name: p.name, company, variants: [],
      finalUrls: p.url ? { [company]: p.url } : {}, painPoints: [], usp: bp.strengths, searchIntents: [],
    }
  }
  return out
}
