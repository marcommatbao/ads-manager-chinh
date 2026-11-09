// ============================================================
// Tenant Registry
//
// Single source of truth for all tenants.  Reads from
// data/tenants.json.  If the file is missing, auto-bootstraps
// from COMPANY_CONFIG so existing deployments are not broken.
//
// In-process cache invalidated on writes (next request reads fresh).
// Thread safety: writes go through withFileLock() (same as all
// other data/ writes in this codebase).
// ============================================================

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { COMPANY_CONFIG } from "@/lib/company-config";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomic, writeFileAtomicSync } from "@/lib/fs-atomic";
import type { Tenant, TenantId } from "./types";

const DATA_PATH = join(process.cwd(), "data", "tenants.json");

// ── In-process cache ──────────────────────────────────────

let _cache: Tenant[] | null = null;

function invalidate() { _cache = null; }

// ── Bootstrap from COMPANY_CONFIG ────────────────────────

function bootstrapFromConfig(): Tenant[] {
  return Object.entries(COMPANY_CONFIG).map(([key, cfg]) => ({
    id:              key.toLowerCase() as TenantId,
    name:            cfg.label ?? key,
    shortLabel:      key,
    domain:          cfg.domain,
    color:           cfg.color,
    status:          "active" as const,
    plan:            "internal" as const,
    createdAt:       new Date().toISOString(),
    legacyCompanyKey: key,
    metadata: {
      country:  "VN",
      timezone: "Asia/Ho_Chi_Minh",
      currency: "VND",
      language: "vi",
    },
    integrations: {
      ga4:      cfg.ga4 ? {
        propertyId:    cfg.ga4.propertyId,
        streamId:      cfg.ga4.streamId,
        measurementId: cfg.ga4.measurementId,
      } : undefined,
      facebook: cfg.facebook?.pixelId ? { pixelId: cfg.facebook.pixelId } : undefined,
    },
    settings: {},
  }));
}

// ── Read ──────────────────────────────────────────────────

export function readTenants(): Tenant[] {
  if (_cache) return _cache;

  if (!existsSync(DATA_PATH)) {
    const bootstrapped = bootstrapFromConfig();
    // Persist so future reads don't need to bootstrap
    try {
      writeFileAtomicSync(DATA_PATH, JSON.stringify(bootstrapped, null, 2));
    } catch { /* non-fatal — runtime may be read-only */ }
    _cache = bootstrapped;
    return bootstrapped;
  }

  try {
    const raw = readFileSync(DATA_PATH, "utf-8");
    _cache = JSON.parse(raw) as Tenant[];
    return _cache;
  } catch {
    // Corrupt file — fall back to bootstrap, do not overwrite
    const bootstrapped = bootstrapFromConfig();
    _cache = bootstrapped;
    return bootstrapped;
  }
}

// ── Lookup helpers ────────────────────────────────────────

export function getTenant(id: TenantId): Tenant | undefined {
  return readTenants().find(t => t.id === id);
}

export function getActiveTenants(): Tenant[] {
  return readTenants().filter(t => t.status === "active");
}

/** Find by legacy company key ("MBC" → tenant with legacyCompanyKey="MBC") */
export function getTenantByCompanyKey(companyKey: string): Tenant | undefined {
  return readTenants().find(t => t.legacyCompanyKey === companyKey);
}

// ── Write ─────────────────────────────────────────────────

export async function upsertTenant(tenant: Tenant): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const all = readTenants();
    const idx = all.findIndex(t => t.id === tenant.id);
    if (idx >= 0) {
      all[idx] = tenant;
    } else {
      all.push(tenant);
    }
    await writeFileAtomic(DATA_PATH, JSON.stringify(all, null, 2));
    invalidate();
  });
}

export async function updateTenantSettings(
  id: TenantId,
  patch: Partial<Tenant["settings"]>,
): Promise<Tenant | null> {
  let updated: Tenant | null = null;
  await withFileLock(DATA_PATH, async () => {
    const all = readTenants();
    const idx = all.findIndex(t => t.id === id);
    if (idx < 0) return;
    all[idx] = {
      ...all[idx],
      settings: { ...all[idx].settings, ...patch },
    };
    updated = all[idx];
    await writeFileAtomic(DATA_PATH, JSON.stringify(all, null, 2));
    invalidate();
  });
  return updated;
}
