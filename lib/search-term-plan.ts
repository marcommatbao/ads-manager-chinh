// ============================================================
// Bộ chấm điểm cụm tìm kiếm — biến danh sách thành việc phải làm
// ------------------------------------------------------------
// Tách khỏi app/(dashboard)/google-search/page.tsx để KIỂM CHỨNG ĐƯỢC: đây là
// phần quyết định "nên thêm cụm nào / chặn cụm nào", nằm trong một React
// client component thì không có cách nào chạy thử ngoài việc mở trình duyệt
// bấm tay. Toàn bộ hàm dưới đây là hàm thuần, không phụ thuộc React.
// ============================================================

import type { TFunction } from "@/lib/i18n/translate";
import { viT, nfOf, tk } from "@/lib/google-i18n";

export interface PlanTerm {
  searchTerm: string; campaignName: string; campaignId: string; adGroupId: string;
  clicks: number; conversions: number; cost: number;
}

/**
 * Xếp một cụm tìm kiếm vào nhóm ý định, để quyết định chặn có căn cứ.
 *
 * VÌ SAO CẦN: xếp theo chi phí thì đầu bảng là "tên miền giá rẻ" (₫492.421) —
 * nhưng đó là người ĐANG MUỐN MUA. 0 chuyển đổi ở một cụm mua hàng thường là
 * vấn đề trang đích hoặc đo lường, KHÔNG phải từ khoá sai. Chặn nó là tự cắt
 * khách. Còn "whois", "check domain" thì đúng là người dùng công cụ, chặn được.
 * Chỉ đưa ra tiền mà không đưa ra ý định là mời người dùng chặn nhầm.
 */
export function intentOf(term: string, t: TFunction = viT): { key: "brand" | "buy" | "tool" | "competitor" | "job" | "free" | "other"; label: string; safe: boolean } {
  const tl = term.toLowerCase();
  const has = (arr: string[]) => arr.some(w => tl.includes(w));
  // THƯƠNG HIỆU MÌNH phải xét TRƯỚC mọi nhóm khác. "công ty cổ phần mắt bão"
  // (56 nhấp, ₫231.304, 0 chuyển đổi) đang bị xếp vào "khác" — tức nhãn CHẶN
  // ĐƯỢC. Người gõ đúng tên công ty mình là khách tìm đúng mình; chặn cụm đó
  // là tự cắt khách ở chỗ rẻ nhất. 0 chuyển đổi trên cụm thương hiệu gần như
  // luôn là trang đích hoặc đo lường, không phải từ khoá sai.
  // So khớp thương hiệu BỎ DẤU. Dữ liệu thật 03/09/2026 có cụm "mãtbao"
  // (61 nhấp, 5.2 chuyển đổi) — gõ sai dấu, danh sách chữ-nguyên-văn không bắt
  // được. Bỏ dấu thì "mãtbao", "mắt bão", "mat bao" quy về cùng một chuỗi.
  //
  // CỐ Ý chỉ bỏ dấu cho nhánh THƯƠNG HIỆU, không áp cho các nhánh khác: nhánh
  // "ý định mua" có từ "giá", bỏ dấu thành "gia" sẽ khớp bừa vào "gia đình",
  // "giao hàng", "quốc gia". Tên thương hiệu đủ đặc trưng nên không có rủi ro đó.
  const noTone = tl.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  if (["mat bao", "matbao", "matbaocloud"].some(w => noTone.includes(w)))
    return { key: "brand", label: t("libgoogle.stp.i.brand"), safe: false };
  // So khớp ĐỐI THỦ cũng bỏ dấu, cùng lý do với nhánh thương hiệu: danh sách
  // viết không dấu mà khách gõ có dấu thì trượt. Ca thật 04/09/2026:
  // "pa việt nam" (10 nhấp, ₫89.365) bị dán nhãn "khác" vì danh sách chỉ có
  // "pa vietnam" — trong khi PA Vietnam là đối thủ. Cùng loại lỗi với
  // "hostinger vietnam" hôm 03/09.
  //
  // Mọi mục trong danh sách phải viết KHÔNG DẤU, vì vế trái đã bỏ dấu rồi.
  // An toàn một chiều: bỏ dấu chỉ làm nhận ra THÊM đối thủ ⇒ chỉ đẩy thêm cụm
  // xuống tầng "không nên thêm", không bao giờ đưa một cụm đối thủ trở lại
  // tầng nên thêm. Danh sách này cần mở rộng dần khi thấy tên mới.
  if (["namecheap", "godaddy", "cloudflare", "pa vietnam", "pavietnam", "pa viet nam", "tenten",
       "nhan hoa", "bkns", "vinahost", "azdigi", "tinohost", "porkbun", "hostvn", "inet",
       "z.com", "zcom", "lanit", "vietnix", "hostinger", "bluehost", "hostgator", "namesilo",
       "dynadot", "ionos", "ovh", "digitalocean", "vultr", "linode", "contabo", "squarespace",
       "wix"].some(w => noTone.includes(w)))
    return { key: "competitor", label: t("libgoogle.stp.i.competitor"), safe: true };
  if (has(["tuyển dụng", "tuyen dung", "lương", "việc làm", "viec lam"]))
    return { key: "job", label: t("libgoogle.stp.i.job"), safe: true };
  if (has(["whois", "rdap", "icann", "check", "kiểm tra", "kiem tra", "tra cứu", "tra cuu", "tra tên", "tra ten",
           "lookup", "là gì", "la gi", "ý nghĩa", "y nghia", "cách ", "huong dan", "hướng dẫn"]))
    return { key: "tool", label: t("libgoogle.stp.i.tool"), safe: true };
  if (has(["miễn phí", "mien phi", "free", "crack", "lậu"]))
    return { key: "free", label: t("libgoogle.stp.i.free"), safe: true };
  if (has(["mua", "đăng ký", "dang ky", "giá", "gia re", "gia ré", "bảng giá", "bang gia", "báo giá",
           "đặt", "thuê", "thue", "order", "gia hạn", "gia han"]))
    return { key: "buy", label: t("libgoogle.stp.i.buy"), safe: false };
  return { key: "other", label: t("libgoogle.stp.i.other"), safe: true };
}

