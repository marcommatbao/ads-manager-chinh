"use client";

// ============================================================
// useSettingsPermission — client-side permission flags for
// all settings domains. Derived from session role + companies.
// ============================================================

import { companyIds } from "@/lib/companies/registry";
import { useSession } from "@/components/SessionProvider";
import { hasPermission, isSuperAdmin, canAccessCompany } from "@/lib/permissions";
import type { CompanyScope } from "@/lib/permissions";

export interface SettingsPermissions {
  // ── View ────────────────────────────────────────────────
  /** See masked API credentials form — Đợt 21 A4: CHỈ super_admin */
  canViewCredentials: boolean;
  /** See budget config */
  canViewBudget: boolean;
  /** See CPL thresholds */
  canViewThresholds: boolean;
  /** See user management page */
  canViewUsers: boolean;
  /** See audit log / rollback panel */
  canViewAudit: boolean;

  // ── Edit ─────────────────────────────────────────────────
  /** Save / update API credentials (super_admin only) */
  canEditCredentials: boolean;
  /** Modify budget limits */
  canEditBudget: boolean;
  /** Modify revenue targets */
  canEditRevenue: boolean;
  /** Modify CPL thresholds (super_admin only) */
  canEditThresholds: boolean;
  /** Add / edit / remove users */
  canManageUsers: boolean;
  /** Modify notification settings */
  canEditNotifications: boolean;

  // ── Special ───────────────────────────────────────────────
  /** Restore a rollback snapshot (super_admin only) */
  canRollback: boolean;
  /** Test API connection */
  canTestConnection: boolean;

  // ── Company scope ─────────────────────────────────────────
  /** Companies this user can see/edit */
  visibleCompanies: CompanyScope[];
  canSeeMBC: boolean;
  canSeeMBI: boolean;

  // ── Meta ─────────────────────────────────────────────────
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isViewer: boolean;
  isLoading: boolean;
}

const DENIED: SettingsPermissions = {
  canViewCredentials:  false,
  canViewBudget:       false,
  canViewThresholds:   false,
  canViewUsers:        false,
  canViewAudit:        false,
  canEditCredentials:  false,
  canEditBudget:       false,
  canEditRevenue:      false,
  canEditThresholds:   false,
  canManageUsers:      false,
  canEditNotifications:false,
  canRollback:         false,
  canTestConnection:   false,
  visibleCompanies:    [],
  canSeeMBC:           false,
  canSeeMBI:           false,
  isAdmin:             false,
  isSuperAdmin:        false,
  isViewer:            true,
  isLoading:           true,
};

export function useSettingsPermission(): SettingsPermissions {
  const { user, loading } = useSession();

  if (!user) return { ...DENIED, isLoading: loading };

  const role    = user.role;
  const isSuper = isSuperAdmin(role);
  const admin   = hasPermission(role, "can_edit");
  const viewer  = !admin;

  // Đợt 21 A5: theo người dùng (vai trò chung lấy phạm vi từ company_access) + công ty của bản cài.
  const companies = (companyIds() as CompanyScope[]).filter(co =>
    canAccessCompany(user, co),
  );

  return {
    canViewCredentials:   hasPermission(role, "can_view_credentials"),
    canViewBudget:        hasPermission(role, "can_manage_budget") || admin,
    canViewThresholds:    hasPermission(role, "can_view_cpl"),
    canViewUsers:         hasPermission(role, "can_manage_users"),
    canViewAudit:         isSuper,

    canEditCredentials:   hasPermission(role, "can_edit_credentials"),
    canEditBudget:        hasPermission(role, "can_manage_budget"),
    canEditRevenue:       admin,
    canEditThresholds:    hasPermission(role, "can_edit_thresholds"),
    canManageUsers:       hasPermission(role, "can_manage_users"),
    canEditNotifications: admin,

    canRollback:          isSuper,
    canTestConnection:    hasPermission(role, "can_view_credentials"),

    visibleCompanies:     companies,
    canSeeMBC:            canAccessCompany(user, "MBC"),
    canSeeMBI:            canAccessCompany(user, "MBI"),

    isAdmin:              admin,
    isSuperAdmin:         isSuper,
    isViewer:             viewer,
    isLoading:            loading,
  };
}
