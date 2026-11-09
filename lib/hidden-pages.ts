// ============================================================
// Trang đang TẠM ẨN khỏi ứng dụng.
// ------------------------------------------------------------
// Đây là NGUỒN DUY NHẤT. Xoá một dòng khỏi HIDDEN_PAGES là trang đó hiện lại
// đầy đủ ở mọi nơi: menu trái, menu mobile, trang Hướng dẫn, các link trỏ tới
// nó trong app, và cả đường dẫn gõ thẳng. Không còn chỗ thứ hai phải nhớ sửa —
// đó là lý do có file này thay vì xoá lẻ từng chỗ.
//
// Lưu ý: ẩn KHÔNG phải là gỡ. Toàn bộ mã của trang vẫn còn nguyên, API vẫn
// chạy; chỉ là không có đường vào từ giao diện.
// ============================================================

export interface HiddenPage {
  /** Đường dẫn gốc của trang. Mọi đường con (vd /audiences/123) cũng bị ẩn theo. */
  href: string;
  /** Tên hiển thị, dùng trong câu báo khi ai đó gõ thẳng đường dẫn. */
  label: string;
}

export const HIDDEN_PAGES: HiddenPage[] = [
  { href: "/audiences",           label: "Audiences" },
  { href: "/revenue-attribution", label: "Doanh thu thật" },
  // Đặt TRƯỚC "/reports" để ai gõ thẳng đường dẫn này vẫn thấy đúng tên trang
  // (hiddenPageFor lấy dòng khớp ĐẦU TIÊN; "/reports" đứng trước sẽ ăn hết).
  { href: "/reports/attribution",  label: "Attribution" },
  { href: "/reports",             label: "Báo cáo" },
  { href: "/google-audit",        label: "Google Audit" },

  // Gom về đây 22/09/2026. Trước đó bốn trang này bị ẩn bằng cách XOÁ dòng
  // khỏi mảng menu — cách đó bỏ sót: link trong app vẫn trỏ tới, và phải nhớ
  // sửa nhiều chỗ. Đo được 3 link còn treo (NBA "Mở tool", và 2 chỗ trong
  // lib/improvement-manual-guide.ts).
  //
  // ĐỔI HÀNH VI: ẩn qua đây thì middleware chặn luôn URL gõ thẳng. Trước đó
  // gõ URL vẫn vào được. Muốn mở lại bất kỳ trang nào: xoá đúng một dòng.
  { href: "/toolkit/ngram",              label: "N-Gram Finder" },
  { href: "/toolkit/budget-pacing",      label: "Budget Pacing" },
  { href: "/toolkit/ad-group-structure", label: "Cấu trúc nhóm QC" },
  { href: "/automation/audience",        label: "Audience Suggestions" },
];

/** Trang bị ẩn khớp với đường dẫn này, nếu có. */
export function hiddenPageFor(pathname: string): HiddenPage | null {
  return HIDDEN_PAGES.find(
    p => pathname === p.href || pathname.startsWith(`${p.href}/`),
  ) ?? null;
}

export function isHiddenPage(pathname: string): boolean {
  return hiddenPageFor(pathname) !== null;
}
