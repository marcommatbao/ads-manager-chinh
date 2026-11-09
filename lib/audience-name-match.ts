// ============================================================
// Chấm điểm khớp tên khi tra mục nhắm trên Meta.
// ------------------------------------------------------------
// VÌ SAO CÓ FILE NÀY. Bản trước lấy THẲNG kết quả đầu tiên Meta trả về, không
// kiểm xem nó có liên quan gì tới thứ đã hỏi không. Kết quả trên tài khoản thật
// ngày 16/09/2026: AI đề xuất "Software developer", Meta trả về "Hãng phát
// triển trò chơi điện tử" (26,5 triệu người) và hệ thống nhận luôn. Bấm Áp dụng
// là nhắm vào tệp mê game — sai tệp, bằng tiền thật.
//
// Kèm một cái bẫy nữa: Meta trả tên theo NGÔN NGỮ của lời gọi. Hỏi bằng tiếng
// Anh mà nhận tên tiếng Việt thì không có cách nào so được hai chuỗi. Nên bên
// gọi phải hỏi kèm locale=en_US, và so tiếng Anh với tiếng Anh.
// ============================================================

/** Bỏ dấu, hạ thường, bỏ ký tự lạ, tách từ. */
function tokens(s: string): string[] {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(w => w.length > 1);
}

/**
 * Điểm khớp 0..1 giữa tên đã hỏi và tên Meta trả về.
 *
 * Dùng tỉ lệ từ của CÂU HỎI xuất hiện trong câu trả lời (không phải Jaccard hai
 * chiều): Meta hay thêm chữ vào ("Web developer" → "Web development (website)"),
 * phạt vì phần thêm đó sẽ loại oan những cái đúng. Nhưng thiếu từ của câu hỏi
 * thì phải phạt — đó chính là chỗ "software developer" trượt khỏi "video game
 * developer": chỉ còn 1/2 từ.
 */
export function scoreNameMatch(query: string, candidate: string): number {
  const q = tokens(query);
  const c = tokens(candidate);
  if (q.length === 0 || c.length === 0) return 0;

  const qs = q.join(" ");
  const cs = c.join(" ");
  if (qs === cs) return 1;
  if (cs.includes(qs) || qs.includes(cs)) return 0.9;

  const cSet = new Set(c);
  const hit = q.filter(w => cSet.has(w) || c.some(x => sameStem(w, x))).length;
  return hit / q.length;
}

/**
 * Hai từ coi như cùng gốc khi chung tiền tố đủ dài: developer ↔ development,
 * hosting ↔ hosted. Cần ngưỡng 5 ký tự và cả hai từ đều đủ dài, nếu không
 * "web" sẽ dính "website" và "video" dính "vietnam" — loại nhầm còn đỡ, dính
 * nhầm là nhắm sai tệp.
 */
function sameStem(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 5;
}

/** Dưới ngưỡng này coi như KHÔNG tìm thấy, thà mất một gợi ý còn hơn nhắm nhầm. */
export const NAME_MATCH_THRESHOLD = 0.6;

export interface NameCandidate { name: string }

/**
 * Chọn ứng viên khớp nhất, hoặc null nếu không cái nào đủ ngưỡng.
 * Hoà điểm thì lấy cái Meta xếp trước (Meta đã xếp theo độ phổ biến).
 */
export function pickBestMatch<T extends NameCandidate>(
  query: string,
  candidates: T[],
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const cand of candidates) {
    const score = scoreNameMatch(query, cand.name);
    if (!best || score > best.score) best = { item: cand, score };
  }
  if (!best || best.score < NAME_MATCH_THRESHOLD) return null;
  return best;
}
