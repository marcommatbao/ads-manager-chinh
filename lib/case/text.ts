// ============================================================
// Chữ tiếng Việt cho phần "Xử lý chiến dịch" — bỏ dấu, tách từ
// ============================================================
// Google Ads KHÔNG coi "tra cứu" và "tra cuu" là một: phủ định có dấu không
// chặn lượt tìm không dấu (đo thật 25/09: có phủ định "tra cứu" mà "tra cuu"
// vẫn lọt). Nên có hai việc khác nhau:
//   - phân loại ý định → so khớp trên chữ ĐÃ bỏ dấu (người gõ kiểu nào cũng là
//     một ý định);
//   - mô phỏng phủ định → so khớp ĐÚNG như Google (giữ dấu), và sinh thêm bản
//     không dấu cho từng phủ định.

/** Bỏ dấu + chữ thường. "Hoá Đơn Điện Tử" → "hoa don dien tu". */
export function stripDiacritics(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
}

/**
 * Tách từ giữ nguyên dấu (dạng NFC, chữ thường). Dấu câu và ký tự đặc biệt là
 * ranh giới từ — Google cũng bỏ qua chúng khi so từ khoá.
 */
export function tokens(s: string): string[] {
  return (s ?? "").normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** true khi dãy từ `needle` xuất hiện liền nhau trong `hay`. */
export function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}
