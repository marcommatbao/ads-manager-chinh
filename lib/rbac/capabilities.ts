// ============================================================
// RBAC — Role → Capability Map
//
// Derives the capability set from a legacy Role.
// Maps the current 5 roles to BaseRoles and their capabilities.
//
// This is pure data — no side effects, no I/O.
// ============================================================

import type { Role } from "@/lib/permissions";
import type { BaseRole, Capability } from "./types";

// ── BaseRole derivation ───────────────────────────────────

export function toBaseRole(role: Role): BaseRole {
  if (role === "super_admin")                      return "super_admin";
  if (role === "admin_mbc" || role === "admin_mbi" || role === "admin") return "admin"; // Đợt 21 A5: + vai trò chung
  return "viewer";
}

// ── Capability sets per BaseRole ──────────────────────────

const SUPER_ADMIN_CAPS: Capability[] = [
  // Platform
  "platform.manage_tenants",
  "platform.manage_users",
  "platform.view_all",
  // All module caps
  "module.read",
  "module.write",
  // Campaigns
  "campaigns.read",
  "campaigns.write",
  "campaigns.pause",
  "campaigns.budget_change",
  // Budget
  "budget.read",
  "budget.write",
  // CPL
  "cpl.read",
  "cpl.write",
  // Creative
  "creative.read",
  "creative.generate",
  // Automation
  "automation.read",
  "automation.write",
  "automation.apply",
  // Reports
  "reports.read",
  "reports.export",
  // Settings
  "settings.read",
  "settings.write",
  "settings.manage_credentials",
  // Users
  "users.read",
  "users.manage",
  // NBA / AI
  "nba.read",
  "nba.apply",
  // Decision memory
  "decision_memory.read",
  "decision_memory.override",
];

const ADMIN_CAPS: Capability[] = [
  "module.read",
  "module.write",
  "campaigns.read",
  "campaigns.write",
  "campaigns.pause",
  "campaigns.budget_change",
  "budget.read",
  "budget.write",
  "cpl.read",
  "creative.read",
  "creative.generate",
  "automation.read",
  "automation.write",
  "automation.apply",
  "reports.read",
  "reports.export",
  "settings.read",
  "settings.manage_credentials",  // view masked creds
  "users.read",
  "nba.read",
  "nba.apply",
  "decision_memory.read",
];

const VIEWER_CAPS: Capability[] = [
  "module.read",
  "campaigns.read",
  "cpl.read",
  "reports.read",
  "settings.read",
  "nba.read",
  "decision_memory.read",
];

// ── Pre-computed capability sets ──────────────────────────

const CAPS_BY_BASE: Record<BaseRole, Set<Capability>> = {
  super_admin: new Set(SUPER_ADMIN_CAPS),
  admin:       new Set(ADMIN_CAPS),
  viewer:      new Set(VIEWER_CAPS),
};

// ── Public helpers ────────────────────────────────────────

/** Return the capability Set for a legacy role */
export function capabilitiesForRole(role: Role): Set<Capability> {
  return CAPS_BY_BASE[toBaseRole(role)];
}

/** Check if a legacy role has a specific capability */
export function roleHasCapability(role: Role, cap: Capability): boolean {
  return capabilitiesForRole(role).has(cap);
}

/** All capabilities for a BaseRole (for inspection / UI) */
export function capabilitiesForBaseRole(base: BaseRole): Capability[] {
  return [...(CAPS_BY_BASE[base] ?? [])];
}

// ── Settings domain access ────────────────────────────────

/**
 * Map settings domain + role → access level.
 * Mirrors current RolePermissions semantics.
 */
export function settingsDomainAccess(
  role:   Role,
  domain: string,
): "read" | "write" | "none" {
  const caps = capabilitiesForRole(role);

  // Credentials: only read for admin, write for super_admin
  if (domain.startsWith("credentials_")) {
    if (caps.has("settings.manage_credentials") && caps.has("settings.write")) return "write";
    if (caps.has("settings.manage_credentials")) return "read";
    return "none";
  }

  // Budget / CPL thresholds: super_admin write, admin read
  if (domain === "budget" || domain === "cpl_thresholds" || domain === "revenue") {
    if (caps.has("budget.write") || caps.has("cpl.write")) return "write";
    if (caps.has("budget.read")  || caps.has("cpl.read"))  return "read";
    return "none";
  }

  // Users / team: super_admin only
  if (domain === "users" || domain === "team") {
    if (caps.has("users.manage")) return "write";
    if (caps.has("users.read"))   return "read";
    return "none";
  }

  // General settings: everyone with settings.read gets read; super_admin gets write
  if (caps.has("settings.write")) return "write";
  if (caps.has("settings.read"))  return "read";
  return "none";
}
