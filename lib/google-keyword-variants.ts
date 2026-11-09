// ============================================================
// Gộp biến thể dấu của từ khoá tiếng Việt
// ------------------------------------------------------------
// VÌ SAO CẦN: Google Keyword Planner trả về biến thể dấu như những từ khoá
// RIÊNG BIỆT, mỗi cái một dòng, và số lượt tìm của chúng thường BẰNG NHAU.
//
// Đo thật trên tài khoản MBC ngày 19/09/2026, một lượt gọi với 8 từ gốc trả về
// 499 dòng, trong đó:
//    18.100/tháng  vps giá rẻ
//    18.100/tháng  vps giá rẽ        ← sai dấu
//     2.400/tháng  thuê vps giá rẻ
//     2.400/tháng  thue vps gia re   ← không dấu
//     2.400/tháng  thue vps giá rẻ   ← nửa dấu
//     4.400/tháng  mua tên miền
//     4.400/tháng  mua ten miền      ← thiếu dấu
//     4.400/tháng  mua tên mien      ← thiếu dấu
//
// Con số bằng nhau là dấu hiệu Google đã GỘP CHÚNG khi báo cáo — chúng là cùng
// một nhu cầu tìm kiếm, không phải ba nhu cầu khác nhau.
//
// Thêm cả ba vào chiến dịch là **tự đấu giá với chính mình**: ba từ khoá của
// cùng một tài khoản cùng tranh một lượt hiển thị. Google chỉ chọn một để đấu,
// nhưng bảng báo cáo bị chia nhỏ, và người đọc tưởng mình đang phủ rộng hơn
// thực tế.
//
// Bản thân Google cũng đã tự khớp biến thể chính tả với match type PHRASE và
// BROAD — nên gõ đúng dấu MỘT lần là đủ để bắt cả những người gõ sai dấu.
//
// Lỗi liên quan trong mã: `creative-keywords/route.ts` chặn trùng bằng
// `keyword.trim().toLowerCase()` — KHÔNG bỏ dấu, nên ba biến thể trên là ba
// khoá khác nhau và đều thêm được.
// ============================================================

/** Bỏ dấu + bỏ ký tự không phải chữ/số, gộp khoảng trắng, hạ chữ thường.
 *  Dùng CHUNG cho mọi phép so khớp từ khoá để hai nơi không lệch nhau. */
export function normalizeKeywordKey(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Đếm ký tự có dấu — dùng để chọn bản viết ĐÚNG CHÍNH TẢ làm đại diện. */
function diacriticScore(s: string): number {
  let n = 0;
  for (const ch of s.normalize("NFD")) if (/[̀-ͯ]/.test(ch)) n++;
  if (/đ/i.test(s)) n += 1;
  return n;
}

export interface KeywordVariantGroup<T extends { keyword: string; avgMonthlySearches: number | null }> {
  /** Bản đại diện — viết đúng dấu nhất, lượt tìm cao nhất. */
  canonical: T;
  /** Các bản viết khác của cùng một cụm, KHÔNG gồm bản đại diện. */
  variants: T[];
  /** Lượt tìm dùng để xếp hạng: lấy giá trị LỚN NHẤT trong nhóm.
   *  KHÔNG cộng dồn — con số bằng nhau giữa các biến thể là dấu hiệu Google
   *  đã gộp sẵn, cộng lại là tự nhân đôi một lượng tìm kiếm có một. */
  volume: number | null;
}

/**
 * Gộp danh sách gợi ý thành các nhóm biến thể.
 *
 * Bản đại diện chọn theo: lượt tìm cao nhất → nhiều dấu nhất → ngắn nhất.
 * Ưu tiên lượt tìm trước để không bao giờ hiển thị con số nhỏ hơn thực tế;
 * ưu tiên dấu sau để bản hiện ra là bản viết đúng tiếng Việt.
 */
export function groupKeywordVariants<T extends { keyword: string; avgMonthlySearches: number | null }>(
  items: T[],
): Array<KeywordVariantGroup<T>> {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const key = normalizeKeywordKey(it.keyword);
    if (!key) continue;
    const arr = buckets.get(key);
    if (arr) arr.push(it);
    else buckets.set(key, [it]);
  }

  const groups: Array<KeywordVariantGroup<T>> = [];
  for (const arr of buckets.values()) {
    const sorted = [...arr].sort((a, b) => {
      const va = a.avgMonthlySearches ?? -1;
      const vb = b.avgMonthlySearches ?? -1;
      if (vb !== va) return vb - va;
      const da = diacriticScore(a.keyword);
      const db = diacriticScore(b.keyword);
      if (db !== da) return db - da;
      return a.keyword.length - b.keyword.length;
    });
    const [canonical, ...variants] = sorted;
    const vols = arr.map((x) => x.avgMonthlySearches).filter((v): v is number => typeof v === "number");
    groups.push({
      canonical,
      variants,
      volume: vols.length > 0 ? Math.max(...vols) : null,
    });
  }

  groups.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  return groups;
}

/**
 * Cụm này đã có trong bộ từ khoá chưa — so theo DẠNG CHUẨN HOÁ, không so chuỗi thô.
 *
 * Nếu không chuẩn hoá, "vps giá rẻ" đã có sẵn vẫn cho thêm "vps gia re", và
 * người dùng không hiểu vì sao báo cáo bị chia đôi.
 */
export function alreadyHasKeyword(existing: Array<{ keyword: string }>, candidate: string): boolean {
  const key = normalizeKeywordKey(candidate);
  return existing.some((k) => normalizeKeywordKey(k.keyword) === key);
}
