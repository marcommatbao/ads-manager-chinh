import { makeT, type TFunction } from "@/lib/i18n/translate"
import { companyIds, isCompany } from "@/lib/companies/registry";
// ============================================================
// AdsCommand — Permissions & RBAC (Company-Based Roles)
// ============================================================

// ─────────────────────────────────────────────
// Role Types
// ─────────────────────────────────────────────

export type Role =
  | "super_admin"   // Full access MBC + MBI
  | "admin_mbc"     // Full access MBC only
  | "admin_mbi"     // Full access MBI only
  | "viewer_mbc"    // Read-only MBC
  | "viewer_mbi"    // Read-only MBI
  // Đợt 21 A5: vai trò CHUNG — phạm vi công ty lấy từ company_access của người dùng (["ALL"] = mọi công ty của bản cài).
  // Vai trò cũ ở trên giữ NGUYÊN hành vi (phạm vi theo vai trò).
  | "admin"         // Toàn quyền trong các công ty được gán
  | "viewer";       // Chỉ xem các công ty được gán

/** Vai trò chung (Đợt 21 A5) — phạm vi theo người dùng, không theo tên vai trò. */
export const GENERIC_ROLES: readonly Role[] = ["admin", "viewer"];
export const ADMIN_LIKE_ROLES: readonly Role[] = ["super_admin", "admin_mbc", "admin_mbi", "admin"];
export const ALL_ROLE_IDS: readonly Role[] = ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi", "admin", "viewer"];
/** Người dùng (hoặc chỉ vai trò — cách gọi cũ) để kiểm công ty. */
export type AccessSubject = Role | { role: Role; companies?: string[] | null };

export type CompanyScope = string;

// ─────────────────────────────────────────────
// Permission Matrix
// ─────────────────────────────────────────────

export interface RolePermissions {
  companies: CompanyScope[];
  can_edit: boolean;
  can_manage_budget: boolean;
  can_manage_users: boolean;
  can_view_cpl: boolean;
  can_input_offline: boolean;
  can_edit_thresholds: boolean;
  /** View masked API credentials in Settings → API page */
  can_view_credentials: boolean;
  /** Save / update API credentials (super_admin only) */
  can_edit_credentials: boolean;
  /** Add policy items manually and mark Policy Radar items reviewed */
  can_manage_policy_radar: boolean;
}

export type PermissionKey = keyof Omit<RolePermissions, "companies">;

const PERMISSIONS: Record<Role, RolePermissions> = {
  super_admin: {
    // Đợt 21a: mọi công ty chạy quảng cáo của bản cài (bản Mắt Bão: MBC, MBI). Getter = đọc lúc tra.
    get companies() { return companyIds() },
    can_edit:             true,
    can_manage_budget:    true,
    can_manage_users:     true,
    can_view_cpl:         true,
    can_input_offline:    true,
    can_edit_thresholds:  true,
    can_view_credentials: true,
    can_edit_credentials: true,
    can_manage_policy_radar: true,
  },
  admin_mbc: {
    companies:            ["MBC"],
    can_edit:             true,
    can_manage_budget:    true,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    false,
    can_edit_thresholds:  false,
    can_view_credentials: false,  // Đợt 21 A4 (user 03/10): CHỈ super_admin xem được khoá, kể cả dạng đã che
    can_edit_credentials: false,  // cannot save new keys
    can_manage_policy_radar: true,
  },
  admin_mbi: {
    companies:            ["MBI"],
    can_edit:             true,
    can_manage_budget:    true,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    true,
    can_edit_thresholds:  false,
    can_view_credentials: false, // Đợt 21 A4: chỉ super_admin
    can_edit_credentials: false,
    can_manage_policy_radar: true,
  },
  viewer_mbc: {
    companies:            ["MBC"],
    can_edit:             false,
    can_manage_budget:    false,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    false,
    can_edit_thresholds:  false,
    can_view_credentials: false,
    can_edit_credentials: false,
    can_manage_policy_radar: false,
  },
  viewer_mbi: {
    companies:            ["MBI"],
    can_edit:             false,
    can_manage_budget:    false,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    false,
    can_edit_thresholds:  false,
    can_view_credentials: false,
    can_edit_credentials: false,
    can_manage_policy_radar: false,
  },
  // Đợt 21 A5: vai trò chung. companies = mọi công ty của bản cài (trần); phạm vi thật = company_access của người dùng.
  admin: {
    get companies() { return companyIds() },
    can_edit:             true,
    can_manage_budget:    true,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    true,
    can_edit_thresholds:  false,
    can_view_credentials: false,
    can_edit_credentials: false,
    can_manage_policy_radar: true,
  },
  viewer: {
    get companies() { return companyIds() },
    can_edit:             false,
    can_manage_budget:    false,
    can_manage_users:     false,
    can_view_cpl:         true,
    can_input_offline:    false,
    can_edit_thresholds:  false,
    can_view_credentials: false,
    can_edit_credentials: false,
    can_manage_policy_radar: false,
  },
};

