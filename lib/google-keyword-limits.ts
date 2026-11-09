// ============================================================
// Trần độ dài từ khoá của Google — kiểm TRƯỚC khi gửi
// ------------------------------------------------------------
// VÌ SAO CẦN: lệnh tạo chiến dịch đi theo LÔ, và một dòng hỏng làm Google gạt
// CẢ LÔ. Một từ khoá dài quá là mất luôn cả campaign.
//
// CA THẬT (22/09/2026): người dùng bấm "Tạo campaign (tắt sẵn)" và nhận
//   Keyword text has too many words.
//   (trường: mutate_operations[10].ad_group_criterion_operation.create.keyword.text)
//   [criterion_error: 6]
// Câu này nói SỐ THỨ TỰ trong lô, không nói TỪ KHOÁ NÀO. Người đọc không có
// cách nào lần ra từ nào phải sửa — trong khi danh sách có thể vài chục từ.
//
// TRẦN ĐO THẬT bằng validate_only trên tài khoản MBC, có đối chứng hai phía:
//   10 từ  → Google nhận        11 từ  → "Keyword text has too many words."
//   80 ký tự → Google nhận      81 ký tự → "Keyword text should be less than 80 chars."
// Kiểm cả trên tiếng Việt thật ("phần mềm hóa đơn điện tử cho doanh nghiệp
// nhỏ" = 10 từ, nhận; thêm chữ "và" thành 11 từ, bị chặn).
//
// KHÔNG lấy số từ tài liệu: con số trong tài liệu Google từng lệch với hành vi
// thật ở chỗ khác trong repo này rồi. Hai số trên là kết quả đo.
// ============================================================

/** Số từ tối đa. Đo được: 10 nhận, 11 bị chặn. */
export const MAX_KEYWORD_WORDS = 10;

/** Số ký tự tối đa. Đo được: 80 nhận, 81 bị chặn (lời Google là "less than 80"
 *  nhưng hành vi thật là 80 vẫn qua — tin phép đo, không tin câu chữ). */
export const MAX_KEYWORD_CHARS = 80;

export interface KeywordCheck {
  ok: boolean;
  words: number;
  chars: number;
  /** Câu tiếng Việt nói rõ sai gì và phải sửa thế nào. */
  problem?: string;
}

/**
 * Đếm từ theo cách Google đếm: tách theo khoảng trắng.
 *
 * Gộp khoảng trắng lặp lại trước khi đếm — "hoa   don" là HAI từ, không phải
 * bốn. Không dùng split(" ") trần vì nó sinh ra phần tử rỗng.
 */
export function countKeywordWords(text: string): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export function checkKeyword(text: string): KeywordCheck {
  const raw = (text ?? "").trim();
  const words = countKeywordWords(raw);
  const chars = raw.length;

  if (words === 0) {
    return { ok: false, words, chars, problem: "Từ khoá rỗng." };
  }
  if (words > MAX_KEYWORD_WORDS) {
    return {
      ok: false, words, chars,
      problem: `${words} từ — Google chỉ nhận tối đa ${MAX_KEYWORD_WORDS} từ. Bỏ ${words - MAX_KEYWORD_WORDS} từ phụ (thường là "cho", "tại", "và", "của") là vừa.`,
    };
  }
  if (chars > MAX_KEYWORD_CHARS) {
    return {
      ok: false, words, chars,
      problem: `${chars} ký tự — Google chỉ nhận tối đa ${MAX_KEYWORD_CHARS}. Cắt ngắn ${chars - MAX_KEYWORD_CHARS} ký tự.`,
    };
  }
  return { ok: true, words, chars };
}

export interface KeywordPlanItem { keyword: string; matchType?: string }

export interface KeywordPlan<T extends KeywordPlanItem> {
  /** Từ khoá gửi được. */
  usable: T[];
  /** Từ khoá bị loại, kèm lý do — PHẢI hiện ra, không được lặng lẽ bỏ. */
  rejected: Array<{ keyword: string; problem: string }>;
  /** true khi KHÔNG còn từ khoá nào dùng được. Lúc đó phải chặn hẳn: chiến
   *  dịch Search không có từ khoá thì không hiển thị được cho ai. */
  allRejected: boolean;
}

/**
 * Lọc danh sách từ khoá trước khi gửi Google.
 *
 * BỎ chứ không CHẶN — giống cách repo này đã xử tiêu đề dài quá 30 ký tự: bỏ
 * dòng hỏng, giữ phần chạy được, và NÓI RA đã bỏ gì. Chặn cả lần tạo vì một
 * từ khoá thừa chữ "và" là bắt người dùng làm lại từ đầu cho một lỗi vụn.
 *
 * NGOẠI LỆ: bỏ hết thì phải chặn — xem `allRejected`.
 */
export function planKeywords<T extends KeywordPlanItem>(list: T[]): KeywordPlan<T> {
  const usable: T[] = [];
  const rejected: Array<{ keyword: string; problem: string }> = [];

  for (const item of list ?? []) {
    const c = checkKeyword(item?.keyword ?? "");
    if (c.ok) usable.push(item);
    else rejected.push({ keyword: item?.keyword ?? "(rỗng)", problem: c.problem ?? "không hợp lệ" });
  }

  return { usable, rejected, allRejected: usable.length === 0 && rejected.length > 0 };
}
