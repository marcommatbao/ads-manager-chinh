// ============================================================
// Format helper riêng cho /settings/health — mirror phong cách relTime/absTime
// của app/(dashboard)/settings/jobs/page.tsx (không export ở đó nên lặp lại
// một bản nhỏ ở đây thay vì import chéo từ một trang khác).
// ============================================================

import type { TFunction } from "@/lib/i18n/translate";

/** `t` (tuỳ chọn, useT()) → chữ theo ngôn ngữ; không truyền → tiếng Việt như cũ. */
export function relTime(iso: string | null, t?: TFunction): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(d)) return "—";
  if (d < 60) return t ? t("common.time.secAgo", { n: Math.max(d, 0) }) : `${Math.max(d, 0)}s trước`;
  if (d < 3600) return t ? t("common.time.minAgo", { n: Math.floor(d / 60) }) : `${Math.floor(d / 60)}p trước`;
  if (d < 86400) return t ? t("common.time.hourAgo", { n: Math.floor(d / 3600) }) : `${Math.floor(d / 3600)}h trước`;
  return t ? t("common.time.dayAgo", { n: Math.floor(d / 86400) }) : `${Math.floor(d / 86400)}ngày trước`;
}

export function absTime(iso: string | null, intlLocale = "vi-VN"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(intlLocale, {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Rút gọn một chuỗi dài (lastSummary/lastError) — bấm để xem đủ ở nơi gọi. */
export function truncate(text: string | null, max = 60): { short: string; isLong: boolean } {
  if (!text) return { short: "—", isLong: false };
  if (text.length <= max) return { short: text, isLong: false };
  return { short: `${text.slice(0, max)}…`, isLong: true };
}
