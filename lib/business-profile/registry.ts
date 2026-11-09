// ============================================================
// Business Profile Registry
//
// Resolution order:
//   1. data/business-profiles.json  (runtime overrides, optional)
//   2. DEFAULT_PROFILES             (seed from existing hardcoded data)
//
// data/business-profiles.json format — partial override per tenant:
// [
//   {
//     "tenantId": "mbc",
//     "cplThresholds": { "good": 55000, "warning": 90000, "critical": 100000 },
//     "reporting": { "monthlyBudgetCap": 500000000 }
//   }
// ]
//
// Only the fields present in the override record are merged.
// Missing fields fall back to the default profile.
// ============================================================

import fs from "fs";
import path from "path";
import type { BusinessProfile } from "./types";
import type { TenantId } from "@/lib/tenants/types";
import { DEFAULT_PROFILES, DEFAULT_PROFILES_BY_ID } from "./defaults";

const OVERRIDE_FILE = path.join(process.cwd(), "data", "business-profiles.json");

type PartialProfile = Partial<Omit<BusinessProfile, "tenantId">> & { tenantId: TenantId };

function readOverrides(): PartialProfile[] {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) return [];
    return JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf-8")) as PartialProfile[];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * Get the business profile for a tenant.
 * Returns default if no override file exists or the tenant is unknown.
 */
export function getProfile(tenantId: TenantId): BusinessProfile | null {
  const base = DEFAULT_PROFILES_BY_ID[tenantId] ?? null;
  if (!base) return null;

  const overrides = readOverrides();
  const override = overrides.find(o => o.tenantId === tenantId);
  if (!override) return base;

  // Deep merge: only override defined top-level keys
  return {
    ...base,
    ...override,
    // Nested merge for objects that should be partially overridable
    cplThresholds: override.cplThresholds !== undefined
      ? (override.cplThresholds === null
          ? null
          : { ...base.cplThresholds, ...override.cplThresholds })
      : base.cplThresholds,
    analytics: override.analytics
      ? { ...base.analytics, ...override.analytics }
      : base.analytics,
    reporting: override.reporting
      ? { ...base.reporting, ...override.reporting }
      : base.reporting,
  };
}

/**
 * Get all known tenant profiles (defaults + merged overrides).
 */
export function getAllProfiles(): BusinessProfile[] {
  return DEFAULT_PROFILES.map(p => getProfile(p.tenantId) ?? p);
}

/**
 * Get the product list for a tenant.
 * Convenience wrapper — avoids importing the full profile.
 */
export function getProductsForTenant(tenantId: TenantId) {
  return getProfile(tenantId)?.products ?? [];
}

/**
 * Get CPL thresholds for a tenant.
 * Returns null if no thresholds defined (e.g. SALE_AI).
 */
export function getCplThresholdsForTenant(tenantId: TenantId) {
  return getProfile(tenantId)?.cplThresholds ?? null;
}

/**
 * Resolve the company key used by existing code (MBC, MBI, SALE_AI)
 * back to a tenant profile.
 */
export function getProfileByCompanyKey(companyKey: string): BusinessProfile | null {
  const normalized = companyKey.toUpperCase();
  // Bridge: SALE_AI legacy keys
  const map: Record<string, TenantId> = {
    MBC:     "mbc",
    MBI:     "mbi",
    SALE_AI: "sale_ai",
    "SALE.AI": "sale_ai",
  };
  const tenantId = map[normalized];
  if (!tenantId) return null;
  return getProfile(tenantId);
}
