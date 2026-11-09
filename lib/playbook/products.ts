// Mã sản phẩm của wizard (kebab-case) → nhãn sản phẩm của Sổ kinh nghiệm. Module thuần, không import gì.

/** Mã sản phẩm của wizard → nhãn sản phẩm của Sổ (PRODUCT_LABEL). */
export const PRODUCT_KEY_TO_LABEL: Record<string, string> = {
  "ten-mien": "Tên miền", "hosting": "Hosting", "vibe-hosting": "Hosting", "ssl": "SSL",
  "chu-ky-so": "Chữ ký số", "hoa-don-dien-tu": "Hoá đơn điện tử", "hoa-don-ecom": "Hoá đơn điện tử",
  "hop-dong-dien-tu": "Hợp đồng điện tử", "sale-ai": "Sale.AI",
}
/** Sản phẩm chưa có trong bảng (google-workspace, custom…) → null: KHÔNG gợi ý từ nhóm "Khác"
 *  (nhóm đó trộn nhiều sản phẩm, kinh nghiệm của nó không đúng cho sản phẩm cụ thể nào). */
export const productLabelOf = (key: string | null | undefined): string | null => (key && PRODUCT_KEY_TO_LABEL[key]) || null
