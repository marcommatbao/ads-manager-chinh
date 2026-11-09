import { makeT, type TFunction } from "@/lib/i18n/translate"
// Ngày theo giờ Việt Nam cho GAQL. Các route cũ tính bằng toISOString() (UTC)
// nên từ 0h–7h sáng giờ VN "hôm nay" bị lùi một ngày — phần này không lặp lại.

const VN = "Asia/Ho_Chi_Minh"

/** "YYYY-MM-DD" theo giờ VN. */
export function vnDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** Cộng/trừ ngày trên chuỗi "YYYY-MM-DD" (không dính múi giờ). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** `days` ngày gần nhất tính cả hôm nay, theo giờ VN. */
export function lastDays(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = vnDate(now)
  return { from: addDays(to, -(days - 1)), to }
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

/**
 * Khoảng [hôm nay − daysBack, hôm nay] theo giờ VN — cùng nghĩa với các hàm
 * gaqlDates cũ trong route (from lùi daysBack ngày), chỉ khác mốc "hôm nay".
 */
export function daysBackVN(daysBack: number, now: Date = new Date()): { from: string; to: string } {
  const to = vnDate(now)
  return { from: addDays(to, -daysBack), to }
}

// ── Khoảng ngày người dùng chọn (user chốt 28/09) ──
/** Mở trang: 30 ngày gần nhất. Tối đa 90 ngày một lần xem (Meta bậc phát triển ~60 lượt gọi/giờ). */
export const DEFAULT_VIEW_DAYS = 30
export const MAX_RANGE_DAYS = 90
/** Mở phiên xử lý: khoảng lưu làm mốc "trước" so với đo lại 7/14 ngày — ngắn quá thì phép so nhiễu. */
export const MIN_CASE_DAYS = 7

export const rangeDays = (r: { from: string; to: string }) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1

/** Đọc from/to từ query/body. Không truyền cả hai → mặc định `defaultDays` ngày gần nhất. */
export function parseRange(from: unknown, to: unknown, opts: { defaultDays: number; maxDays?: number; minDays?: number; now?: Date }, t: TFunction = makeT("vi")):
  { ok: true; range: { from: string; to: string } } | { ok: false; error: string } {
  if ((from === null || from === undefined || from === "") && (to === null || to === undefined || to === "")) return { ok: true, range: lastDays(opts.defaultDays, opts.now) }
  if (!isYmd(from) || !isYmd(to)) return { ok: false, error: t("libcase.c.dates.invalid") }
  const today = vnDate(opts.now)
  if (from > to) return { ok: false, error: t("libcase.c.dates.order") }
  if (to > today) return { ok: false, error: t("libcase.c.dates.future") }
  const n = rangeDays({ from, to })
  const max = opts.maxDays ?? MAX_RANGE_DAYS
  if (n > max) return { ok: false, error: t("libcase.c.dates.max", { max, n }) }
  if (opts.minDays && n < opts.minDays) return { ok: false, error: t("libcase.c.dates.min", { min: opts.minDays, n }) }
  return { ok: true, range: { from, to } }
}
