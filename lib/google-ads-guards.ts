// ============================================================
// Input guards for GAQL query construction.
//
// Several toolkit routes interpolated query-string values straight into
// GAQL — `segments.date DURING ${range}`, `AND campaign.id = ${campaignId}`,
// and `WHERE campaign.resource_name = '${campaignResourceName}'`. GAQL has
// no stacked statements or subqueries, so this is not SQL-injection-grade,
// but an authenticated caller could still append arbitrary predicates to
// the WHERE clause (changing which rows come back) or break out of the
// quoted string in the resource_name case. Everything user-supplied that
// reaches a query string now goes through here first.
//
// These are validators, not escapers: anything not recognised is rejected
// outright rather than "cleaned up" into something that still runs.
// ============================================================

/** GAQL date-range literals accepted by `segments.date DURING`.
 *
 *  ĐÃ BỎ LAST_60_DAYS và LAST_90_DAYS ngày 16/09/2026: Google KHÔNG có hai mốc
 *  này (type `DateConstant` của SDK chỉ có 12 giá trị), nên mọi truy vấn đi qua
 *  đây với chúng đều hỏng 100% — mà giao diện Manual Bid và Attribution lại có
 *  nút bấm thật cho "60 ngày"/"90 ngày". Hai lựa chọn đó nay đi qua
 *  lib/google-date-range.ts và được dựng thành BETWEEN với ngày tường minh. */
const DATE_RANGES = new Set([
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
  "LAST_BUSINESS_WEEK",
  "THIS_WEEK_SUN_TODAY",
  "THIS_WEEK_MON_TODAY",
  "LAST_WEEK_SUN_SAT",
  "LAST_WEEK_MON_SUN",
  "THIS_MONTH",
  "LAST_MONTH",
]);

export class InvalidGaqlInput extends Error {}

/**
 * Validate a `DURING` literal. Returns the value unchanged when known,
 * throws InvalidGaqlInput otherwise.
 */
export function safeDateRange(value: string | null | undefined, fallback = "LAST_30_DAYS"): string {
  const v = (value ?? fallback).toUpperCase().trim();
  if (!DATE_RANGES.has(v)) {
    throw new InvalidGaqlInput(`Khoảng thời gian không hợp lệ: ${value}`);
  }
  return v;
}

/**
 * Validate a Google Ads numeric id (campaign / ad group / ad).
 * Returns null for the "no filter" sentinel so callers can omit the clause.
 */
export function safeNumericId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (v === "" || v.toUpperCase() === "ALL") return null;
  if (!/^\d{1,20}$/.test(v)) {
    throw new InvalidGaqlInput(`ID không hợp lệ: ${value}`);
  }
  return v;
}

/**
 * Validate a Google Ads resource name, e.g. "customers/123/campaigns/456".
 * Only digits, slashes and a conservative identifier charset — notably no
 * quote characters, which is what makes interpolating it into a quoted
 * GAQL literal safe.
 */
export function safeResourceName(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_/~-]{1,200}$/.test(v)) {
    throw new InvalidGaqlInput(`Resource name không hợp lệ: ${String(value)}`);
  }
  return v;
}

/**
 * Validate a `YYYY-MM-DD` literal for `segments.date BETWEEN '...' AND '...'`.
 * The quoted form is the dangerous one — a value containing a quote breaks
 * out of the literal and appends its own predicates — so the charset here is
 * digits and dashes only, and the date must be a real calendar date
 * (2026-02-31 is rejected, not silently rolled over by the Date parser).
 */
export function safeDate(value: string | null | undefined, fallback: string): string {
  const v = (value ?? fallback).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new InvalidGaqlInput(`Ngày không hợp lệ: ${value}`);
  }
  const [y, m, d] = v.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (
    asDate.getUTCFullYear() !== y ||
    asDate.getUTCMonth() !== m - 1 ||
    asDate.getUTCDate() !== d
  ) {
    throw new InvalidGaqlInput(`Ngày không hợp lệ: ${value}`);
  }
  return v;
}
