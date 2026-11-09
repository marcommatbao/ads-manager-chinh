// ============================================================
// Phân loại từ khoá theo Ý ĐỊNH để tách ad group
// ============================================================
// Audit báo "8 ad group có >20 từ khoá (phân mảnh)" nhưng KHÔNG cho biết
// là những nhóm nào, gồm từ khoá gì, tách ra sao. Người dùng phải tự mở
// Google Ads dò tay — nghĩa là chẩn đoán đúng nhưng không dùng được.
//
// Phân loại ở đây là LUẬT, không phải AI: cùng một danh sách từ khoá thì
// luôn ra cùng một kết quả, và mỗi từ khoá đều chỉ ra được vì sao nó rơi
// vào nhóm đó. Chỗ này cố ý không gọi Gemini — người chạy quảng cáo cần
// kiểm chứng được lý do trước khi tách một ad group đang tiêu tiền, mà
// "AI bảo thế" thì không kiểm chứng được.

import type { TFunction } from "@/lib/i18n/translate";
import { viT, tk } from "@/lib/google-i18n";

export type KeywordIntent = "BRAND" | "COMPETITOR" | "TRANSACTIONAL" | "TOOL_FREE" | "INFORMATIONAL" | "GENERIC";

export interface IntentRule {
  intent: KeywordIntent;
  /** Nhãn tiếng Việt hiển thị cho người dùng. */
  label: string;
  /** Vì sao nhóm này nên đứng riêng. */
  rationale: string;
}

export const INTENT_META: Record<KeywordIntent, IntentRule> = {
  BRAND: {
    intent: "BRAND",
    label: "Thương hiệu",
    rationale: "Người đã biết tên bạn — CPC rẻ và tỷ lệ chuyển đổi cao nhất. Để chung với từ khoá chung sẽ bị nhóm kia kéo tụt Quality Score và làm CPA trung bình trông tệ hơn thực tế.",
  },
  COMPETITOR: {
    intent: "COMPETITOR",
    label: "Đối thủ",
    rationale: "Quality Score luôn thấp vì trang đích không khớp tên đối thủ. Để chung sẽ kéo Ad Rank của cả ad group xuống — phải tách và chấp nhận CPC cao riêng ở đây.",
  },
  TRANSACTIONAL: {
    intent: "TRANSACTIONAL",
    label: "Sẵn sàng mua",
    rationale: "Có tín hiệu mua (mua, giá, báo giá, đăng ký…). Đáng đặt giá thầu cao nhất và cần quảng cáo nói thẳng về giá/ưu đãi.",
  },
  TOOL_FREE: {
    intent: "TOOL_FREE",
    label: "Tra cứu / miễn phí",
    rationale: "Người tìm công cụ tra cứu hoặc bản miễn phí — hiếm khi mua ngay. Tách riêng để đặt giá thầu thấp, hoặc chặn hẳn nếu không có sản phẩm miễn phí.",
  },
  INFORMATIONAL: {
    intent: "INFORMATIONAL",
    label: "Tìm hiểu",
    rationale: "Đang tìm hiểu (là gì, cách, hướng dẫn, so sánh). Cần quảng cáo và trang đích khác hẳn nhóm sẵn sàng mua.",
  },
  GENERIC: {
    intent: "GENERIC",
    label: "Chung",
    rationale: "Từ khoá danh mục, chưa lộ ý định cụ thể. Đây là nhóm nền — nên giữ lại sau khi đã tách các nhóm trên ra.",
  },
};

/** Nhãn + lý do của một ý định theo ngôn ngữ của t (INTENT_META giữ bản tiếng Việt cho nơi không truyền t). */
export function intentMetaT(intent: KeywordIntent, t: TFunction = viT): { label: string; rationale: string } {
  return { label: tk(t, `libgoogle.kis.${intent}.label`), rationale: tk(t, `libgoogle.kis.${intent}.rationale`) };
}

/** Bỏ dấu tiếng Việt để so khớp không phụ thuộc cách gõ. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function norm(s: string): string {
  return stripDiacritics(String(s).toLowerCase()).replace(/[[\]"+]/g, " ").replace(/\s+/g, " ").trim();
}

/** Bỏ luôn khoảng trắng. Người dùng gõ "pa vietnam" nhưng từ khoá trong tài
 *  khoản là "pavietnam", "pa việt nam", "pa viet nam" — cách viết liền hay
 *  rời chỉ là thói quen gõ, KHÔNG phải hai thương hiệu khác nhau. So bằng
 *  norm() thuần thì 3/5 biến thể trượt, và trượt trong im lặng: từ khoá đối
 *  thủ rơi vào nhóm "Chung" nên đặc điểm CPA cao / QS thấp của chúng bị hoà
 *  tan mất. */
