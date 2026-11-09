// ============================================================
// Tenant — Global Platform Defaults
//
// These are platform-wide settings that apply to ALL tenants
// unless the tenant's own settings object overrides them.
// Layer 1 of the config layering model.
// ============================================================

import type { TenantSettings } from "./types";

export const GLOBAL_DEFAULTS: TenantSettings = {
  features: {
    decision_memory:      true,
    outcome_evaluator:    true,
    nba_engine:           true,
    nba_auto_apply:       false,  // must be opt-in per tenant
    narrative_briefing:   true,
    geo_intelligence:     true,
    content_loop:         true,
    index_manager:        true,
    creative_ai:          true,
    automation_sim:       true,
    access_gate:          false,  // off by default, per-tenant opt-in
  },

  limits: {
    nba_auto_apply_max:        3,    // max auto-applies per cron run
    nba_max_recommendations:   50,
    decision_memory_ring_size: 2000,
    narrative_cards_per_brief: 20,
    auto_apply_rate_per_hour:  3,    // rate limit per entity
  },

  notifications: {
    telegramChatId: undefined,       // each tenant must configure their own
  },
};

/** Platform-level feature flags (not overridable by tenants, set by super_admin only) */
export const PLATFORM_FLAGS = {
  /** Enforce IP allowlist for all tenants */
  ip_allowlist_enabled: true,
  /** Allow super_admin to override safety gates */
  super_admin_safety_override: true,
  /** Enable cross-tenant reporting (future — off by default) */
  cross_tenant_reports: false,
} as const;
