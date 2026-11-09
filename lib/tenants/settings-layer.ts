// ============================================================
// Tenant Settings — Layered Resolver
//
// Config layering (highest wins):
//   [1] Global platform defaults  (lib/tenants/global-defaults.ts)
//   [2] Tenant-level settings     (data/tenants.json → tenant.settings)
//   [3] Domain configs            (data/budget-configs.json, etc. — not this module)
//   [4] User preferences          (future)
//
// This module resolves layers 1 + 2.  Domain-specific settings
// (budget, CPL, credentials) are handled by their own libs.
// ============================================================

import { getTenant } from "./registry";
import { GLOBAL_DEFAULTS, PLATFORM_FLAGS } from "./global-defaults";
import type { TenantId, TenantSettings } from "./types";

// ── Feature flag resolution ───────────────────────────────

/**
 * Returns the effective boolean value of a feature flag for a tenant.
 * Tenant override wins; falls back to global default; returns false
 * if undefined at both levels.
 */
export function isTenantFeatureEnabled(tenantId: TenantId, flag: string): boolean {
  const tenant = getTenant(tenantId);
  const tenantOverride = tenant?.settings?.features?.[flag];
  if (tenantOverride !== undefined) return tenantOverride;
  return GLOBAL_DEFAULTS.features?.[flag] ?? false;
}

// ── Numeric limit resolution ──────────────────────────────

/**
 * Returns the effective numeric limit for a tenant.
 * e.g. resolveTenantLimit("mbc", "nba_auto_apply_max") → 3
 */
export function resolveTenantLimit(tenantId: TenantId, key: string): number | undefined {
  const tenant = getTenant(tenantId);
  const tenantOverride = tenant?.settings?.limits?.[key];
  if (tenantOverride !== undefined) return tenantOverride;
  return GLOBAL_DEFAULTS.limits?.[key];
}

// ── General setting lookup ────────────────────────────────

/**
 * Generic dot-path lookup across the merged settings object.
 * Layers: global defaults merged with tenant overrides (tenant wins).
 */
export function resolveTenantSetting(
  tenantId: TenantId,
  key: string,
): unknown {
  const tenant   = getTenant(tenantId);
  const merged   = mergeSettings(GLOBAL_DEFAULTS, tenant?.settings ?? {});

  const parts = key.split(".");
  let cursor: unknown = merged;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/** Merged effective settings object for a tenant */
export function getEffectiveSettings(tenantId: TenantId): TenantSettings {
  const tenant = getTenant(tenantId);
  return mergeSettings(GLOBAL_DEFAULTS, tenant?.settings ?? {});
}

function mergeSettings(base: TenantSettings, override: TenantSettings): TenantSettings {
  return {
    features:      { ...base.features,      ...override.features },
    limits:        { ...base.limits,        ...override.limits },
    notifications: { ...base.notifications, ...override.notifications },
    custom:        { ...base.custom,        ...override.custom },
  };
}

// ── Platform flag (not overridable by tenants) ────────────

export function getPlatformFlag(key: keyof typeof PLATFORM_FLAGS): boolean {
  return PLATFORM_FLAGS[key];
}

// ── Telegram chat ID helper ───────────────────────────────

/**
 * Returns the Telegram chat ID for a tenant.
 * Falls back to global TELEGRAM_CHAT_ID env if tenant has no override.
 */
export function getTelegramChatId(tenantId: TenantId): string | undefined {
  const tenant = getTenant(tenantId);
  return tenant?.settings?.notifications?.telegramChatId
    ?? process.env.TELEGRAM_CHAT_ID
    ?? undefined;
}