// ─────────────────────────────────────────────────────────────
// Xếp tầng hành động — biến danh sách thành việc phải làm
// ─────────────────────────────────────────────────────────────
//
// VÌ SAO CẦN: danh sách "nên thêm" đang sắp theo SỐ CHUYỂN ĐỔI giảm dần, mà
// số đó không nói được nên thêm cái nào. Đối chiếu dữ liệu thật ngày
// 03/09/2026: 9 dòng đầu (tức 9 dòng tốt nhất trong 138) đều dưới 1 chuyển
// đổi và đều ĐẮT HƠN mốc tài khoản — dòng "tốt nhất" ₫104.006 vẫn đắt hơn
// 1,3 lần, dòng đầu bảng "hostinger vietnam" đắt hơn 6,5 lần và còn là tên
// ĐỐI THỦ. Sắp đúng nhưng xếp hạng sai thì người dùng thêm từ trên xuống và
// bơm tiền vào chỗ lỗ.
//
// Hai trục chấm, cả hai đều lấy từ dữ liệu có sẵn, KHÔNG có số đặt tay:
//   - CPA của cụm so với mốc CPA cụm tìm kiếm 30 ngày (API trả về)
//   - Độ mạnh bằng chứng = số chuyển đổi tuyệt đối
// Dưới 1 chuyển đổi là chuyển đổi phân bổ lẻ (0.1 / 0.3) — CPA tính trên đó
// là nhiễu, không phải tín hiệu, nên KHÔNG được xếp hạng theo nó.

export type AddTier = "add_now" | "add_watch" | "weak" | "avoid";

export const ADD_TIER: Record<AddTier, { label: string; rank: number; cls: string; match: "EXACT" | "PHRASE" | null; desc: string }> = {
  add_now:   { label: "✅ Thêm ngay",      rank: 0, cls: "bg-emerald-100 text-emerald-800", match: "EXACT",
    desc: "Đã có chuyển đổi thật và CPA rẻ hơn mốc — thêm bằng khớp chính xác để chủ động ra giá." },
  add_watch: { label: "🟡 Thêm, theo dõi", rank: 1, cls: "bg-amber-100 text-amber-800",     match: "PHRASE",
    desc: "Có chuyển đổi thật nhưng đắt hơn mốc dưới 2 lần — thêm bằng khớp cụm, giá thầu thấp, xem lại sau 2 tuần." },
  weak:      { label: "⏳ Chưa đủ căn cứ", rank: 2, cls: "bg-slate-100 text-slate-600",     match: null,
    desc: "Dưới 1 chuyển đổi — là chuyển đổi phân bổ lẻ, CPA tính trên đó là nhiễu. Chưa làm gì, chờ đủ dữ liệu." },
  avoid:     { label: "⛔ Không nên thêm", rank: 3, cls: "bg-red-100 text-red-700",         match: null,
    desc: "Tên đối thủ, hoặc CPA đắt hơn mốc từ 2 lần trở lên — thêm vào là bơm tiền vào chỗ đang lỗ." },
};

/** Nhãn / mô tả tầng theo ngôn ngữ (ADD_TIER giữ bản tiếng Việt cho nơi không truyền t). */
export const addTierText = (tier: AddTier, t: TFunction = viT) => ({ label: tk(t, `libgoogle.stp.add.${tier}.label`), desc: tk(t, `libgoogle.stp.add.${tier}.desc`) });
export const negTierText = (tier: NegTier, t: TFunction = viT) => ({ label: tk(t, `libgoogle.stp.neg.${tier}.label`), desc: tk(t, `libgoogle.stp.neg.${tier}.desc`) });

