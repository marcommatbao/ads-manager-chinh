// ============================================================
// AdsCommand — Users Management API
// GET  /api/settings/users  — list all members (no password_hash)
// POST /api/settings/users  — create new member
// ============================================================

import { companyIds } from "@/lib/companies";
import { isAllowedLoginEmail, loginDomainMessage } from "@/lib/login-domain";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getAllMembers, addMember } from "@/lib/team";
import { writeAuditEntry } from "@/lib/settings/audit";
import type { Role } from "@/lib/permissions";
import type { CompanyAccess } from "@/lib/team";
import { normalizePassword, passwordProblem } from "@/lib/password-policy";
import { friendlyError } from "@/lib/not-configured";

function companyAccessFromRole(role: Role): CompanyAccess[] {
  if (role === "super_admin") return ["ALL"];
  if (role === "admin_mbc" || role === "viewer_mbc") return ["MBC"];
  if (role === "admin_mbi" || role === "viewer_mbi") return ["MBI"];
  // Đợt 21 A5: vai trò chung → công ty đầu tiên của bản cài (bản Mắt Bão không có ca này trước đây → ["MBC"] như cũ)
  return [companyIds()[0] ?? "MBC"];
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "Không xác thực" },
        { status: 401 }
      );
    }
    if (!hasPermission(currentUser.role, "can_manage_users")) {
      return NextResponse.json(
        { success: false, error: "Không có quyền quản lý người dùng" },
        { status: 403 }
      );
    }

    const members = await getAllMembers();
    // Strip password_hash from all members
    const safe = members.map(({ password_hash: _ph, ...rest }) => rest);

    return NextResponse.json({ success: true, data: safe });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "Không xác thực" },
        { status: 401 }
      );
    }
    if (!hasPermission(currentUser.role, "can_manage_users")) {
      return NextResponse.json(
        { success: false, error: "Không có quyền quản lý người dùng" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, name, role, password, telegram_chat_id, company_access: rawAccess } = body as {
      email?: string;
      name?: string;
      role?: Role;
      password?: string;
      telegram_chat_id?: string;
      company_access?: CompanyAccess[];
    };

    if (email && !isAllowedLoginEmail(email)) {
      return NextResponse.json({ success: false, error: loginDomainMessage() }, { status: 400 });
    }
    if (!email || !name || !role || !password) {
      return NextResponse.json(
        { success: false, error: "Thiếu thông tin bắt buộc: email, name, role, password" },
        { status: 400 }
      );
    }

    // Soát bảo mật 03/10: mật khẩu đặt hộ cũng theo luật chung (trước đây "1" vẫn được nhận).
    const pwProblem = passwordProblem(password, email);
    if (pwProblem) return NextResponse.json({ success: false, error: pwProblem }, { status: 400 });

    const validRoles: Role[] = ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi", "admin", "viewer"]; // Đợt 21 A5: + vai trò chung
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { success: false, error: "Role không hợp lệ" },
        { status: 400 }
      );
    }

    const validAccess: CompanyAccess[] = ["ALL", ...companyIds()]; // Đợt 21 A5: công ty của bản cài
    // Đợt 21 A5 (soát bảo mật): gửi danh sách sai → 400 (trước đây âm thầm thay bằng mặc định).
    if (rawAccess !== undefined && (!Array.isArray(rawAccess) || rawAccess.length === 0 || !rawAccess.every((a) => validAccess.includes(a)))) {
      return NextResponse.json({ success: false, error: "Công ty truy cập không hợp lệ" }, { status: 400 });
    }
    const company_access: CompanyAccess[] = Array.isArray(rawAccess) && rawAccess.length > 0 ? rawAccess : companyAccessFromRole(role);

    const member = await addMember({
      email,
      name,
      role,
      company_access,
      password_hash: hashPassword(normalizePassword(password)),
      must_change_password: true, // Đợt 21 B: Super Admin đặt mật khẩu hộ → người dùng phải tự đổi ở lần đăng nhập đầu
      telegram_chat_id: telegram_chat_id || undefined,
    });

    const { password_hash: _ph, ...safe } = member;

    // Audit — never log password_hash
    await writeAuditEntry(
      "users", currentUser, "create",
      `user:${safe.email}`,
      null,
      { email: safe.email, name: safe.name, role: safe.role, company_access: safe.company_access },
      "ALL",
      { note: `Created by ${currentUser.email}` },
    );

    return NextResponse.json({ success: true, data: safe }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("đã tồn tại") ? 400 : 500;
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status });
  }
}