// ─────────────────────────────────────────────
// Permission Checkers
// ─────────────────────────────────────────────

export function getPermissions(role: Role): RolePermissions {
  return PERMISSIONS[role];
}

export function hasPermission(role: Role, action: PermissionKey): boolean {
  return PERMISSIONS[role]?.[action] ?? false;
}

/** Công ty người/vai trò này được dùng. Vai trò cũ: theo vai trò (y như trước). Vai trò chung: company_access ∩ công ty bản cài. */
export function getCompaniesForRole(subject: AccessSubject): CompanyScope[] {
  const role = typeof subject === "string" ? subject : subject.role;
  const perm = PERMISSIONS[role];
  if (!perm) return [];
  if (!GENERIC_ROLES.includes(role)) return perm.companies;
  // Vai trò chung mà chỉ có tên vai trò (không có danh sách công ty của người) → KHÔNG cho gì (an toàn).
  if (typeof subject === "string") return [];
  const list = subject.companies ?? [];
  return list.includes("ALL") ? companyIds() : companyIds().filter((c) => list.includes(c));
}

export function canAccessCompany(subject: AccessSubject, company: CompanyScope): boolean {
  return getCompaniesForRole(subject).includes(company);
}

/** Được giao MỌI công ty của bản cài (Đợt 21 A5b) — dùng cho cài đặt/dữ liệu chung không gắn với một công ty (vd tài sản GA4
 *  chưa gán công ty, KPI năm). Bản cài không có công ty nào → false. */
export function canAccessAllCompanies(subject: AccessSubject): boolean {
  const ids = companyIds();
  const mine = getCompaniesForRole(subject);
  return ids.length > 0 && ids.every((c) => mine.includes(c));
}

/**
 * Phạm vi công ty THẬT của một phiên đăng nhập.
 *
 * Vì sao cần: trường `companies` trong phiên KHÔNG phải danh sách công ty, nó
 * là phạm vi — và giá trị đang dùng cho MỌI tài khoản là ["ALL"] (kiểm
 * data/team-members.json 16/09/2026, cả 5 tài khoản; nhánh đăng nhập qua SEO ở
 * app/api/auth/login cũng gán cứng ["ALL"]).
 *
 * Nên đoạn mã phổ biến này SAI với mọi người dùng:
 *     ["MBC","MBI"].filter(c => user.companies.includes(c))   // → []
 * Nó cho ra danh sách rỗng rồi trang báo "Tài khoản của bạn chưa được gán công
 * ty nào" — đúng lỗi người dùng gặp ở Budget Pacing, và 4 trang Toolkit khác
 * cũng dính y hệt.
 *
 * Ở đây mở "ALL" ra thành danh sách thật, RỒI giao với phạm vi của vai trò —
 * viewer_mbc dù mang ["ALL"] cũng chỉ được MBC, khớp đúng điều máy chủ sẽ cho
 * qua ở canAccessCompany().
 */
export function resolveCompanyScope(
  companies: string[] | undefined | null,
  role: Role | undefined | null,
): CompanyScope[] {
  const roleScope = role && PERMISSIONS[role] ? PERMISSIONS[role].companies : []; // vai trò chung: trần = mọi công ty, giao với `companies` bên dưới
  const list = companies ?? [];
  const expanded: CompanyScope[] = list.includes("ALL")
    ? companyIds()
    : (list.filter((c): c is CompanyScope => isCompany(c)));
  return expanded.filter(c => roleScope.includes(c));
}

export function isAdmin(role: Role): boolean {
  return ADMIN_LIKE_ROLES.includes(role);
}

export function isSuperAdmin(role: Role): boolean {
  return role === "super_admin";
}

// ─────────────────────────────────────────────
// Route Access Control
// ─────────────────────────────────────────────

const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  "/settings/users":          ["super_admin"],
  "/settings/cpl-thresholds": ["super_admin"],
  "/settings/team":           ["super_admin"],
  "/settings/budget":         ["super_admin"],
  "/settings/connections":    ["super_admin", "admin_mbc", "admin_mbi"],
  "/settings/notifications":  ["super_admin", "admin_mbc", "admin_mbi"],
  "/settings":                ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
  "/automation":              ["super_admin", "admin_mbc", "admin_mbi"],
  "/creative":                ["super_admin", "admin_mbc", "admin_mbi"],
  "/cpl":                     ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
  "/campaigns":               ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
  "/reports":                 ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
  "/policy-radar":            ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
  "/":                        ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi"],
};

// Đợt 21 A5: vai trò chung đi theo vai trò cũ tương ứng (admin ≈ admin_mbc/mbi, viewer ≈ viewer_mbc/mbi).
for (const roles of Object.values(ROUTE_PERMISSIONS)) {
  if ((roles.includes("admin_mbc") || roles.includes("admin_mbi")) && !roles.includes("admin")) roles.push("admin");
  if ((roles.includes("viewer_mbc") || roles.includes("viewer_mbi")) && !roles.includes("viewer")) roles.push("viewer");
}

