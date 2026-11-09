// ============================================================
// Connector Tenant Config
//
// Per-tenant connector availability and override logic.
//
// The existing ConnectorDescriptor.company field handles the
// platform-level scoping (which company a connector belongs to).
// This module adds a JSON-file based override layer on top so
// operators can enable/disable connectors per-tenant without
// changing env vars.
//
// data/connector-tenant-config.json (optional, not gitignored):
// [
//   { "connectorId": "apify", "tenantId": "mbc", "enabled": false },
//   { "connectorId": "apify", "tenantId": "*",   "enabled": true }
// ]
// ============================================================

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { ConnectorId } from "./types";
import type { TenantId } from "@/lib/tenants/types";
import { CONNECTOR_REGISTRY } from "./registry";

// ── Override record shape ─────────────────────────────────

export interface ConnectorTenantOverride {
  connectorId: ConnectorId;
  /** tenantId or "*" for all tenants */
  tenantId:    TenantId | "*";
  enabled:     boolean;
  /** Optional reason / note (not shown in API responses) */
  note?:       string;
}

// ── File path ─────────────────────────────────────────────

const OVERRIDE_FILE = path.join(process.cwd(), "data", "connector-tenant-config.json");

function readOverrides(): ConnectorTenantOverride[] {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) return [];
    const raw = fs.readFileSync(OVERRIDE_FILE, "utf-8");
    return JSON.parse(raw) as ConnectorTenantOverride[];
  } catch {
    return [];
  }
}

// ── Company → tenantId bridge ─────────────────────────────

function companyToTenantId(company: string /* mã công ty hoặc "ALL" */ | undefined): TenantId | null {
  if (!company || company === "ALL") return null;
  return company.toLowerCase() as TenantId;
}

// ── Availability check ────────────────────────────────────

/**
 * Returns true if a connector is available (visible + usable) for a tenant.
 *
 * Resolution order:
 *  1. Explicit override for (connectorId, tenantId)
 *  2. Wildcard override for (connectorId, "*")
 *  3. ConnectorDescriptor.company field (existing platform scoping)
 *  4. Default: available
 */
export function isConnectorAvailableForTenant(
  connectorId: ConnectorId,
  tenantId:    TenantId,
): boolean {
  const overrides = readOverrides();

  // Check exact match first
  const exact = overrides.find(
    o => o.connectorId === connectorId && o.tenantId === tenantId
  );
  if (exact !== undefined) return exact.enabled;

  // Check wildcard
  const wildcard = overrides.find(
    o => o.connectorId === connectorId && o.tenantId === "*"
  );
  if (wildcard !== undefined) return wildcard.enabled;

  // Fall back to ConnectorDescriptor.company scoping
  const descriptor = CONNECTOR_REGISTRY.find(c => c.id === connectorId);
  if (!descriptor) return false;

  if (!descriptor.company || descriptor.company === "ALL") return true;

  const descriptorTenantId = companyToTenantId(descriptor.company);
  if (!descriptorTenantId) return true;
  return descriptorTenantId === tenantId;
}

/**
 * Returns all connector IDs available for a tenant.
 */
export function getAvailableConnectors(tenantId: TenantId): ConnectorId[] {
  return CONNECTOR_REGISTRY
    .filter(c => isConnectorAvailableForTenant(c.id, tenantId))
    .map(c => c.id);
}

/**
 * Returns all connector IDs available across ANY tenant (union set).
 * Used for platform-level health display (super_admin view).
 */
export function getAllConnectorIds(): ConnectorId[] {
  return CONNECTOR_REGISTRY.map(c => c.id);
}

// ── Override management ───────────────────────────────────

export function upsertConnectorOverride(override: ConnectorTenantOverride): void {
  const overrides = readOverrides();
  const idx = overrides.findIndex(
    o => o.connectorId === override.connectorId && o.tenantId === override.tenantId
  );
  if (idx >= 0) {
    overrides[idx] = override;
  } else {
    overrides.push(override);
  }
  const dir = path.dirname(OVERRIDE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2));
}

export function removeConnectorOverride(connectorId: ConnectorId, tenantId: TenantId | "*"): void {
  const overrides = readOverrides().filter(
    o => !(o.connectorId === connectorId && o.tenantId === tenantId)
  );
  writeFileAtomicSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2));
}

export function listConnectorOverrides(): ConnectorTenantOverride[] {
  return readOverrides();
}
