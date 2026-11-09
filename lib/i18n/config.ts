// ============================================================
// Song ngữ VN/EN (task #7135, mini-spec docs/mini-specs/I18N-GD1.md).
// Ngôn ngữ lưu trong cookie `lang` — KHÔNG đổi đường dẫn (/en/...), để mọi link, bookmark, callback Google/Meta giữ nguyên.
// Mặc định "vi" (bản Mắt Bão không đổi gì); bản cài khách muốn mặc định tiếng Anh: DEFAULT_LOCALE=en.
// ============================================================
export const LOCALES = ["vi", "en"] as const
export type Locale = (typeof LOCALES)[number]
export const LOCALE_COOKIE = "lang"

export function isLocale(v: unknown): v is Locale {
  return v === "vi" || v === "en"
}

/** Ngôn ngữ mặc định của bản cài (máy chủ). Sai/thiếu → vi. */
export function defaultLocale(): Locale {
  const v = (process.env.DEFAULT_LOCALE ?? "").trim().toLowerCase()
  return isLocale(v) ? v : "vi"
}

/** Mã định dạng số/ngày/tiền theo ngôn ngữ. */
export const INTL_LOCALE: Record<Locale, string> = { vi: "vi-VN", en: "en-US" }
