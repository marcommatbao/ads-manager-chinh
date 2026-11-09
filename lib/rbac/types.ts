// ============================================================
// Tenant-Aware RBAC — Types
//
// This layer generalises the current 5-role model into a
// capability-based system without breaking any existing code.
//
// Design principles:
//   - Legacy roles are kept intact in lib/permissions.ts
//   - This module adds a new orthogonal capability model
//   - Both models coexist; new code uses capabilities,
//     old code keeps using Role directly
// ============================================================

import type { Role } from "@/lib/permissions";
import type { TenantId } from "@/lib/tenants/types";

// ── Base roles (semantic, tenant-scoped) ──────────────────

/** The semantic role a user has within a tenant */
export type BaseRole = "super_admin" | "admin" | "viewer";

// ── Capabilities ──────────────────────────────────────────

/**
 * Fine-grained capability strings.
 * Format: <resource>.<action>
 * Adding new capabilities here does not break old code.
 */
export type Capability =
  // Platform (only super_admin)
  | "platform.manage_tenants"
  | "platform.manage_users"
  | "platform.view_all"

  // Module-level
  | "module.read"
  | "module.write"

  // Campaigns
  | "campaigns.read"
  | "campaigns.write"
  | "campaigns.pause"
  | "campaigns.budget_change"

  // Budget
  | "budget.read"
  | "budget.write"

  // CPL / KPI
  | "cpl.read"
  | "cpl.write"

  // Creative
  | "creative.read"
  | "creative.generate"

  // Automation
  | "automation.read"
  | "automation.write"
  | "automation.apply"

  // Reports
  | "reports.read"
  | "reports.export"

  // Settings
  | "settings.read"
  | "settings.write"
  | "settings.manage_credentials"

  // Team / users
  | "users.read"
  | "users.manage"

  // NBA / AI
  | "nba.read"
  | "nba.apply"

  // Decision memory
  | "decision_memory.read"
  | "decision_memory.override";

// ── Tenant role binding ────────────────────────────────────

/**
 * A user's role within a specific tenant.
 * Multiple bindings = access to multiple tenants with different roles.
 */
export interface TenantRoleBinding {
  tenantId: TenantId;
  role:     BaseRole;
}

// ── Resolved access context ────────────────────────────────

/**
 * Fully-resolved view of a user's access for a given tenant.
 * Derived from legacy Role + tenant context.
 */
export interface TenantAccessContext {
  tenantId:     TenantId;
  baseRole:     BaseRole;
  capabilities: Set<Capability>;
  legacyRole:   Role;
  isPlatformAdmin: boolean;
}

// ── Settings domain access ────────────────────────────────

export type SettingsDomainAccess = "read" | "write" | "none";

export interface SettingsDomainPermission {
  domain: string;
  access: SettingsDomainAccess;
}
