// ============================================================
// Tên chiến dịch → sản phẩm trong PRODUCTS_KB.
// ------------------------------------------------------------
// Có sẵn detectProductGroup() ở lib/cpl-targets.ts nhưng nó gom về 6 nhóm để
// tra ngưỡng CPL, không đủ để lấy kho kiến thức: "Vibe Hosting" và "Cloud
// Hosting" cùng ra HOSTING, còn "Microsoft 365" rơi vào DEFAULT — tức mất sạch
// phần kiến thức sản phẩm, trong khi PRODUCTS_KB có mục riêng cho cả ba.
//
// Đây chính là chỗ quyết định gợi ý đối tượng có KHÁC nhau giữa các chiến dịch
// hay không: cùng một sản phẩm suy ra thì cùng một căn cứ, cùng một gợi ý.
// ============================================================

import { PRODUCTS_KB } from "@/lib/products-knowledge";

/** Bỏ dấu tiếng Việt + hạ thường, để so khớp tên chiến dịch gõ kiểu gì cũng ra. */
function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

// Thứ tự QUAN TRỌNG: mục hẹp đứng trước mục rộng. "Vibe Hosting" phải bắt được
// vibe-hosting chứ không rơi vào hosting, vì hai sản phẩm bán cho hai tệp khác
// nhau (vibe-hosting: người làm web bằng AI; hosting: doanh nghiệp có web sẵn).
const RULES: Array<{ key: keyof typeof PRODUCTS_KB; patterns: string[] }> = [
  { key: "vibe-hosting",    patterns: ["vibe hosting", "vibe-hosting", "vibehosting"] },
  { key: "google-workspace",patterns: ["google workspace", "gsuite", "g suite", "workspace"] },
  { key: "microsoft-365",   patterns: ["microsoft 365", "office 365", "m365", "o365", "microsoft365"] },
  { key: "hoa-don-dien-tu", patterns: ["hoa don dien tu", "hoa don", "einvoice", "e-invoice", "hddt"] },
  { key: "chu-ky-so",       patterns: ["chu ky so", "chukyso", "esign", "e-sign", "digital signature", "cks"] },
  { key: "khoa-hoc-thue",   patterns: ["khoa hoc thue", "hoc thue", "khoa hoc"] },
  { key: "sale-ai",         patterns: ["sale.ai", "saleai", "sale ai"] },
  { key: "ten-mien",        patterns: ["ten mien", "domain", "tenmien"] },
  { key: "hosting",         patterns: ["hosting", "cloud server", "elastic cloud", "vps", "may chu"] },
];

export interface CampaignProduct {
  key: string;
  /** Mục tương ứng trong PRODUCTS_KB. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kb: any;
  /** Từ khoá đã khớp — để nói được vì sao chọn sản phẩm này, đỡ phải đoán. */
  matchedOn: string;
}

/**
 * Suy sản phẩm từ tên chiến dịch. Không khớp được thì trả null — KHÔNG đoán
 * bừa một sản phẩm mặc định, vì gợi ý đối tượng dựa trên sản phẩm sai còn tệ
 * hơn gợi ý chung chung: nó sai một cách rất thuyết phục.
 */
export function resolveProductFromCampaign(campaignName: string): CampaignProduct | null {
  const n = normalize(campaignName);
  if (!n) return null;

  for (const rule of RULES) {
    const hit = rule.patterns.find(p => n.includes(p));
    if (hit) {
      const kb = (PRODUCTS_KB as Record<string, unknown>)[rule.key as string];
      if (kb) return { key: rule.key as string, kb, matchedOn: hit };
    }
  }
  return null;
}
