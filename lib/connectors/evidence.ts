import type { ConnectorHealthRecord } from "./types";

// Client-safe allowlist projection of the PUBLIC record. No config values,
// provider messages, URLs or disk-only identity metadata cross this boundary.
export function projectConnectorEvidence(record: ConnectorHealthRecord | null | undefined, now = Date.now()) {
  const configuration = !record ? "unknown" : record.configComplete ? "present" : record.partialConfig ? "partial" : "missing";
  const timestamp = (value: string | null | undefined) => {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
  };
  const checked = timestamp(record?.lastChecked);
  const success = timestamp(record?.lastSuccess);
  const freshness = checked === null ? "never" : !Number.isFinite(checked) ? "invalid" : checked > now ? "future" : now - checked >= 3_600_000 ? "stale" : "recent";
  let outcome: "unavailable" | "disabled" | "failed" | "recheck" | "listing" | "recorded" = "unavailable";
  if (record?.status === "disabled") outcome = "disabled";
  else if (record?.status === "auth_error" || record?.status === "service_error") outcome = "failed";
  else if (record && checked !== null) {
    outcome = "recheck";
    if (configuration === "present" && freshness === "recent" && record.status === "healthy"
      && success !== null && Number.isFinite(success) && success <= now && now - success < 3_600_000
      && success === checked) outcome = record.id === "google_ads" ? "listing" : "recorded";
  }
  return {
    configuration, freshness, outcome,
    checkedAt: checked !== null && Number.isFinite(checked) && checked <= now ? new Date(checked).toISOString() : null,
    scope: record?.id === "google_ads" ? "google" : "other",
  } as const;
}
