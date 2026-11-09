// ============================================================
// Sản phẩm của từng công ty gói Mắt Bão — để xếp ý định lượt tìm THEO SẢN PHẨM
// ============================================================
// Đo 19/10 (phiên #mupbhf, "MBC - Search-Domain-Brand-HN-HCM-24/10"): luật cũ viết cứng
// cho hoá đơn điện tử (matbao.in) coi "tên miền", "domain", "tra cứu", "vn" là sản phẩm
// khác / tra cứu → đề xuất phủ định chặn 603 lượt tìm, 239 đơn của chính chiến dịch tên miền.
//
// Hai công ty dùng chung thương hiệu "Mắt Bão" nhưng bán sản phẩm khác nhau (user chốt 19/10):
//   MBC — Mắt Bão (matbao.net): tên miền, hosting, email, máy chủ/cloud/VPS, SSL,
//         Microsoft 365, Google Workspace, thiết kế website.
//   MBI — matbao.in:            hoá đơn điện tử, hợp đồng điện tử, chữ ký số.
// Sản phẩm của công ty kia = "sản phẩm khác" (own_other) — là thứ DUY NHẤT được phủ định
// theo nhóm "sản phẩm khác". Sản phẩm của chính công ty không bao giờ vào nhóm đó.
//
// So khớp theo DÃY TỪ bỏ dấu (không theo chuỗi con): "mail" không khớp "gmail",
// "matbao in" không khớp "matbao internet".

import { containsSequence, stripDiacritics, tokens } from "./text"

export interface ProductCatalog {
  /** Website của công ty — hiện trong câu chữ. */
  site: string
  /** Sản phẩm của chính công ty (bỏ dấu). */
  own: string[]
  /** Từ đi kèm sản phẩm mình nghĩa là SẮP MUA, không phải tra cứu (vd "kiểm tra tên miền" = xem tên còn trống). */
  buyHints: string[]
  /** Công ty anh em cùng thương hiệu: tên riêng của nó + sản phẩm của nó (bỏ dấu). */
  sibling: { site: string; brand: string[]; products: string[] }
  /** Gói phủ định (có dấu — Google không khớp biến thể dấu; bản không dấu sinh thêm lúc dùng). */
  negatives: { competitor: string[]; lookup: string[]; own_other: string[] }
  /** Tên đối thủ để xếp ý định (bỏ dấu, so chuỗi con). */
  competitors: string[]
  /** Thương hiệu mình (bỏ dấu). */
  brand: string[]
}

const MBC_PRODUCTS = [
  "ten mien", "tenmien", "domain", "hosting", "email", "mail", "webmail", "may chu", "server", "vps", "cloud",
  "ssl", "microsoft 365", "office 365", "m365", "google workspace", "gsuite", "website", "thiet ke web",
]
const MBI_PRODUCTS = [
  "hoa don", "hddt", "einvoice", "e invoice", "chu ky so", "ky so", "token", "hop dong dien tu", "econtract", "e contract",
]

export const PRODUCT_CATALOG: Record<string, ProductCatalog> = {
  MBC: {
    site: "matbao.net",
    own: MBC_PRODUCTS,
    buyHints: ["tra cuu", "tracuu", "kiem tra", "check", "whois", "con trong", "dang ky", "vn", "com"],
    sibling: { site: "matbao.in", brand: ["mifi", "matbao in", "matbaoin", "mat bao invoice", "matbao invoice"], products: MBI_PRODUCTS },
    negatives: {
      competitor: ["pavietnam", "pa vietnam", "pa việt nam", "tenten", "nhanhoa", "nhân hòa", "nhân hoà", "inet vn", "azdigi", "vietnix", "bkns", "hostinger", "godaddy", "namecheap"],
      lookup: ["đăng nhập", "login", "tổng đài", "hotline"],
      own_other: ["hóa đơn điện tử", "hoá đơn điện tử", "hddt", "chữ ký số", "hợp đồng điện tử", "einvoice", "mifi"],
    },
    competitors: ["pavietnam", "pa vietnam", "tenten", "nhanhoa", "nhan hoa", "inet vn", "inet.vn", "azdigi", "vietnix", "bkns", "hostinger", "godaddy", "namecheap"],
    brand: ["matbao", "mat bao"],
  },
  MBI: {
    site: "matbao.in",
    own: MBI_PRODUCTS,
    buyHints: [],
    sibling: { site: "matbao.net", brand: ["matbao net", "matbao.net"], products: MBC_PRODUCTS },
    // Gói đã duyệt 25/09 cho Search HĐĐT — giữ nguyên.
    negatives: {
      competitor: ["misa", "meinvoice", "easyinvoice", "easy invoice", "viettel", "sinvoice", "vinvoice", "bkav", "ehoadon", "e hoadon", "vnpt", "minvoice", "m invoice", "fpt", "cyberbill", "htinvoice", "goinvoice", "sapo", "trungnguyen", "kiotviet", "softdreams", "wininvoice", "win hóa đơn", "vininvoice", "safeinvoice", "saveinvoice", "save invoice", "hilo", "vĩnh hy", "ihoadon", "ihoadondientu", "ehoadondientu", "laphoadon", "evan", "smartca", "ica"],
      lookup: ["tra cứu", "tracuu", "tracuuhoadon", "hoadondientu", "gdt", "https", "http", "www", "com vn", "tổng đài", "đăng nhập", "login"],
      own_other: ["domain", "tên miền", "google workspace", "hosting"],
    },
    competitors: [],
    brand: [],
  },
}

