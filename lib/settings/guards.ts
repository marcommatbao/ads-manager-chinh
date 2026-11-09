// ============================================================
// Settings server-side guards — reusable per-route helpers.
// Each guard returns a NextResponse(403/401) or null (pass).
// ============================================================

import { NextResponse } from "next/server";
import { hasPermission, isSuperAdmin, canAccessCompany, type CompanyScope } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import type { SettingsDomain } from "./types";
import { companyIds } from "@/lib/companies"

// ── Auth ───────────────────────────────────────────────────

/** Returns 401 if user is not authenticated. */
export function guardAuth(user: SessionUser | null): NextResponse | null {
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** Returns 403 if user is not super_admin. */
export function guardSuperAdmin(user: SessionUser): NextResponse | null {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json(
      { error: "Chỉ Super Admin mới có quyền thực hiện thao tác này" },
      { status: 403 },
    );
  }
  return null;
}

// ── Credentials ────────────────────────────────────────────

/** GET credentials: admin+ only (returns masked values). */
export function guardViewCredentials(user: SessionUser): NextResponse | null {
  if (!hasPermission(user.role, "can_view_credentials")) {
    return NextResponse.json(
      { error: "Bạn không có quyền xem thông tin kết nối API" },
      { status: 403 },
    );
  }
  return null;
}

/** POST/PUT credentials: super_admin only. */
export function guardEditCredentials(user: SessionUser): NextResponse | null {
  if (!hasPermission(user.role, "can_edit_credentials")) {
    return NextResponse.json(
      { error: "Chỉ Super Admin mới có quyền cập nhật API credentials" },
      { status: 403 },
    );
  }
  return null;
}

// ── Budget ─────────────────────────────────────────────────

/** PUT budget: requires can_manage_budget. */
export function guardEditBudget(user: SessionUser): NextResponse | null {
  if (!hasPermission(user.role, "can_manage_budget")) {
    return NextResponse.json(
      { error: "Bạn không có quyền thay đổi ngân sách" },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Restrict a budget config object to only the companies the user can access.
 * super_admin → both; admin_mbc → MBC only; admin_mbi → MBI only.
 */
export function scopeBudgetToCompanies<T extends Record<string, unknown>>(
  user: SessionUser,
  config: T,
): Partial<T> {
  if (isSuperAdmin(user.role)) return config;
  const scoped: Partial<T> = {};
  const companies = companyIds();
  for (const co of companies) {
    if (canAccessCompany(user, co) && co in config) {
      scoped[co as keyof T] = config[co as keyof T];
    }
  }
  return scoped;
}

/**
 * For PUT: 403 if the body touches ANY company outside the user's scope.
 * Audit 30/09: trước đây chỉ chặn khi MỌI công ty đều ngoài phạm vi → gửi kèm {MBC:{}} là ghi được MBI.
 */
export function guardBudgetCompanyScope(
  user: SessionUser,
  body: Record<string, unknown>,
): NextResponse | null {
  if (isSuperAdmin(user.role)) return null;
  const attempted = companyIds().filter(co => co in body);
  const allowed   = companyIds().filter(co => canAccessCompany(user, co));
  const outOfScope = attempted.filter(co => !allowed.includes(co));
  if (outOfScope.length > 0) {
    return NextResponse.json(
      { error: `Bạn không có quyền chỉnh ngân sách ${outOfScope.join(", ")}` },
      { status: 403 },
    );
  }
  return null;
}

// ── CPL / Revenue ──────────────────────────────────────────

/** PUT CPL thresholds: requires can_edit_thresholds. */
export function guardEditThresholds(user: SessionUser): NextResponse | null {
  if (!hasPermission(user.role, "can_edit_thresholds")) {
    return NextResponse.json(
      { error: "Bạn không có quyền chỉnh ngưỡng CPL. Liên hệ Super Admin." },
      { status: 403 },
    );
  }
  return null;
}

/** PUT revenue targets: requires can_edit. */
export function guardEditRevenue(user: SessionUser): NextResponse | null {
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json(
      { error: "Bạn không có quyền chỉnh mục tiêu doanh thu" },
      { status: 403 },
    );
  }
  return null;
}

// ── Domain-generic ─────────────────────────────────────────

/**
 * Generic settings edit guard — routes by domain.
 * Returns a NextResponse or null.
 */
export function guardSettingsEdit(
  user: SessionUser,
  domain: SettingsDomain,
  body?: Record<string, unknown>,
): NextResponse | null {
  switch (domain) {
    case "credentials_meta":
    case "credentials_google":
    case "credentials_gemini":
    case "credentials_telegram":
      return guardEditCredentials(user);

    case "budget":
      return guardEditBudget(user) ?? (body ? guardBudgetCompanyScope(user, body) : null);

    case "cpl_thresholds":
      return guardEditThresholds(user);

    case "revenue":
    case "kpi":
      return guardEditRevenue(user);

    case "users":
    case "team":
      if (!hasPermission(user.role, "can_manage_users")) {
        return NextResponse.json({ error: "Bạn không có quyền quản lý người dùng" }, { status: 403 });
      }
      return null;

    case "notifications":
    case "tracking":
      // Admin+ only
      if (!hasPermission(user.role, "can_edit")) {
        return NextResponse.json({ error: "Bạn không có quyền chỉnh cài đặt này" }, { status: 403 });
      }
      return null;

    default:
      return null;
  }
}
