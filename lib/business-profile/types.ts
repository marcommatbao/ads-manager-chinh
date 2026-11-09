// ============================================================
// Business Profile — Types
//
// A structured profile for each company (tenant), extracting
// data currently hardcoded across company-config.ts,
// cpl-calculator.ts, and product-parser.ts.
//
// This is a read layer — it does NOT replace those files.
// Existing call sites continue to work unchanged.
// ============================================================

import type { TenantId } from "@/lib/tenants/types";

// ── Product definition ────────────────────────────────────

export interface ProductProfile {
  name:                string;
  color:               string;
  /** Keywords to detect this product in campaign names (lowercase) */
  detectionKeywords:   string[];
  /** Approximate target CPL for this product (VND), if known */
  targetCpl?:          number;
}

// ── CPL threshold profile ─────────────────────────────────

export interface BusinessCplThresholds {
  good:     number;
  warning:  number;
  critical: number;
  labels: {
    good:     string;
    warning:  string;
    critical: string;
  };
}

// ── Channel mapping ───────────────────────────────────────

export type AdPlatform = "facebook" | "google_ads" | "tiktok";

export interface ChannelProfile {
  platform:    AdPlatform;
  isPrimary:   boolean;
  pixelId?:    string;
  accountId?:  string;
}

// ── Analytics / tracking ──────────────────────────────────

export interface AnalyticsProfile {
  ga4PropertyId:   string;
  ga4StreamId:     string;
  ga4MeasurementId:string;
}

// ── Reporting defaults ────────────────────────────────────

export interface ReportingProfile {
  currency:    string;     // "VND"
  timezone:    string;     // "Asia/Ho_Chi_Minh"
  /** Default lookback window for reports (days) */
  lookbackDays: number;
  /** Company-level monthly ad budget cap (VND) — soft limit for safety gate */
  monthlyBudgetCap?: number;
}

// ── Main profile ──────────────────────────────────────────

export interface BusinessProfile {
  /** Matches TenantId (slug) */
  tenantId:     TenantId;
  /** Display name */
  name:         string;
  shortLabel:   string;
  domain:       string;
  /** Tailwind color class used throughout the UI */
  colorClass:   string;

  products:     ProductProfile[];
  cplThresholds: BusinessCplThresholds | null;

  channels:     ChannelProfile[];
  analytics:    AnalyticsProfile;
  reporting:    ReportingProfile;

  /** Any notes / context for AI reasoning layers */
  notes?:       string;
}
