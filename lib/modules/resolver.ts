// ============================================================
// Module Resolver — Role + Tenant Filtering
//
// Converts the raw module registry into the filtered, sorted
// list that the sidebar and route guard consume.
//
// Integration points
// ──────────────────
// Sidebar (components/Sidebar.tsx):
//   Replace the hardcoded `navItems` array:
//
//     import { getNavModules } from "@/lib/modules/resolver";
//     // In component body (server side or client side with useSession):
//     const navItems = getNavModules(user.role, tenantId);
//
// Route access (lib/permissions.ts):
//   Extend canAccessRoute() to check the module registry:
//
//     import { canAccessModuleRoute } from "@/lib/modules/resolver";
//     // In canAccessRoute, add:
//     if (!canAccessModuleRoute(role, pathname)) return false;
//
// Settings page:
//   Show only settings domains relevant to enabled modules:
//
//     import { settingsDomainsForRole } from "@/lib/modules/resolver";
//     const domains = settingsDomainsForRole(role, tenantId);
// ============================================================

import type { Role } from "@/lib/permissions";
import { getModules, isModuleEnabled } from "./registry";
import type { ModuleDefinition, ModuleId, ResolvedNavItem } from "./types";

// ── Role check ────────────────────────────────────────────

function roleCanSeeModule(role: Role, mod: ModuleDefinition): boolean {
  if (!mod.requiredRoles || mod.requiredRoles.length === 0) return true;
  return mod.requiredRoles.includes(role);
}

// ── Dependency check ──────────────────────────────────────

function dependenciesMet(
  mod:       ModuleDefinition,
  tenantId?: string,
  all?:      ModuleDefinition[],
): boolean {
  if (!mod.requiredModules || mod.requiredModules.length === 0) return true;
  return mod.requiredModules.every(depId => isModuleEnabled(depId, tenantId));
}

// ── Tenant eligibility ────────────────────────────────────

function isTenantEligible(mod: ModuleDefinition, tenantId?: string): boolean {
  if (!tenantId) return mod.tenantDefault;
  if (mod.tenantOverrides && mod.tenantOverrides[tenantId] !== undefined) {
    return mod.tenantOverrides[tenantId];
  }
  return mod.tenantDefault;
}

// ── Main resolver ─────────────────────────────────────────

/**
 * Return the sorted, filtered list of modules visible to a user.
 * Pass tenantId for tenant-level filtering; omit for internal default.
 */
export function getVisibleModules(
  role:      Role,
  tenantId?: string,
): ModuleDefinition[] {
  const all = getModules(tenantId);
  return all
    .filter(m =>
      m.navVisible &&
      m.enabled &&
      isTenantEligible(m, tenantId) &&
      roleCanSeeModule(role, m) &&
      dependenciesMet(m, tenantId, all)
    )
    .sort((a, b) => a.order - b.order);
}

/**
 * Returns nav items in a shape compatible with Sidebar.tsx NavItem.
 * Sidebar only needs: label, href, iconName, badge, children.
 */
export function getNavModules(
  role:      Role,
  tenantId?: string,
): ResolvedNavItem[] {
  return getVisibleModules(role, tenantId).map(m => ({
    id:       m.id,
    label:    m.label,
    href:     m.href,
    iconName: m.iconName,
    badge:    m.badge,
    children: m.children
      ?.filter(c => {
        if (!c.enabled && c.enabled !== undefined) return false;
        if (!c.requiredRoles || c.requiredRoles.length === 0) return true;
        return c.requiredRoles.includes(role);
      })
      .map(c => ({ id: c.id, label: c.label, href: c.href })),
  }));
}

// ── Route access check (extend canAccessRoute) ────────────

/**
 * Check if a role is permitted to access a route based on the
 * module registry.  Returns null if no module owns this route
 * (caller falls through to existing ROUTE_PERMISSIONS logic).
 */
export function canAccessModuleRoute(
  role:      Role,
  pathname:  string,
  tenantId?: string,
): boolean | null {
  const all = getModules(tenantId);
  // Find the module that owns this route (exact or prefix)
  let bestMod: ModuleDefinition | undefined;
  let bestLen = 0;
  for (const mod of all) {
    if (pathname === mod.href || (mod.href !== "/" && pathname.startsWith(mod.href))) {
      if (mod.href.length > bestLen) {
        bestLen = mod.href.length;
        bestMod = mod;
      }
    }
    // Also check children
    for (const child of mod.children ?? []) {
      if (pathname === child.href || pathname.startsWith(child.href + "/")) {
        if (child.href.length > bestLen) {
          bestLen = child.href.length;
          bestMod = mod;
        }
      }
    }
  }

  if (!bestMod) return null; // unknown route — defer to ROUTE_PERMISSIONS

  // Module must be enabled
  if (!isModuleEnabled(bestMod.id, tenantId)) return false;

  // Role check
  return roleCanSeeModule(role, bestMod);
}

// ── Settings domains for role ─────────────────────────────

/**
 * Return the settings domains relevant to the modules a role can access.
 * Used by settings page to surface only applicable sub-sections.
 */
export function settingsDomainsForRole(
  role:      Role,
  tenantId?: string,
): string[] {
  const visible = getVisibleModules(role, tenantId);
  const domains = new Set<string>();
  for (const mod of visible) {
    for (const d of mod.settingsDomains ?? []) {
      domains.add(d);
    }
  }
  return [...domains];
}

// ── Module by id ──────────────────────────────────────────

export function getModuleById(id: ModuleId, tenantId?: string): ModuleDefinition | undefined {
  return getModules(tenantId).find(m => m.id === id);
}

export { getVisibleModules as getModulesForRole };
