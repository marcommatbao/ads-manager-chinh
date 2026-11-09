// ============================================================
// Tenant Resolver — company ↔ tenantId bridge
//
// All existing code uses string as company
// string literals.  This module provides two-way conversion
// so new code can work with TenantId slugs while remaining
// fully compatible with the legacy silo keys.
//
// Zero side effects — pure lookup functions.
// ============================================================

import { readTenants, getTenantByCompanyKey } from "./registry";
import type { TenantId, Tenant } from "./types";

// ── Legacy key → TenantId ─────────────────────────────────

/**
 * Convert a legacy company key ("MBC") to a TenantId slug ("mbc").
 * Returns `null` if the key is not registered.
 */
export function companyToTenantId(companyKey: string): TenantId | null {
  const tenant = getTenantByCompanyKey(companyKey);
  return tenant?.id ?? null;
}

/**
 * TenantId slug → legacy company key.
 * e.g. "mbc" → "MBC"
 */
export function tenantIdToCompany(tenantId: TenantId): string | null {
  const tenants = readTenants();
  const tenant  = tenants.find(t => t.id === tenantId);
  return tenant?.legacyCompanyKey ?? null;
}

// ── Normalise any company/tenant identifier ───────────────

/**
 * Accept either a TenantId slug or a legacy company key and
 * return the canonical Tenant object.
 *
 * Handles: "mbc", "MBC", "mbi", "MBI", "sale_ai", "SALE_AI"
 */
export function resolveTenant(input: string): Tenant | null {
  const tenants = readTenants();
  // Try TenantId first (lowercase slug)
  const byId = tenants.find(t => t.id === input.toLowerCase());
  if (byId) return byId;
  // Fall back to legacy key (uppercase)
  return tenants.find(t => t.legacyCompanyKey === input.toUpperCase()) ?? null;
}

// ── Batch helpers ─────────────────────────────────────────

/**
 * Convert an array of legacy company keys to TenantId slugs,
 * silently dropping any unknown keys.
 */
export function companiesToTenantIds(companies: string[]): TenantId[] {
  return companies
    .map(c => companyToTenantId(c))
    .filter((id): id is TenantId => id !== null);
}

/**
 * Convert an array of TenantId slugs to legacy company keys,
 * silently dropping any unregistered tenants.
 */
export function tenantIdsToCompanies(tenantIds: TenantId[]): string[] {
  return tenantIds
    .map(id => tenantIdToCompany(id))
    .filter((c): c is string => c !== null);
}

// ── Type guard ────────────────────────────────────────────

/** Returns true if the input matches any registered TenantId */
export function isValidTenantId(input: string): boolean {
  const tenants = readTenants();
  return tenants.some(t => t.id === input);
}

/** Returns true if the input matches any registered legacy company key */
export function isValidCompanyKey(input: string): boolean {
  const tenants = readTenants();
  return tenants.some(t => t.legacyCompanyKey === input);
}
