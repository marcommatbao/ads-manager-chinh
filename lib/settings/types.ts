// ============================================================
// Settings Governance — shared types
// ============================================================

import type { Role } from "@/lib/permissions";

// ── Domain classification ──────────────────────────────────

export type SettingsDomain =
  | "budget"
  | "credentials_meta"
  | "credentials_google"
  | "credentials_gemini"
  | "credentials_telegram"
  | "credentials_ga4"
  | "credentials_teams_webhooks"
  | "credentials_service_keys"
  | "credentials_gtm"
  | "credentials_meta_pages"
  | "revenue"
  | "cpl_thresholds"
  | "users"
  | "team"
  | "notifications"
  | "tracking"
  | "kpi"
  | "companies"; // Đợt 21 A6: trình thiết lập (công ty / hoàn tất)

export type ConfigClass = "SECRET" | "OPERATIONAL" | "TARGET" | "PREFERENCE";

export const DOMAIN_CLASS: Record<SettingsDomain, ConfigClass> = {
  budget:               "OPERATIONAL",
  credentials_meta:     "SECRET",
  credentials_google:   "SECRET",
  credentials_gemini:   "SECRET",
  credentials_telegram: "SECRET",
  credentials_ga4:      "SECRET",
  credentials_teams_webhooks: "SECRET",
  credentials_service_keys: "SECRET",
  credentials_gtm:      "SECRET",
  credentials_meta_pages: "SECRET",
  revenue:              "TARGET",
  cpl_thresholds:       "OPERATIONAL",
  users:                "OPERATIONAL",
  team:                 "OPERATIONAL",
  notifications:        "PREFERENCE",
  tracking:             "OPERATIONAL",
  kpi:                  "TARGET",
  companies:            "OPERATIONAL",
};

/** Whether this domain supports snapshot rollback. */
export const ROLLBACK_ELIGIBLE_DOMAINS: SettingsDomain[] = [
  "budget",
  "cpl_thresholds",
  "revenue",
  "kpi",
];

// ── Diff ──────────────────────────────────────────────────

/** One field-level change inside a config update. */
export interface DiffRecord {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// ── Audit ─────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_role: Role;
  domain: SettingsDomain;
  company: string /* mã công ty hoặc "ALL" */;
  action: "create" | "update" | "delete";

  /** Top-level field name or comma-separated list for multi-field changes. */
  field: string;

  /** null for SECRET class — never log credential values. */
  old_value: unknown;
  new_value: unknown;

  /** Structured field-by-field diff (non-SECRET domains only). */
  diff?: DiffRecord[];

  /** True when a rollback snapshot was captured before this change. */
  rollbackEligible: boolean;

  /** Snapshot id that can be used to undo this change (if rollbackEligible). */
  rollbackReference?: string;

  /** Optional reason/comment provided by the actor. */
  note?: string;
}

export interface AuditSnapshot {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  domain: SettingsDomain;
  data: unknown;
}

export interface AuditFile {
  entries: AuditEntry[];
  snapshots: AuditSnapshot[];
}

// ── Write options ──────────────────────────────────────────

export interface AuditWriteOpts {
  /** Human-readable reason for the change. */
  note?: string;
  /** Override rollbackEligible (default: derived from ROLLBACK_ELIGIBLE_DOMAINS). */
  rollbackEligible?: boolean;
  /** Snapshot id captured just before this change. */
  rollbackReference?: string;
  /** Structured diff (if caller already computed it). */
  diff?: DiffRecord[];
}