/** Dưới mức này là chuyển đổi phân bổ lẻ — chưa đủ để kết luận gì. */
const MIN_CONV_EVIDENCE = 1;
/** Đắt hơn mốc bao nhiêu lần thì khuyên đừng thêm. */
const CPA_AVOID_X = 2;

export interface TermGroup { term: string; clicks: number; cost: number; conversions: number; places: PlanTerm[] }

/** Chặn khớp cụm sẽ nuốt theo bao nhiêu cụm khác — API tính trên toàn bộ báo
 *  cáo cụm tìm kiếm, không chỉ trên hai danh sách hiển thị. */
export interface Blast { terms: number; conversions: number; cost: number }

export function addTierOf(g: TermGroup, benchmarkCpa: number | null, t: TFunction = viT): {
  tier: AddTier; why: string; cpa: number | null; ratio: number | null;
} {
  const intent = intentOf(g.term, t);
  const cpa = g.conversions > 0 ? g.cost / g.conversions : null;
  const ratio = cpa !== null && benchmarkCpa ? cpa / benchmarkCpa : null;

  if (intent.key === "competitor") {
    return { tier: "avoid", cpa, ratio,
      why: t("libgoogle.stp.why.comp") };
  }
  if (intent.key === "brand") {
    return { tier: "add_now", cpa, ratio,
      why: t("libgoogle.stp.why.brandAdd") };
  }
  if (benchmarkCpa === null) {
    return { tier: "weak", cpa, ratio,
      why: t("libgoogle.stp.why.noBench") };
  }
  if (g.conversions < MIN_CONV_EVIDENCE) {
    return { tier: "weak", cpa, ratio,
      why: t("libgoogle.stp.why.fewConv", { n: g.conversions.toFixed(1) }) };
  }
  if (ratio !== null && ratio <= 1) {
    return { tier: "add_now", cpa, ratio,
      why: t("libgoogle.stp.why.cheap", { r: ratio.toFixed(2) }) };
  }
  if (ratio !== null && ratio <= CPA_AVOID_X) {
    return { tier: "add_watch", cpa, ratio,
      why: t("libgoogle.stp.why.watch", { r: ratio.toFixed(1) }) };
  }
  return { tier: "avoid", cpa, ratio,
    why: t("libgoogle.stp.why.avoid", { r: ratio ? ratio.toFixed(1) : "?" }) };
}

export type NegTier = "block_now" | "block_scoped" | "dont_block";

export const NEG_TIER: Record<NegTier, { label: string; rank: number; cls: string; desc: string }> = {
  block_now:    { label: "🚫 Chặn ngay",       rank: 0, cls: "bg-red-100 text-red-700",
    desc: "Không phải người muốn mua, và không ra đơn ở bất kỳ nhóm quảng cáo nào. Chặn được ngay." },
  block_scoped: { label: "⚠️ Chặn có điều kiện", rank: 1, cls: "bg-amber-100 text-amber-800",
    desc: "Đang ra đơn ở nhóm quảng cáo khác — chỉ chặn ở nhóm nó không ra đơn, đừng chặn toàn tài khoản." },
  dont_block:   { label: "🛑 Đừng chặn",       rank: 2, cls: "bg-sky-100 text-sky-800",
    desc: "Ý định mua hoặc tên thương hiệu mình. Việc tiếp theo là kiểm trang đích và mã đo chuyển đổi, KHÔNG phải chặn." },
};

export function negTierOf(g: TermGroup, conflicting: string[], blast?: Blast, t: TFunction = viT): {
  tier: NegTier; why: string; negMatch: "EXACT" | "PHRASE";
} {
  const intent = intentOf(g.term, t);
  if (intent.key === "brand") {
    return { tier: "dont_block", negMatch: "EXACT",
      why: t("libgoogle.stp.why.negBrand") };
  }
  if (intent.key === "buy") {
    return { tier: "dont_block", negMatch: "EXACT",
      why: t("libgoogle.stp.why.negBuy") };
  }
  // Chặn khớp cụm mà nuốt theo cụm ĐANG RA ĐƠN là tự bắn vào chân. Ca thật:
  // "tên miền" đứng đầu bảng đáng chặn, nhưng chặn khớp cụm sẽ chặn luôn
  // "mua tên miền", "đăng ký tên miền" — cả danh mục sản phẩm lõi.
  if (blast && blast.conversions > 0) {
    return { tier: "block_scoped", negMatch: "EXACT",
      why: t("libgoogle.stp.why.blast", { terms: blast.terms, conv: blast.conversions.toFixed(1), cost: Math.round(blast.cost).toLocaleString(nfOf(t)) }) };
  }
  if (conflicting.includes(g.term.trim().toLowerCase())) {
    return { tier: "block_scoped", negMatch: "EXACT",
      why: t("libgoogle.stp.why.conflict") };
  }
  return { tier: "block_now", negMatch: "PHRASE",
    why: t("libgoogle.stp.why.blockNow", { label: intent.label, blast: blast && blast.terms > 0 ? t("libgoogle.stp.why.blockNowBlast", { n: blast.terms }) : "" }) };
}