export const catalogOf = (company: string): ProductCatalog | undefined => PRODUCT_CATALOG[company]

/** Lượt tìm có chứa một trong các cụm (so dãy từ, bỏ dấu). */
export function mentionsAny(term: string, words: string[]): boolean {
  const t = tokens(stripDiacritics(term))
  return words.some((w) => containsSequence(t, tokens(w)))
}

// ============================================================
// Bản cài khách (19/10) — dựng bảng từ cấu hình công ty + Hồ sơ doanh nghiệp, KHÔNG viết cứng
// ============================================================
// Trước đây công ty ngoài gói Mắt Bão mà không gõ "Từ khoá thương hiệu" ở trang Thiết lập thì tool coi
// KHÔNG lượt tìm nào là thương hiệu, và không biết sản phẩm của họ. Nay:
//   thương hiệu = Từ khoá thương hiệu (Thiết lập) → nếu trống: tên thương hiệu (Hồ sơ) + tên công ty + tên miền;
//   sản phẩm    = Sản phẩm / dịch vụ chính + "Ngành / nhóm sản phẩm" (Hồ sơ doanh nghiệp);
//   công ty anh em = các công ty khác trong CÙNG bản cài — sản phẩm của họ là "sản phẩm khác".
// HÀM THUẦN, chạy được ở trình duyệt (trang Hồ sơ doanh nghiệp xem trước bằng chính hàm này).

export interface CompanyInfo {
  id: string
  label: string
  domain: string
  brandTerms?: string[]
  competitors?: string[]
  /** Từ Hồ sơ doanh nghiệp. */
  brandName?: string
  industry?: string
  products?: string[]
}

const clean = (s: string) => stripDiacritics(s ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()
const LEGAL_PREFIX = /^(cong ty|cty)( (tnhh|co phan|cp|mtv|tnhh mtv))?\s+/
const PLACEHOLDER = new Set(["chua thiet lap", "cong ty"])
const uniq = <T,>(xs: T[]) => [...new Set(xs)]
const DOMAIN_WORDS = ["ten mien", "tenmien", "domain"]
const DOMAIN_HINTS = ["tra cuu", "tracuu", "kiem tra", "check", "whois", "con trong", "dang ky", "vn", "com"]
export const GENERIC_LOOKUP_NEGATIVES = ["đăng nhập", "login", "tổng đài", "hotline"]

/** Từ thương hiệu (bỏ dấu) của một công ty. */
export function brandWordsOf(c: CompanyInfo): string[] {
  if (c.brandTerms?.length) return uniq(c.brandTerms.map(clean).filter((w) => w.length >= 2))
  const out: string[] = []
  for (const raw of [c.brandName, c.label]) {
    const n = clean(raw ?? "").replace(LEGAL_PREFIX, "")
    if (n.length < 3 || PLACEHOLDER.has(n)) continue
    out.push(n)
    if (n.includes(" ")) out.push(n.replace(/ /g, ""))
  }
  const d = (c.domain ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
  if (d) {
    const stem = clean(d.split(".")[0])
    if (stem.length >= 3) out.push(stem)
    if (d.includes(".")) out.push(clean(d))
  }
  return uniq(out)
}

/** Sản phẩm của một công ty: { match: bỏ dấu để xếp ý định, neg: chữ gốc để làm phủ định }. Bỏ tên thương hiệu khỏi tên sản phẩm. */
export function productsOf(c: CompanyInfo): { match: string; neg: string }[] {
  const brand = brandWordsOf(c)
  const parts = [...(c.products ?? []), ...(c.industry ?? "").split(/[,;/\n]|\s+và\s+|\s+va\s+/)]
  const out = new Map<string, string>()
  for (const p of parts) {
    let m = clean(p)
    for (const b of brand) m = ` ${m} `.replace(` ${b} `, " ").trim()
    if (m.length < 2 || m.length > 40 || m.split(" ").length > 5) continue
    if (!out.has(m)) out.set(m, (p ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim())
  }
  // Phủ định giữ chữ CÓ DẤU khi tên gốc đúng là cụm đó; đã bỏ tên thương hiệu thì dùng bản bỏ dấu (bản có dấu sinh lại lúc dùng không được).
  return [...out].map(([match, raw]) => { const t = tokens(raw).join(" "); return { match, neg: t && clean(t) === match ? t : match } })
}

export function deriveCatalog(self: CompanyInfo, others: CompanyInfo[] = []): ProductCatalog {
  const brand = brandWordsOf(self)
  const own = productsOf(self)
  const ownMatch = new Set(own.map((p) => p.match))
  const sibProducts = others.flatMap(productsOf).filter((p) => !ownMatch.has(p.match))
  const sibBrand = uniq(others.flatMap(brandWordsOf)).filter((b) => !brand.includes(b))
  const sellsDomain = own.some((p) => DOMAIN_WORDS.some((w) => mentionsAny(p.match, [w])))
  return {
    site: self.domain || self.label,
    own: own.map((p) => p.match),
    buyHints: sellsDomain ? DOMAIN_HINTS : [],
    sibling: { site: others.map((o) => o.domain || o.label).filter(Boolean).join(", "), brand: sibBrand, products: uniq(sibProducts.map((p) => p.match)) },
    negatives: {
      competitor: (self.competitors ?? []).slice(0, 60),
      lookup: GENERIC_LOOKUP_NEGATIVES,
      own_other: uniq([...sibProducts.map((p) => p.neg), ...sibBrand]).slice(0, 60),
    },
    competitors: uniq((self.competitors ?? []).map(clean).filter(Boolean)),
    brand,
  }
}
