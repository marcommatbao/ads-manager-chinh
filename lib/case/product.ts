// ============================================================
// Nhóm sản phẩm suy từ tên chiến dịch — so khớp BỎ DẤU
// ============================================================
// Bản cũ trong lib/cpl-targets.ts so khớp có dấu, nên đo 25/09 trên MBI:
//   "MBI - Pmax - Chứ Ký Số - 5/3/2026"      → DEFAULT (tên gõ "Chứ", không phải "Chữ")
//   "MBI - Pmax - Hợp Đồng Điện Tử - 20/1/2026" → DEFAULT (không có nhóm hợp đồng)
// Bỏ dấu trước khi so thì cả hai lỗi gõ dấu đều về đúng nhóm.

import { stripDiacritics } from "./text"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type ProductGroup =
  | "HOSTING" | "DOMAIN" | "SSL" | "EINVOICE" | "ESIGN" | "ECONTRACT" | "SALEAI" | "DEFAULT"

export function productGroupOf(campaignName: string): ProductGroup {
  const n = stripDiacritics(campaignName)
  if (n.includes("hosting")) return "HOSTING"
  if (n.includes("domain") || n.includes("ten mien")) return "DOMAIN"
  if (n.includes("ssl")) return "SSL"
  if (n.includes("hoa don") || n.includes("einvoice") || n.includes("e-invoice")) return "EINVOICE"
  if (n.includes("hop dong") || n.includes("econtract") || n.includes("e-contract")) return "ECONTRACT"
  // "chu ky" bắt cả "Chữ Ký" lẫn tên gõ nhầm "Chứ Ký".
  if (n.includes("chu ky") || n.includes("esign") || n.includes("e-sign")) return "ESIGN"
  if (n.includes("sale.ai") || n.includes("saleai")) return "SALEAI"
  return "DEFAULT"
}

export const PRODUCT_LABEL: Record<ProductGroup, string> = {
  HOSTING: "Hosting",
  DOMAIN: "Tên miền",
  SSL: "SSL",
  EINVOICE: "Hoá đơn điện tử",
  ESIGN: "Chữ ký số",
  ECONTRACT: "Hợp đồng điện tử",
  SALEAI: "Sale.AI",
  DEFAULT: "Khác",
}

/** Nhãn nhóm sản phẩm theo ngôn ngữ (PRODUCT_LABEL giữ bản tiếng Việt cho mã/so khớp). */
export const productLabel = (g: ProductGroup, t: TFunction = makeT("vi")): string => t(`libcase.c.product.${g}` as never)
