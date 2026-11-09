// ============================================================
// Connector Health + Secret Safety — shared types
// ============================================================

export type ConnectorId =
  | "meta"
  | "google_ads"
  | "ga4"
  | "gemini"
  | "telegram"
  | "odoo"
  | "slack"
  | "resend"
  | "apify"
  | "serpapi"
  | "similarweb";

export type ConnectorStatus =
  | "healthy"        // last check passed
  | "warning"        // partial config or degraded
  | "missing_config" // required env vars absent
  | "auth_error"     // credentials invalid / token expired
  | "service_error"  // external service returned an error
  | "disabled";      // explicitly disabled via CONNECTOR_<ID>_DISABLED=1

export type FailureCategory =
  | "auth"           // 401 / 403 / token expired
  | "rate_limit"     // 429
  | "network"        // timeout / DNS / connection refused
  | "invalid_config" // missing or malformed env
  | "server_error"   // 5xx from the remote
  | "unknown";

export interface ConnectorHealthRecord {
  id: ConnectorId;
  /** Resolved/live status — never "unknown", always one of ConnectorStatus */
  status: ConnectorStatus;
  /** All required env vars present */
  configComplete: boolean;
  /** Some (not all) required env vars present */
  partialConfig: boolean;
  /** ISO timestamp of last check attempt (live or stored) */
  lastChecked: string | null;
  /** ISO timestamp of last successful live check */
  lastSuccess: string | null;
  /** ISO timestamp of last failed live check */
  lastFailure: string | null;
  /** Human-readable reason — MUST NOT include raw secret values */
  failureReason: string | null;
  failureCategory: FailureCategory | null;
  /** Masked credential snippets shown in UI — e.g. { accessToken: "ABCD****WXYZ" } */
  maskedConfig: Record<string, string>;
  /** Heuristic: token may need rotation */
  needsRefresh?: boolean;
  note?: string;
}

export interface ConnectorHealthFile {
  updatedAt: string;
  records: Partial<Record<ConnectorId, ConnectorHealthRecord>>;
}

export interface CheckResult {
  ok: boolean;
  status: ConnectorStatus;
  failureCategory?: FailureCategory;
  failureReason?: string;
  note?: string;
}

// ── Static connector descriptor ───────────────────────────

export interface ConnectorDescriptor {
  id: ConnectorId;
  displayName: string;
  /** Required env var names — all must be present for configComplete */
  requiredEnv: string[];
  /** Optional env var names — nice-to-have */
  optionalEnv?: string[];
  /** Which env vars contain secret values that should be masked */
  secretEnv?: string[];
  /** Whether this connector supports a live test (vs env-check-only) */
  supportsLiveTest: boolean;
  /** Company scope — undefined means all companies */
  company?: string /* mã công ty hoặc "ALL" */;
  /** Can be disabled via env CONNECTOR_<ID>_DISABLED=1 */
  disableKey?: string;
  color: string;
  icon: string;
}