function squash(s: string): string {
  return norm(s).replace(/\s+/g, "");
}

/** So khớp liền-rời. Yêu cầu tối thiểu 4 ký tự sau khi bỏ khoảng trắng để
 *  một từ ngắn không quét trúng những từ chẳng liên quan. */
function matches(keyword: string, term: string): boolean {
  const nk = norm(keyword), nt = norm(term);
  if (!nt) return false;
  if (nk.includes(nt)) return true;
  const sk = squash(keyword), st = squash(term);
  return st.length >= 4 && sk.includes(st);
}

const TRANSACTIONAL_WORDS = ["mua", "gia", "bao gia", "bang gia", "dang ky", "dat mua", "thue", "khuyen mai", "uu dai", "giam gia", "chi phi", "bao nhieu tien", "o dau", "uy tin", "tot nhat", "dich vu"];
const TOOL_FREE_WORDS = ["mien phi", "free", "tra cuu", "kiem tra", "check", "cong cu", "tool", "crack", "lau", "download", "tai ve"];
const INFORMATIONAL_WORDS = ["la gi", "cach", "huong dan", "tai sao", "vi sao", "so sanh", "khac nhau", "nen chon", "co nen", "danh gia", "review", "tim hieu", "kien thuc"];

/**
 * Phân loại một từ khoá.
 * `brandTerms` và `competitorTerms` do người dùng cấu hình — KHÔNG đoán,
 * vì đoán sai tên thương hiệu sẽ đẩy nhầm nhóm sinh lời nhất đi chỗ khác.
 */
export function classifyKeyword(
  keyword: string,
  brandTerms: string[],
  competitorTerms: string[]
): { intent: KeywordIntent; matched: string | null } {
  const k = norm(keyword);
  if (!k) return { intent: "GENERIC", matched: null };

  // Thứ tự có chủ đích: thương hiệu và đối thủ thắng mọi tín hiệu khác.
  // "mua hosting matbao" là từ khoá THƯƠNG HIỆU, không phải từ khoá chung
  // có kèm chữ "mua" — nhóm thương hiệu mới là nhóm quyết định cách đặt giá.
  for (const b of brandTerms.filter(Boolean)) {
    if (matches(keyword, b)) return { intent: "BRAND", matched: b };
  }
  for (const c of competitorTerms.filter(Boolean)) {
    if (matches(keyword, c)) return { intent: "COMPETITOR", matched: c };
  }
  for (const w of TOOL_FREE_WORDS) {
    if (k.includes(w)) return { intent: "TOOL_FREE", matched: w };
  }
  for (const w of INFORMATIONAL_WORDS) {
    if (k.includes(w)) return { intent: "INFORMATIONAL", matched: w };
  }
  for (const w of TRANSACTIONAL_WORDS) {
    if (k.includes(w)) return { intent: "TRANSACTIONAL", matched: w };
  }
  return { intent: "GENERIC", matched: null };
}

/** Ngưỡng Google/thực hành chung: trên mức này thì một bộ RSA không thể
 *  nói vừa lòng mọi từ khoá trong nhóm. */
export const OVERSIZED_AD_GROUP = 20;
/** Dưới mức này thì nhóm quá nhỏ để tối ưu riêng — nên gộp. */
export const UNDERSIZED_AD_GROUP = 3;
/** Tách chỉ đáng làm khi nhóm con đủ lớn để tự học. */
export const MIN_SPLIT_SIZE = 3;
/** …và thật sự mang tiền. Một nhóm con 4 từ khoá tiêu 0₫ thì tách ra chỉ
 *  để thay đổi đúng con số 0. */
export const MATERIAL_COST_SHARE = 0.05;
/** …hoặc mang chuyển đổi, kể cả khi chi phí còn nhỏ. */
export const MIN_SPLIT_CONVERSIONS = 5;
/** Một ý định chiếm từng này chi phí trở lên thì nhóm coi như THỐNG NHẤT —
 *  nhiều từ khoá không có nghĩa là phân mảnh. */
export const DOMINANT_SHARE = 0.8;
