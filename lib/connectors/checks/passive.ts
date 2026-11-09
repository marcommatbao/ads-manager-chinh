// Passive env-check connectors — no live API call, just config inspection.
// Used for: slack, resend, apify, serpapi, similarweb. (GA4 has a real
// check below — env presence was never evidence that GA4 works.)
import type { CheckResult } from "../types";
import type { ConnectorId } from "../types";
import { getDescriptor } from "../registry";
import { readGA4OAuth } from "@/lib/ga4-oauth";
import { readGA4Connections } from "@/lib/ga4-connections";

/**
 * Returns a CheckResult based purely on env var presence (no network call).
 */
export function passiveEnvCheck(id: ConnectorId): CheckResult {
  const desc = getDescriptor(id);

  // SimilarWeb has no required env — always available
  if (desc.requiredEnv.length === 0) {
    return { ok: true, status: "healthy", note: "No auth required" };
  }

  const present  = desc.requiredEnv.filter(k => !!process.env[k]);
  const missing  = desc.requiredEnv.filter(k => !process.env[k]);
  const optional = (desc.optionalEnv ?? []).filter(k => !!process.env[k]);

  if (missing.length === desc.requiredEnv.length) {
    return {
      ok: false, status: "missing_config", failureCategory: "invalid_config",
      failureReason: `Required env vars not set: ${missing.join(", ")}`,
    };
  }
  if (missing.length > 0) {
    return {
      ok: false, status: "warning", failureCategory: "invalid_config",
      failureReason: `Partially configured — missing: ${missing.join(", ")}`,
      note: `Present: ${present.join(", ")}${optional.length ? `, optional: ${optional.join(", ")}` : ""}`,
    };
  }

  return {
    ok: true, status: "healthy",
    note: `${present.length} required env${optional.length ? ` + ${optional.length} optional` : ""} present`,
  };
}

/**
 * GA4 is NOT a passive env check.
 *
 * It used to be, and it reported "Healthy" whenever GOOGLE_ADS_CLIENT_ID and
 * GOOGLE_ADS_REFRESH_TOKEN were set — those are Google *Ads* credentials and
 * say nothing about Analytics. The dashboard therefore showed GA4 as healthy
 * on an install where GA4 had never been connected and, until the OAuth flow
 * was added, could not be connected at all.
 *
 * Real state: a GA4 OAuth grant must exist AND at least one property must be
 * mapped, otherwise nothing can be fetched.
 */
export function checkGA4(): CheckResult {
  const oauth = readGA4OAuth();
  if (!oauth) {
    return {
      ok: false, status: "missing_config", failureCategory: "invalid_config",
      failureReason: "Chưa cấp quyền Google Analytics — vào Cài đặt → GA4 để kết nối",
    };
  }

  const properties = readGA4Connections();
  if (properties.length === 0) {
    return {
      ok: false, status: "warning", failureCategory: "invalid_config",
      failureReason: "Đã cấp quyền nhưng chưa chọn property GA4 nào",
    };
  }

  return {
    ok: true, status: "healthy",
    note: `${properties.length} property đang kết nối`,
  };
}

export const checkSlack     = (): CheckResult => passiveEnvCheck("slack");
export const checkResend    = (): CheckResult => passiveEnvCheck("resend");
export const checkApify     = (): CheckResult => passiveEnvCheck("apify");
export const checkSerpApi   = (): CheckResult => passiveEnvCheck("serpapi");
export const checkSimilarWeb = (): CheckResult => passiveEnvCheck("similarweb");
