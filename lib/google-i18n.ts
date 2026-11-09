// Trợ giúp song ngữ cho các thư viện Google sinh văn bản (GĐ3-G1). Mặc định tiếng Việt — cron/báo cáo không truyền t.
import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

export const viT: TFunction = makeT("vi")
/** Mã định dạng số theo ngôn ngữ của t (vi-VN | en-US) — cũng dùng làm hậu tố khoá bộ nhớ đệm. */
export const nfOf = (t: TFunction): string => t("libgoogle.numfmt")
export const vndT = (t: TFunction, n: number): string => `₫${Math.round(n).toLocaleString(nfOf(t))}`
export const numT = (t: TFunction, n: number): string => n.toLocaleString(nfOf(t))
/** Khoá động (nhãn theo mã) — ép kiểu một chỗ. */
export const tk = (t: TFunction, key: string, vars?: Record<string, string | number>): string => t(key as MessageKey, vars)
