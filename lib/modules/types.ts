// ============================================================
// Config-Driven Module Registry — Types
//
// A ModuleDefinition is the canonical descriptor of one
// navigable feature area in AdsCommand.  The registry merges
// hardcoded defaults with optional per-tenant JSON overrides
// so modules can be enabled/disabled without code changes.
// ============================================================

import type { Role } from "@/lib/permissions";

// ── Identifiers ───────────────────────────────────────────

export type ModuleId =
  | "dashboard"
  | "campaigns"
  | "creative"
  | "visual-analysis"
  | "intelligence"
  | "google-pmax"
  | "google-audit"
  | "improvements"
  | "automation"
  | "toolkit"
  | "audiences"
  | "reports"
  | "notifications"
  | "guide"
  | "settings"
  // Future / commented-out modules — pre-registered so registry
  // can enable them without Sidebar code changes
  | "ai-ad-copy"
  | "competitors"
  | "ab-testing"
  | "cpl"
  | string;  // allow future modules not yet typed

export type ConnectorId = "meta" | "google" | "gemini" | "telegram" | "odoo";

export type BadgeKey = "improvements" | "notifications" | string;

// ── Child item ────────────────────────────────────────────

export interface ModuleChild {
  id:            string;
  label:         string;
  href:          string;
  requiredRoles?: Role[];
  /** Per-child enable flag; defaults to parent's enabled state */
  enabled?:      boolean;
}

// ── Module definition ─────────────────────────────────────

export interface ModuleDefinition {
  /** Stable slug — never changes even if label/href do */
  id:            ModuleId;

  /** Display name in nav */
  label:         string;

  /** Navigation path */
  href:          string;

  /** Lucide icon name (string so registry stays serialisable) */
  iconName:      string;

  /** Sort order in sidebar (lower = higher) */
  order:         number;

  // ── Visibility ──────────────────────────────────────────

  /** Show in sidebar navigation */
  navVisible:    boolean;

  /** Global enabled flag — false = hidden regardless of role/tenant */
  enabled:       boolean;

  // ── Access control ────────────────────────────────────────

  /**
   * Roles that can see and access this module.
   * Undefined = all authenticated roles.
   */
  requiredRoles?: Role[];

  // ── Tenant control ────────────────────────────────────────

  /** Enable for a new tenant by default */
  tenantDefault: boolean;

  /**
   * Explicit tenant overrides (TenantId → enabled).
   * Wins over tenantDefault when set.
   */
  tenantOverrides?: Record<string, boolean>;

  // ── Dependencies ─────────────────────────────────────────

  /**
   * Other module IDs that must be enabled for this module to
   * show.  Allows feature composition.
   */
  requiredModules?: ModuleId[];

  /**
   * Connector IDs that should be configured for this module
   * to be fully functional (advisory — does not hard-block).
   */
  requiredConnectors?: ConnectorId[];

  // ── Settings ─────────────────────────────────────────────

  /**
   * Settings domains this module reads or writes.
   * Used to surface relevant settings sub-pages.
   */
  settingsDomains?: string[];

  // ── Sub-navigation ────────────────────────────────────────

  /** Child nav items rendered as submenu */
  children?: ModuleChild[];

  /** Dynamic badge key shown on nav item */
  badge?: BadgeKey;
}

// ── Resolved form used by sidebar ────────────────────────

/**
 * A subset of ModuleDefinition that the sidebar renders.
 * Structurally compatible with the existing NavItem interface
 * so Sidebar.tsx needs minimal changes.
 */
export interface ResolvedNavItem {
  id:       ModuleId;
  label:    string;
  href:     string;
  iconName: string;
  badge?:   BadgeKey;
  children?: { id: string; label: string; href: string }[];
}
