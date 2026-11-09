// ============================================================
// Google Creative Engine — Product Catalog & Segment Mapping
// ============================================================
// MBC = Mắt Bão Corporation → Domain, Hosting, Email, M365, GWS, SSL, Sale.ai
// MBI = Mắt Bão Invoice     → Hóa đơn điện tử, Chữ ký số, Hợp đồng điện tử

// ── Types ──

export interface ProductCatalogEntry {
  id:            string;
  name:          string;
  company:       string;              // Sản phẩm thuộc company nào
  variants:      string[];
  /** Trang đích. PHẢI là URL MỞ ĐƯỢC THẬT — Google kiểm bằng trình thu thập
   *  của nó và từ chối quảng cáo với chủ đề `DESTINATION_NOT_WORKING`, xếp
   *  loại PROHIBITED (cấm hẳn, không xin miễn trừ được).
   *
   *  Đo ngày 19/09/2026: 7/11 URL trong bảng này TRẢ 404 — `matbao.net/ten-mien`,
   *  `/hosting`, `/email-doanh-nghiep`, `/microsoft-365`, `/ssl`,
   *  `matbao.in/chu-ky-so`, và `sale.ai` (403, tên miền này đang được rao bán
   *  trên atom.com chứ không phải sản phẩm của Mắt Bão). Vì vậy MỌI lần tạo
   *  chiến dịch cho 7 sản phẩm đó đều bị Google chặn, và thông báo chỉ nói
   *  "policy topics of type PROHIBITED" nên không ai lần ra được nguyên nhân.
   *
   *  URL lấy từ quảng cáo ĐANG CHẠY + ĐÃ ĐƯỢC GOOGLE DUYỆT trong chính tài
   *  khoản, rồi kiểm lại từng cái bằng HTTP.
   *
   *  DÙNG BẢN KHÔNG ĐUÔI `.html`. Website đã chuyển sang dạng không đuôi; đo
   *  ngày 19/09/2026 thì bản không đuôi trả 200 và **không chuyển hướng lần
   *  nào**, còn bản `.html` trả 200 rồi chuyển hướng sang chính bản không
   *  đuôi. Bỏ được một chặng chuyển hướng là bỏ được một chỗ hỏng.
   *
   *  ĐỔI URL Ở ĐÂY THÌ PHẢI MỞ THỬ TRƯỚC. Một URL chết ở bảng này làm hỏng
   *  toàn bộ đường tạo chiến dịch của sản phẩm đó. */
  finalUrls:     Record<string, string>;      // company → URL
  painPoints:    string[];
  usp:           string[];
  searchIntents: string[];
}

