// ============================================================
// Odoo Product Category → MB Product Group mapping
// Verified IDs from Odoo product.category list (52 categories)
// ============================================================

export interface ProductGroup {
  key: string;
  label: string;
  icon: string;
  categoryIds: number[];
  company: string;
}

// ── MBC product groups ───────────────────────────────────────

export const PRODUCT_GROUPS_MBC: ProductGroup[] = [
  {
    key: "ten-mien",
    label: "Tên miền",
    icon: "🌐",
    categoryIds: [28, 45, 46, 47],    // TM, TMQT, TMVN, TMVNCD
    company: "MBC",
  },
  {
    key: "hosting",
    label: "Hosting & VPS",
    icon: "🖥",
    categoryIds: [15, 41, 42, 43, 57], // HO, HOST_LIN, HOST_WIN, HOST_WORPRESS, HOST_VIBECODING
    company: "MBC",
  },
  {
    key: "cloud",
    label: "Cloud Server",
    icon: "☁️",
    categoryIds: [10, 33, 34, 35, 36, 51, 37], // CLOUDSERVER *, DEDICATED_SERVER
    company: "MBC",
  },
  {
    key: "colo",
    label: "CoLocation",
    icon: "🏢",
    categoryIds: [11],                 // COLO
    company: "MBC",
  },
  {
    key: "email",
    label: "Email",
    icon: "📧",
    categoryIds: [13, 38, 39],         // EMAIL, EMAIL_PRO, EMAIL_4B
    company: "MBC",
  },
  {
    key: "google-ws",
    label: "Google Workspace",
    icon: "📱",
    categoryIds: [21],                 // GOOGLE
    company: "MBC",
  },
  {
    key: "microsoft",
    label: "Microsoft 365",
    icon: "💼",
    categoryIds: [22],                 // MICROSOFT
    company: "MBC",
  },
  {
    key: "ssl",
    label: "SSL",
    icon: "🔒",
    categoryIds: [26],                 // SSL
    company: "MBC",
  },
  {
    key: "license",
    label: "License & Workspace",
    icon: "📋",
    categoryIds: [19, 20],             // LICENSE, MATBAOWORKSPACE
    company: "MBC",
  },
  {
    key: "ai",
    label: "Dịch vụ AI",
    icon: "🤖",
    categoryIds: [52, 53],             // DICHVU_AI, SALE_AI
    company: "MBC",
  },
];

// ── MBI product groups ───────────────────────────────────────

export const PRODUCT_GROUPS_MBI: ProductGroup[] = [
  {
    key: "cts",
    label: "Chữ ký số",
    icon: "✍️",
    categoryIds: [9, 50, 54, 55],      // CTS, ADDON_CTS, CTS-RSS, CTS-ADDONRSS
    company: "MBI",
  },
  {
    key: "hddt",
    label: "Hóa đơn điện tử",
    icon: "📄",
    categoryIds: [14, 49],             // HDDT, ADDON_HDDT
    company: "MBI",
  },
  {
    key: "hddv",
    label: "Hóa đơn đầu vào",
    icon: "📥",
    categoryIds: [40],                 // HDDV
    company: "MBI",
  },
  {
    key: "hop-dong",
    label: "Hợp đồng điện tử",
    icon: "📃",
    categoryIds: [44],                 // ECONTRACT
    company: "MBI",
  },
  {
    key: "tn-hddt",
    label: "Truyền nhận HDDT",
    icon: "🔄",
    categoryIds: [48],                 // TRUYENNHANHDDT
    company: "MBI",
  },
  {
    key: "mbi-zalo",
    label: "MBI Zalo",
    icon: "💬",
    categoryIds: [56],                 // MBI_ZALO
    company: "MBI",
  },
];

// ── Helpers ──────────────────────────────────────────────────

export function getGroupsForCompany(company: string): ProductGroup[] {
  return company === "MBC" ? PRODUCT_GROUPS_MBC : PRODUCT_GROUPS_MBI;
}

/** Flat map: categ_id → ProductGroup */
export function buildCategIdIndex(company: string): Map<number, ProductGroup> {
  const index = new Map<number, ProductGroup>();
  for (const group of getGroupsForCompany(company)) {
    for (const id of group.categoryIds) {
      index.set(id, group);
    }
  }
  return index;
}

export function allCategoryIds(company: string): number[] {
  return getGroupsForCompany(company).flatMap(g => g.categoryIds);
}