export function canAccessRoute(role: Role, pathname: string): boolean {
  // Exact match
  if (ROUTE_PERMISSIONS[pathname]) {
    return ROUTE_PERMISSIONS[pathname].includes(role);
  }
  // Prefix match — find most specific
  let bestMatch = "";
  for (const route of Object.keys(ROUTE_PERMISSIONS)) {
    if (pathname.startsWith(route) && route.length > bestMatch.length) {
      bestMatch = route;
    }
  }
  if (bestMatch && ROUTE_PERMISSIONS[bestMatch]) {
    return ROUTE_PERMISSIONS[bestMatch].includes(role);
  }
  return true;
}

const BLOCKED_MESSAGES: Record<string, string> = {
  "/settings/users":          "Chỉ Super Admin mới có quyền quản lý người dùng",
  "/settings/cpl-thresholds": "Chỉ Super Admin mới có quyền chỉnh ngưỡng CPL",
  "/settings/team":           "Chỉ Super Admin mới có quyền quản lý team",
  "/settings/budget":         "Chỉ Super Admin mới có quyền thay đổi ngân sách",
  "/automation":              "Bạn không có quyền truy cập Automation",
  "/creative":                "Bạn không có quyền truy cập Creative AI",
};

export function getBlockedMessage(pathname: string, t: TFunction = makeT("vi")): string {
  for (const route of Object.keys(BLOCKED_MESSAGES)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return t(`libcase.blocked.${route}` as never);
    }
  }
  return t("libcase.blocked.default");
}

// ─────────────────────────────────────────────
// Role UI Config
// ─────────────────────────────────────────────

export const ROLE_CONFIG: Record<Role, {
  label: string;
  labelVi: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  companyLabel: string;
}> = {
  super_admin: {
    label: "Super Admin",
    labelVi: "Quản trị viên tối cao",
    description: "Toàn quyền MBC + MBI",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    companyLabel: "MBC & MBI",
  },
  admin_mbc: {
    label: "Admin MBC",
    labelVi: "Quản trị viên MBC",
    description: "Toàn quyền MBC",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    companyLabel: "MBC",
  },
  admin_mbi: {
    label: "Admin MBI",
    labelVi: "Quản trị viên MBI",
    description: "Toàn quyền MBI + nhập offline",
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
    companyLabel: "MBI",
  },
  viewer_mbc: {
    label: "Viewer MBC",
    labelVi: "Người xem MBC",
    description: "Chỉ xem báo cáo MBC",
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    companyLabel: "MBC",
  },
  viewer_mbi: {
    label: "Viewer MBI",
    labelVi: "Người xem MBI",
    description: "Chỉ xem báo cáo MBI",
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    companyLabel: "MBI",
  },
  // Đợt 21 A5 — vai trò chung (phạm vi công ty theo người dùng)
  admin: {
    label: "Admin",
    labelVi: "Quản trị viên",
    description: "Toàn quyền trong các công ty được gán",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    companyLabel: "Theo công ty được gán",
  },
  viewer: {
    label: "Viewer",
    labelVi: "Người xem",
    description: "Chỉ xem các công ty được gán",
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    companyLabel: "Theo công ty được gán",
  },
};

// All available roles for UI selects
export const ALL_ROLES: Role[] = [
  "super_admin",
  "admin_mbc",
  "admin_mbi",
  "viewer_mbc",
  "viewer_mbi",
  "admin",
  "viewer",
];

// Permission labels for UI display
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  can_edit:             "Chỉnh sửa campaigns",
  can_manage_budget:    "Quản lý ngân sách",
  can_manage_users:     "Quản lý người dùng",
  can_view_cpl:         "Xem CPL tracking",
  can_input_offline:    "Nhập đơn offline (MBI)",
  can_edit_thresholds:  "Chỉnh ngưỡng CPL",
  can_view_credentials: "Xem cài đặt kết nối API",
  can_edit_credentials: "Lưu/cập nhật API credentials",
  can_manage_policy_radar: "Thêm/duyệt mục Policy Radar",
};

// Nhãn theo ngôn ngữ (không đổi logic vai trò/quyền): giao diện gọi kèm t; ROLE_CONFIG/PERMISSION_LABELS giữ bản tiếng Việt.
export const roleLabelVi = (role: Role, t: TFunction = makeT("vi")): string => t(`libcase.role.${role}.labelVi` as never);
export const roleDescription = (role: Role, t: TFunction = makeT("vi")): string => t(`libcase.role.${role}.desc` as never);
export const roleCompanyLabel = (role: Role, t: TFunction = makeT("vi")): string => t(`libcase.role.${role}.company` as never);
export const permissionLabel = (key: PermissionKey, t: TFunction = makeT("vi")): string => t(`libcase.perm.${key}` as never);
