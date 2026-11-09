// ============================================================
// Ads Content — Month → Date Range Helper
// ============================================================

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current month in YYYY-MM, e.g. "2026-07". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Validate a "YYYY-MM" string, falling back to the current month if invalid/missing. */
export function normalizeMonth(month: string | null | undefined): string {
  if (month && MONTH_RE.test(month)) return month;
  return currentMonth();
}

/**
 * Convert "YYYY-MM" into an inclusive [from, to] date range (YYYY-MM-DD),
 * clamped so `to` never goes past today (avoids requesting future dates
 * from Meta/Google Ads for the current in-progress month).
 */
export function monthToRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = normalizeMonth(month).split("-");
  const year = Number(yearStr);
  const monthIdx = Number(monthStr) - 1; // 0-based

  const from = new Date(Date.UTC(year, monthIdx, 1));
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0));
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const to = lastDay > todayUTC ? todayUTC : lastDay;

  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

/** Last N months (including current) as "YYYY-MM", newest first — for the month picker. */
export function recentMonths(count = 12): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
