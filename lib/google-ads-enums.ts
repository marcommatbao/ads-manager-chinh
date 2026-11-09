// ============================================================
// Google Ads Enum Decoding — shared helper
// ============================================================
// google-ads-api returns enum fields (segments.device, campaign.status,
// asset_group_asset.field_type, ad_group_ad.ad_strength, ...) as raw
// numbers, not the string names the rest of this codebase's
// status-mapping helpers expect (see lib/google-client.ts's own "API
// returns numbers not strings" comment/CAMPAIGN_STATUS_MAP). The
// library's `enums` export is a TS numeric enum compiled to JS, which
// doubles as a number->name reverse lookup at runtime — reuse that
// instead of hand-rolling maps per call site.

export function enumName<T extends Record<string | number, string | number>>(
  table: T,
  raw: unknown
): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return (table[raw] as string) ?? "UNKNOWN";
  return "UNKNOWN";
}
