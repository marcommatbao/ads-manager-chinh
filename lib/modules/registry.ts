// ============================================================
// Module Registry — Source of Truth
//
// Merges DEFAULT_MODULES (code defaults) with per-module/tenant
// overrides stored in data/modules.json.
//
// Override schema in modules.json:
//   [
//     { "moduleId": "competitors", "tenantId": "mbc", "enabled": true },
//     { "moduleId": "automation",  "tenantId": "mbi", "enabled": false },
//     { "moduleId": "ai-ad-copy",  "tenantId": "*",   "navVisible": true, "enabled": true }
//   ]
//
// tenantId "*" applies to all tenants.
//
// In-process cache invalidated on write.
// ============================================================

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { DEFAULT_MODULES } from "./defaults";
import type { ModuleDefinition, ModuleId } from "./types";

const DATA_PATH = join(process.cwd(), "data", "modules.json");

// ── Override record ───────────────────────────────────────

export interface ModuleOverride {
  moduleId:   ModuleId;
  /** TenantId slug or "*" for all tenants */
  tenantId:   string;
  enabled?:   boolean;
  navVisible?: boolean;
  requiredRoles?: string[];
  label?:     string;
}

// ── Cache ─────────────────────────────────────────────────

let _cache: ModuleOverride[] | null = null;

function invalidate() { _cache = null; }

// ── Read overrides ────────────────────────────────────────

function readOverrides(): ModuleOverride[] {
  if (_cache !== null) return _cache;
  if (!existsSync(DATA_PATH)) { _cache = []; return []; }
  try {
    _cache = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as ModuleOverride[];
    return _cache;
  } catch {
    _cache = [];
    return [];
  }
}

// ── Apply overrides ───────────────────────────────────────

/**
 * Return a ModuleDefinition with tenant-specific overrides applied.
 * Priority: tenant-specific override > wildcard "*" override > default.
 */
function applyOverrides(def: ModuleDefinition, tenantId?: string): ModuleDefinition {
  const overrides = readOverrides();

  // Find most-specific match: exact tenantId first, then "*"
  const tenantMatch  = tenantId ? overrides.find(o => o.moduleId === def.id && o.tenantId === tenantId) : undefined;
  const wildcardMatch = overrides.find(o => o.moduleId === def.id && o.tenantId === "*");
  const best = tenantMatch ?? wildcardMatch;

  if (!best) return def;

  return {
    ...def,
    ...(best.enabled    !== undefined ? { enabled:    best.enabled }    : {}),
    ...(best.navVisible !== undefined ? { navVisible: best.navVisible } : {}),
    ...(best.label      !== undefined ? { label:      best.label }      : {}),
  };
}

// ── Public API ────────────────────────────────────────────

/** Return all modules with tenant overrides applied */
export function getModules(tenantId?: string): ModuleDefinition[] {
  return DEFAULT_MODULES.map(m => applyOverrides(m, tenantId));
}

/** Return a single module by id with overrides applied */
export function getModule(id: ModuleId, tenantId?: string): ModuleDefinition | undefined {
  const def = DEFAULT_MODULES.find(m => m.id === id);
  if (!def) return undefined;
  return applyOverrides(def, tenantId);
}

/** Check if a module is enabled for a given tenant */
export function isModuleEnabled(id: ModuleId, tenantId?: string): boolean {
  const m = getModule(id, tenantId);
  if (!m) return false;
  // Also check tenantOverrides on the definition itself
  if (tenantId && m.tenantOverrides?.[tenantId] !== undefined) {
    return m.tenantOverrides[tenantId];
  }
  return m.enabled;
}

/** Check if a module is nav-visible for a given tenant */
export function isModuleNavVisible(id: ModuleId, tenantId?: string): boolean {
  const m = getModule(id, tenantId);
  return m?.navVisible ?? false;
}

/** All enabled module IDs for a tenant */
export function enabledModuleIds(tenantId?: string): ModuleId[] {
  return getModules(tenantId)
    .filter(m => isModuleEnabled(m.id, tenantId))
    .map(m => m.id);
}

// ── Write override ────────────────────────────────────────

export async function setModuleOverride(override: ModuleOverride): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const all = readOverrides();
    const idx = all.findIndex(o => o.moduleId === override.moduleId && o.tenantId === override.tenantId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...override };
    } else {
      all.push(override);
    }
    writeFileAtomicSync(DATA_PATH, JSON.stringify(all, null, 2));
    invalidate();
  });
}

export async function deleteModuleOverride(moduleId: ModuleId, tenantId: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const all = readOverrides().filter(o => !(o.moduleId === moduleId && o.tenantId === tenantId));
    writeFileAtomicSync(DATA_PATH, JSON.stringify(all, null, 2));
    invalidate();
  });
}
