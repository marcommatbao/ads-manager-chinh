// ============================================================
// Ý định của một lượt tìm — từ điển, so khớp trên chữ BỎ DẤU
// ============================================================
// Tách riêng với lib/search-term-plan.ts `intentOf` (dùng cho trang
// /google-search, nhóm cho mục đích thêm từ khoá). Ở đây câu hỏi khác: "tiền
// của lượt tìm này rơi vào ai" — nên có nhóm khách cũ tra cứu, sản phẩm khác
// của Mắt Bão, tên đối thủ, và thứ tự ưu tiên cố định để mỗi lượt tìm chỉ vào
// ĐÚNG MỘT nhóm (tiền không bị đếm hai lần giữa các nhóm).
//
// Thứ tự (khớp lượt chẩn đoán tay 25/09): thương hiệu mình → đối thủ → tra
// cứu/điều hướng → hỏi cách làm → ý định mua → còn lại.

import { stripDiacritics, tokens } from "./text"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { mentionsAny, type ProductCatalog } from "./product-catalog"

export type Intent =
  | "own_brand"     // có tên thương hiệu mình — LUÔN là thương hiệu (user chốt 19/10), kể cả kèm sản phẩm / đăng nhập
  | "own_other"     // sản phẩm / tên riêng của công ty ANH EM (MBC ↔ MBI), không phải sản phẩm của công ty này
  | "competitor"
  | "lookup"        // tra cứu, đăng nhập, gõ URL, tổng đài
  | "info"          // hỏi cách làm, kiến thức
  | "buy"
  | "generic"

export interface IntentLexicon {
  /** Thương hiệu mình, bỏ dấu, chữ thường. */
  brand: string[]
  /** Tên đối thủ, bỏ dấu, chữ thường. So khớp CHUỖI CON (tên hay bị viết liền: "misameinvoice"). */
  competitors: string[]
  /** Sản phẩm của công ty + công ty anh em (gói Mắt Bão). Không có → không phân biệt sản phẩm (bản khách). */
  catalog?: ProductCatalog
}

export const INTENT_LABEL: Record<Intent, string> = {
  own_brand: "Tìm thương hiệu",
  own_other: "Tìm sản phẩm của công ty khác (không bán ở đây)",
  competitor: "Tên đối thủ",
  lookup: "Tra cứu / đăng nhập",
  info: "Hỏi cách làm",
  buy: "Có ý định mua",
  generic: "Chung chung",
}

// Tên thương hiệu đối thủ là thông tin công khai; bản này là mặc định cho hoá
// đơn / chữ ký số, ghi đè được bằng data/case-lexicon.json (lib/case/targets.ts).
export const DEFAULT_COMPETITORS = [
  "misa", "meinvoice", "easyinvoice", "viettel", "vinvoice", "sinvoice", "bkav", "ehoadon", "vnpt",
  "minvoice", "m invoice", "fpt", "cyberbill", "htinvoice", "goinvoice", "trungnguyen", "sapo",
  "ihoadon", "evan", "vin hoadon", "hddt vin", "invoice com vn", "einvoice vn", "laphoadon",
  "kiotviet", "softdreams", "wininvoice", "safeinvoice", "vininvoice",
]
export const DEFAULT_BRAND = ["matbao", "mat bao", "mifi"]

const LOOKUP = /https?|www|tra ?cuu|tracuu|login|dang nhap|tong dai|lien he|hotline|\.vn|\bvn\b|\d{8,}|trang xuat/
/** Điều hướng thật sự khi lượt tìm đã nêu sản phẩm mình: "đăng nhập hosting", không phải "tên miền .vn" / "tra cứu tên miền". */
const NAV = /https?|www|login|dang nhap|tong dai|lien he|hotline|\d{8,}/
const INFO = /\bcach\b|huong dan|la gi|the nao|nhu the|mau |viet hoa don|quy dinh|nghi dinh|thong tu|dang ky su dung .* co quan thue|cua benh vien|ke khai/
// KHÔNG có "\bgia\b": bỏ dấu thì "giả" (hoá đơn giả) trùng "giá" — xem isPriceWord.
const BUY = /\bmua\b|dich vu|bang gia|phan mem|dang ky hoa don|cung cap|nha cung cap/

/** "giá" viết có dấu, hoặc "gia" trong câu gõ KHÔNG dấu nào (người gõ không dấu). Loại "giả", "gia đình"… có dấu. */
function isPriceWord(term: string): boolean {
  const t = tokens(term)
  if (t.includes("giá")) return true
  return stripDiacritics(term) === term.normalize("NFC").toLowerCase() && t.includes("gia")
}

export function mentionsBrand(term: string, lex: IntentLexicon): boolean {
  const x = stripDiacritics(term)
  return lex.brand.some((b) => x.includes(b))
}

export function intentOf(term: string, lex: IntentLexicon): Intent {
  const x = stripDiacritics(term)
  const cat = lex.catalog
  const ownProduct = !!cat && mentionsAny(term, cat.own)
  // Sản phẩm công ty anh em chỉ tính khi KHÔNG nêu sản phẩm mình ("xuất hoá đơn tên miền" vẫn là tên miền).
  const siblingProduct = !!cat && !ownProduct && mentionsAny(term, cat.sibling.products)
  if (cat && !ownProduct && mentionsAny(term, cat.sibling.brand)) return "own_other"
  if (lex.brand.some((b) => x.includes(b))) return siblingProduct ? "own_other" : "own_brand"
  if (lex.competitors.some((c) => x.includes(c))) return "competitor"
  if (siblingProduct) return "own_other"
  // Nêu sản phẩm mình: điều hướng thật ("đăng nhập hosting") → tra cứu; từ báo sắp mua ("kiểm tra tên miền", "tên miền .vn") → mua.
  if (ownProduct && NAV.test(x)) return "lookup"
  if (ownProduct && mentionsAny(term, cat!.buyHints)) return "buy"
  if (LOOKUP.test(x)) return "lookup"
  if (INFO.test(x)) return "info"
  if (BUY.test(x) || isPriceWord(term)) return "buy"
  return "generic"
}

export interface TermRow {
  term: string
  cost: number
  clicks: number
  conversions: number
  allConversions: number
}

export interface IntentBucket {
  intent: Intent
  cost: number
  clicks: number
  terms: number
  conversions: number
  allConversions: number
  /** Đắt nhất trước. */
  examples: { term: string; cost: number; clicks: number }[]
}

export function bucketByIntent(rows: TermRow[], lex: IntentLexicon, maxExamples = 8): IntentBucket[] {
  const map = new Map<Intent, IntentBucket & { all: TermRow[] }>()
  for (const r of rows) {
    const k = intentOf(r.term, lex)
    const b = map.get(k) ?? { intent: k, cost: 0, clicks: 0, terms: 0, conversions: 0, allConversions: 0, examples: [], all: [] }
    b.cost += r.cost
    b.clicks += r.clicks
    b.terms += 1
    b.conversions += r.conversions
    b.allConversions += r.allConversions
    b.all.push(r)
    map.set(k, b)
  }
  return [...map.values()]
    .map(({ all, ...b }) => ({
      ...b,
      examples: all.sort((a, z) => z.cost - a.cost).slice(0, maxExamples).map(({ term, cost, clicks }) => ({ term, cost, clicks })),
    }))
    .sort((a, z) => z.cost - a.cost)
}

/** Nhãn ý định theo ngôn ngữ (INTENT_LABEL giữ bản tiếng Việt). */
export const intentLabel = (i: Intent, t: TFunction = makeT("vi")): string => t(`libcase.c.intent.${i}` as never)
