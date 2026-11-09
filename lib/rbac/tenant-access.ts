// ============================================================
// Tenant-Aware Access Checks
//
// All tenant-scoped permission checks go through this module.
// Old code continues to use lib/permissions.ts directly.
// New code (NBA, decision memory, API routes) uses these.
//
// Integration points:
// ──────────────────
// 1. API route guard (replaces direct hasPermission() for new routes):
//      const ctx = buildAccessContext(user, "mbc");
//      if (!canPerform(ctx, "automation.apply")) return 403;
//
// 2. Middleware header injection (middleware.ts, lines 63-67):
//      const tenantIds = resolveUserTenants(session.role).map(t => t.tenantId);
//      response.headers.set("x-user-tenants", tenantIds.join(","));
//
// 3. Module gate (replaces manual role check in page components):
//      if (!canAccessModule(user, "automation", tenantId)) redirect("/");
//
// 4. Settings domain gate (new settings sub-page access check):
//      const access = getDomainAccess(user, "credentials_meta", "mbc");
//      if (access === "none") return 403;
// ============================================================

import type { Role } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { companyToTenantId, tenantIdToCompany } from "@/lib/tenants/resolver";
import type { TenantId } from "@/lib/tenants/types";
import type { Capability, TenantAccessContext } from "./types";
import { toBaseRole, capabilitiesForRole, settingsDomainAccess } from "./capabilities";
import { isModuleEnabled } from "@/lib/modules/registry";
import { canAccessModuleRoute } from "@/lib/modules/resolver";
import type { ModuleId } from "@/lib/modules/types";

// ── Context builder ───────────────────────────────────────

/**
 * Build a resolved access context for a user operating in a tenant.
 * tenantId can be a slug ("mbc") or undefined (platform-level).
 */
export function buildAccessContext(user: SessionUser, tenantId?: TenantId): TenantAccessContext {
  const role        = user.role as Role;
  const baseRole    = toBaseRole(role);
  const caps        = capabilitiesForRole(role);
  const companyKey  = tenantId ? tenantIdToCompany(tenantId) : null;

  // For non-super_admin: must have the tenant in their companies list
  const isPlatformAdmin = role === "super_admin";
  if (!isPlatformAdmin && tenantId && companyKey) {
    const hasAccess = (user.companies ?? []).includes(companyKey);
    if (!hasAccess) {
      // Return minimal context with no capabilities
      return {
        tenantId:        tenantId ?? ("unknown" as TenantId),
        baseRole:        "viewer",
        capabilities:    new Set<Capability>(),
        legacyRole:      role,
        isPlatformAdmin: false,
      };
    }
  }

  return {
    tenantId:        tenantId ?? ("platform" as TenantId),
    baseRole,
    capabilities:    caps,
    legacyRole:      role,
    isPlatformAdmin,
  };
}

// ── Capability check ──────────────────────────────────────

export function canPerform(ctx: TenantAccessContext, cap: Capability): boolean {
  return ctx.capabilities.has(cap);
}

export function canPerformAny(ctx: TenantAccessContext, caps: Capability[]): boolean {
  return caps.some(c => ctx.capabilities.has(c));
}

export function canPerformAll(ctx: TenantAccessContext, caps: Capability[]): boolean {
  return caps.every(c => ctx.capabilities.has(c));
}

// ── Tenant access check ───────────────────────────────────

/**
 * Return the list of tenant IDs accessible to a user.
 * For non-platform-admins: derived from their companies array.
 */
export function getAccessibleTenants(user: SessionUser): TenantId[] {
  if (user.role === "super_admin") {
    // super_admin can access all tenants — return from registry
    const { readTenants } = require("@/lib/tenants/registry");
    return (readTenants() as Array<{ id: TenantId }>).map(t => t.id);
  }
  return (user.companies ?? [])
    .map(c => companyToTenantId(c))
    .filter((id): id is TenantId => id !== null);
}

/**
 * Returns true if the user can operate in a specific tenant.
 */
export function canAccessTenant(user: SessionUser, tenantId: TenantId): boolean {
  return getAccessibleTenants(user).includes(tenantId);
}

// ── Module access check ───────────────────────────────────

/**
 * Check if a user can access a module for a given tenant.
 * Combines: module enabled for tenant + user role has module visibility.
 */
export function canAccessModule(
  user:      SessionUser,
  moduleId:  ModuleId,
  tenantId?: TenantId,
): boolean {
  if (!isModuleEnabled(moduleId, tenantId)) return false;
  const ctx = buildAccessContext(user, tenantId);
  if (!canPerform(ctx, "module.read")) return false;

  // Also respect module's requiredRoles via resolver
  const role = user.role as Role;
  const { getModule } = require("@/lib/modules/registry");
  const mod = getModule(moduleId, tenantId);
  if (!mod) return false;
  if (!mod.requiredRoles || mod.requiredRoles.length === 0) return true;
  return mod.requiredRoles.includes(role);
}

// ── Route access (tenant-aware extension) ─────────────────

/**
 * Tenant-aware route check.  Falls through to existing canAccessRoute()
 * for routes not owned by the module registry.
 *
 * Usage in middleware.ts:
 *   import { tenantAwareCanAccessRoute } from "@/lib/rbac/tenant-access";
 *   const ok = tenantAwareCanAccessRoute(session.role, pathname, tenantId);
 *   if (!ok) { redirect "/?blocked=..." }
 */
export function tenantAwareCanAccessRoute(
  role:      Role,
  pathname:  string,
  tenantId?: TenantId,
): boolean {
  // Ask the module resolver first
  const moduleResult = canAccessModuleRoute(role, pathname, tenantId);
  if (moduleResult !== null) return moduleResult;

  // Fall back to existing ROUTE_PERMISSIONS logic
  const { canAccessRoute } = require("@/lib/permissions");
  return canAccessRoute(role, pathname);
}

// ── Settings domain access ────────────────────────────────

export function getDomainAccess(
  user:      SessionUser,
  domain:    string,
  tenantId?: TenantId,
): "read" | "write" | "none" {
  // Super admin has write everywhere; non-tenant-member has none
  if (!tenantId || canAccessTenant(user, tenantId)) {
    return settingsDomainAccess(user.role as Role, domain);
  }
  return "none";
}