/** Segment data passed from audience/campaign analysis */
export interface SegmentData {
  name?:        string;
  keywords?:    string[];
  interests?:   string[];
  objective?:   string;
  channelType?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MBC Products — matbao.net
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const MBC_PRODUCT_CATALOG: Record<string, ProductCatalogEntry> = {

  DOMAIN: {
    id:          "DOMAIN",
    name:        "Tên miền",
    company:     "MBC",
    variants:    [".vn", ".com.vn", ".com", ".net", ".io", ".xyz"],
    finalUrls:   { MBC: "https://www.matbao.net/ten-mien/dang-ky-ten-mien" },
    painPoints: [
      "Lo bị đối thủ đăng ký mất tên miền",
      "Chưa có tên miền .vn chuyên nghiệp",
      "Đang dùng tên miền free không uy tín",
      "Muốn bảo vệ thương hiệu số",
    ],
    usp: [
      "Đăng ký trong 5 phút",
      "Hỗ trợ 24/7",
      "Bảo hành tên miền trọn đời",
      "Giá chỉ từ 299K/năm",
    ],
    searchIntents: ["mua tên miền", "đăng ký domain", "tên miền .vn giá rẻ",
                    "kiểm tra tên miền", "domain .com.vn"],
  },

  HOSTING: {
    id:          "HOSTING",
    name:        "Hosting / Cloud Server",
    company:     "MBC",
    variants:    ["Shared Hosting", "Cloud Hosting", "VPS", "Cloud Server"],
    finalUrls:   { MBC: "https://www.matbao.net/hosting/cloud-hosting" },
    painPoints: [
      "Website bị chậm, mất khách",
      "Hosting hiện tại thường xuyên downtime",
      "Không biết chọn hosting phù hợp",
      "Cần nâng cấp khi business tăng trưởng",
    ],
    usp: [
      "Uptime 99.9% cam kết",
      "Tốc độ NVMe SSD",
      "Hỗ trợ migrate miễn phí",
      "Backup tự động hàng ngày",
    ],
    searchIntents: ["mua hosting", "hosting giá rẻ", "cloud hosting việt nam",
                    "vps server việt nam", "hosting wordpress tốt"],
  },

  EMAIL_BUSINESS: {
    id:          "EMAIL_BUSINESS",
    name:        "Email doanh nghiệp",
    company:     "MBC",
    variants:    ["Email MBC", "Zoho Mail", "Business Email"],
    finalUrls:   { MBC: "https://www.matbao.net/email-365" },
    painPoints: [
      "Đang dùng Gmail cá nhân cho công việc",
      "Email không có tên miền công ty, thiếu chuyên nghiệp",
      "Email hay vào spam của khách hàng",
    ],
    usp: [
      "Email @tenmien.vn của bạn",
      "Chống spam thông minh",
      "Dung lượng lớn, đồng bộ mọi thiết bị",
      "Từ 12K/tháng/hộp thư",
    ],
    searchIntents: ["email doanh nghiệp", "email tên miền riêng",
                    "mua email công ty", "email business giá rẻ"],
  },

  MICROSOFT_365: {
    id:          "MICROSOFT_365",
    name:        "Microsoft 365",
    company:     "MBC",
    variants:    ["Microsoft 365 Business Basic", "Business Standard", "Business Premium"],
    finalUrls:   { MBC: "https://www.matbao.net/office-365" },
    painPoints: [
      "Team làm việc rời rạc, không cộng tác được",
      "Đang dùng Office lậu, lo bị phạt",
      "Cần Teams, SharePoint cho remote work",
    ],
    usp: [
      "Word, Excel, PowerPoint, Teams chính hãng",
      "1TB OneDrive mỗi user",
      "Hỗ trợ triển khai cho toàn công ty",
      "Giá partner ưu đãi hơn mua trực tiếp",
    ],
    searchIntents: ["mua microsoft 365", "office 365 doanh nghiệp",
                    "microsoft teams việt nam", "office 365 bản quyền"],
  },

  GOOGLE_WORKSPACE: {
    id:          "GOOGLE_WORKSPACE",
    name:        "Google Workspace",
    company:     "MBC",
    variants:    ["Business Starter", "Business Standard", "Business Plus"],
    finalUrls:   { MBC: "https://www.matbao.net/google-workspace" },
    painPoints: [
      "Đang dùng Google Drive cá nhân, hết dung lượng",
      "Muốn có Gmail tên miền công ty",
      "Cần Meet, Docs, Sheets cho cả team",
    ],
    usp: [
      "Gmail @tenmien.vn + Drive 30GB-5TB",
      "Meet không giới hạn thời gian",
      "Triển khai trong 1 ngày",
      "Giá từ 6 USD/user/tháng",
    ],
    searchIntents: ["google workspace việt nam", "mua google workspace",
                    "g suite doanh nghiệp", "gmail tên miền riêng"],
  },

  SSL: {
    id:          "SSL",
    name:        "SSL Certificate",
    company:     "MBC",
    variants:    ["SSL DV", "SSL OV", "SSL Wildcard", "SSL EV"],
    finalUrls:   { MBC: "https://www.matbao.net/bao-mat-website/chung-chi-ssl" },
    painPoints: [
      "Website hiện 'Not Secure', mất trust khách hàng",
      "Google ranking bị ảnh hưởng vì thiếu HTTPS",
      "SSL cũ sắp hết hạn",
    ],
    usp: [
      "Kích hoạt trong 15 phút",
      "Bảo hành $1.75M",
      "Auto-renew tự động",
      "Từ 500K/năm",
    ],
    searchIntents: ["mua ssl", "chứng chỉ ssl", "ssl website giá rẻ",
                    "https website", "ssl wildcard việt nam"],
  },

  SALE_AI: {
    id:          "SALE_AI",
    name:        "Sale.ai",
    company:     "MBC",
    variants:    ["CRM AI", "Sales Automation"],
    // ĐỂ TRỐNG CÓ CHỦ ĐÍCH. `sale.ai` trả 403 và chuyển hướng sang
    // atom.com — tên miền đó đang được RAO BÁN, không phải sản phẩm của
    // công ty. Đã tìm sale-ai.html, sale.matbao.net, saleai.vn: không
    // trang nào mở được, và không có quảng cáo đang chạy nào trỏ tới
    // Sale.ai để lấy URL đúng.
    //
    // Trỏ tạm sang sản phẩm khác là SAI HƠN 404: gửi người tìm CRM vào
    // trang hosting thì tiền vẫn mất mà còn làm hỏng số liệu. Để trống
    // để phép kiểm trang đích chặn lại kèm lời giải thích.
    finalUrls:   {},
    painPoints: [
      "Quản lý khách hàng bằng Excel, dễ thất lạc",
      "Sale team không follow up kịp",
      "Không biết lead nào đang hot",
    ],
    usp: [
      "AI tự động phân loại lead nóng/lạnh",
      "Nhắc lịch follow up tự động",
      "Báo cáo sale real-time",
      "Tích hợp Zalo, Facebook, Email",
    ],
    searchIntents: ["phần mềm crm việt nam", "quản lý khách hàng ai",
                    "crm cho sme", "sale automation việt nam"],
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MBI Products — matbao.in
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const MBI_PRODUCT_CATALOG: Record<string, ProductCatalogEntry> = {

  HOA_DON_DIEN_TU: {
    id:       "HOA_DON_DIEN_TU",
    name:     "Hóa đơn điện tử",
    company:  "MBI",
    variants: ["Hóa đơn GTGT", "Hóa đơn bán hàng",
               "Hóa đơn xuất khẩu", "Tem vé điện tử"],
    finalUrls: { MBI: "https://matbao.in/bang-gia-hoa-don-dien-tu/" },
    painPoints: [
      "Bị phạt vì chưa chuyển sang hóa đơn điện tử theo Nghị định 123",
      "Đang xuất hóa đơn giấy tốn kém, dễ thất lạc",
      "Phần mềm HĐ cũ không kết nối được với cơ quan thuế",
      "Xuất hóa đơn sai, bị khách hàng khiếu nại",
      "Không biết chọn nhà cung cấp HĐ điện tử uy tín",
    ],
    usp: [
      "Kết nối trực tiếp Tổng cục Thuế",
      "Ký số tích hợp, không cần thiết bị rời",
      "Xuất hóa đơn trong 30 giây",
      "Lưu trữ 10 năm theo quy định",
      "Hỗ trợ API kết nối phần mềm kế toán",
    ],
    searchIntents: [
      "phần mềm hóa đơn điện tử",
      "hóa đơn điện tử giá rẻ",
      "đăng ký hóa đơn điện tử",
      "hóa đơn điện tử kết nối thuế",
      "mua hóa đơn điện tử doanh nghiệp",
      "hóa đơn gtgt điện tử",
    ],
  },

  CHU_KY_SO: {
    id:       "CHU_KY_SO",
    name:     "Chữ ký số",
    company:  "MBI",
    variants: ["Chữ ký số USB Token", "Chữ ký số HSM",
               "Chữ ký số cá nhân", "Chữ ký số doanh nghiệp"],
    finalUrls: { MBI: "https://mifi.vn/bang-gia-chu-ky-so/" },
    painPoints: [
      "Phải ra tận nơi ký giấy tờ, mất thời gian",
      "USB Token cũ hỏng, không ký khai thuế được",
      "Chữ ký số hết hạn, bị chặn nộp hồ sơ",
      "Cần ký số cho nhiều nhân viên trong công ty",
    ],
    usp: [
      "Cấp chứng thư trong 2 giờ",
      "Ký mọi nơi, mọi thiết bị",
      "Tương thích VNPT-CA, Viettel-CA, BKAV-CA",
      "Hỗ trợ ký hàng loạt",
      "Gia hạn online không cần lên văn phòng",
    ],
    searchIntents: [
      "mua chữ ký số",
      "chữ ký số doanh nghiệp",
      "gia hạn chữ ký số",
      "chữ ký số usb token",
      "chữ ký số kê khai thuế",
      "cấp chứng thư số",
    ],
  },

  HOP_DONG_DIEN_TU: {
    id:       "HOP_DONG_DIEN_TU",
    name:     "Hợp đồng điện tử",
    company:  "MBI",
    variants: ["Hợp đồng lao động điện tử",
               "Hợp đồng mua bán điện tử",
               "Hợp đồng dịch vụ điện tử"],
    finalUrls: { MBI: "https://matbao.in/hop-dong-dien-tu/" },
    painPoints: [
      "Ký hợp đồng với đối tác xa tốn nhiều ngày",
      "Hợp đồng giấy dễ mất, khó quản lý",
      "Team remote không thể ký hợp đồng lao động",
      "Chi phí in ấn, gửi bưu điện tốn kém",
    ],
    usp: [
      "Ký hợp đồng trong 5 phút dù ở đâu",
      "Có giá trị pháp lý theo Luật Giao dịch điện tử",
      "Lưu trữ tập trung, tra cứu trong giây lát",
      "Tích hợp chữ ký số tự động",
      "Template hợp đồng sẵn có",
    ],
    searchIntents: [
      "hợp đồng điện tử",
      "ký hợp đồng online",
      "phần mềm ký hợp đồng điện tử",
      "hợp đồng lao động điện tử",
      "ký số hợp đồng từ xa",
    ],
  },

  HOA_DON_ECOM: {
    id:       "HOA_DON_ECOM",
    name:     "Hóa đơn điện tử Ecom",
    company:  "MBI",
    variants: ["Hóa đơn Shopee", "Hóa đơn TikTok Shop",
               "Hóa đơn Lazada", "Hóa đơn Website TMĐT"],
    finalUrls: { MBI: "https://matbao.in/giai-phap/thuong-mai-dien-tu" },
    painPoints: [
      "Bán hàng Shopee/TikTok Shop nhưng không xuất được hóa đơn",
      "Khách hàng doanh nghiệp yêu cầu HĐ GTGT",
      "Xuất hóa đơn thủ công cho hàng trăm đơn/ngày",
      "Bị thuế yêu cầu xuất HĐ cho toàn bộ đơn hàng TMĐT",
    ],
    usp: [
      "Tự động xuất HĐ khi có đơn hàng mới",
      "Kết nối Shopee, TikTok Shop, Lazada, WooCommerce",
      "Xử lý 10.000 hóa đơn/ngày",
      "Đồng bộ phần mềm kế toán MISA, Fast",
      "Đáp ứng Nghị định 123/2020/NĐ-CP",
    ],
    searchIntents: [
      "hóa đơn điện tử shopee",
      "xuất hóa đơn bán hàng online",
      "hóa đơn tiktok shop",
      "phần mềm hóa đơn tmđt",
      "hóa đơn ecommerce tự động",
    ],
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Unified catalog — merge cả MBC + MBI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ALL_PRODUCTS: Record<string, ProductCatalogEntry> = {
  ...MBC_PRODUCT_CATALOG,
  ...MBI_PRODUCT_CATALOG,
};

// ── Keyword → Product mapping for smart detection ──

const PRODUCT_KEYWORDS: Record<string, string[]> = {
  // MBC products
  DOMAIN:           ["domain", "tên miền", "ten mien", ".vn", ".com", "tenmien"],
  HOSTING:          ["hosting", "cloud server", "vps", "server", "cloud", "máy chủ", "may chu"],
  EMAIL_BUSINESS:   ["email", "mail", "zoho", "hộp thư", "hop thu", "email doanh nghiệp"],
  MICROSOFT_365:    ["microsoft", "office 365", "ms365", "m365", "teams", "sharepoint", "onedrive"],
  GOOGLE_WORKSPACE: ["google workspace", "g suite", "gsuite", "workspace"],
  SSL:              ["ssl", "https", "chứng chỉ số", "certificate", "bảo mật web"],
  SALE_AI:          ["sale.ai", "sale ai", "crm", "sales automation"],
  // MBI products
  HOA_DON_DIEN_TU:  ["hóa đơn điện tử", "hoa don dien tu", "hóa đơn", "hoa don", "einvoice", "e-invoice", "hddt"],
  CHU_KY_SO:        ["chữ ký số", "chu ky so", "token", "digital signature", "ký số", "ky so", "ckso"],
  HOP_DONG_DIEN_TU: ["hợp đồng điện tử", "hop dong dien tu", "econtract", "e-contract", "hợp đồng", "hop dong"],
  HOA_DON_ECOM:     ["ecom", "e-commerce", "shopee", "lazada", "tiki", "sàn tmđt", "thương mại điện tử", "ecommerce"],
};

/**
 * Detect matching products from campaign name, keywords, or segment data.
 * Returns an array of product IDs sorted by relevance (best match first).
 * If nothing is detected, returns products for the given company (or all).
 */
export function detectProducts(
  segment: SegmentData,
  campaignName?: string,
  company?: string
): string[] {
  const haystack = [
    campaignName ?? "",
    segment.name ?? "",
    ...(segment.keywords ?? []),
    ...(segment.interests ?? []),
    segment.objective ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Strip diacritics for fuzzy match

  const scores: Record<string, number> = {};

  for (const [productId, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    // If company is specified, only match products from that company
    if (company) {
      const product = ALL_PRODUCTS[productId];
      if (product && product.company !== company) continue;
    }

    let score = 0;
    for (const kw of keywords) {
      const normalizedKw = kw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (haystack.includes(normalizedKw)) {
        // Longer keyword matches = higher confidence
        score += normalizedKw.length;
      }
    }
    if (score > 0) {
      scores[productId] = score;
    }
  }

  const matched = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // If nothing detected → return all products for the company
  if (matched.length === 0) {
    if (company === "MBC") return Object.keys(MBC_PRODUCT_CATALOG);
    if (company === "MBI") return Object.keys(MBI_PRODUCT_CATALOG);
    return Object.keys(ALL_PRODUCTS);
  }

  return matched;
}

/**
 * Get product catalog entries for given product IDs.
 */
export function getProductEntries(productIds: string[]): ProductCatalogEntry[] {
  return productIds
    .map((id) => ALL_PRODUCTS[id])
    .filter(Boolean);
}

/**
 * Get the catalog for a specific company.
 */
export function getProductCatalog(company: string): Record<string, ProductCatalogEntry> {
  return company === "MBI" ? MBI_PRODUCT_CATALOG : MBC_PRODUCT_CATALOG;
}

/**
 * Get the final URL for a product + company combination.
 */
export function getProductUrl(
  productId: string,
  company: string = "MBC"
): string | null {
  const product = ALL_PRODUCTS[productId];
  if (!product) return null;
  return product.finalUrls[company] ?? product.finalUrls[product.company] ?? null;
}
