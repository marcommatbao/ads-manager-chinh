// ============================================================
// AdsCommand — Individual User API
// PUT    /api/settings/users/[id]  — update member
// DELETE /api/settings/users/[id]  — remove member
// ============================================================

import { ALL_ROLE_IDS, GENERIC_ROLES } from "@/lib/permissions";
import { companyIds } from "@/lib/companies";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { updateMember, removeMember, getMember } from "@/lib/team";
import { writeAuditEntry, computeDiff } from "@/lib/settings/audit";
import type { Role } from "@/lib/permissions";
import type { MemberStatus, CompanyAccess } from "@/lib/team";
import { normalizePassword, passwordProblem } from "@/lib/password-policy";
import { friendlyError } from "@/lib/not-configured";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
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

    const { id } = await params;

    // Đợt 21 A5: đọc thân yêu cầu MỘT lần (trước đây đọc 2 lần khi tự sửa mình → luôn lỗi 500).
    const body = await request.json().catch(() => ({}));

    // Cannot change own role / own company scope
    if (id === currentUser.id) {
      if (body.role && body.role !== currentUser.role) {
        return NextResponse.json(
          { success: false, error: "Không thể tự thay đổi role của mình" },
          { status: 400 }
        );
      }
      if (body.company_access !== undefined) {
        return NextResponse.json({ success: false, error: "Không thể tự đổi phạm vi công ty của mình" }, { status: 400 });
      }
    }

    const { name, role, status, is_active, password, telegram_chat_id, company_access } = body as {
      name?: string;
      role?: Role;
      status?: MemberStatus;
      is_active?: boolean;
      password?: string;
      telegram_chat_id?: string;
      company_access?: CompanyAccess[];
    };

    const validAccess: CompanyAccess[] = ["ALL", ...companyIds()]; // Đợt 21 A5: công ty của bản cài
    // Đợt 21 A5: trước đây nhận BẤT KỲ chuỗi nào làm vai trò → kiểm theo danh sách vai trò.
    if (role !== undefined && !ALL_ROLE_IDS.includes(role)) return NextResponse.json({ success: false, error: "Role không hợp lệ" }, { status: 400 });
    const updates: Parameters<typeof updateMember>[1] = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;
    if (is_active !== undefined) updates.is_active = is_active;
    if (telegram_chat_id !== undefined) updates.telegram_chat_id = telegram_chat_id;
    if (password) {
      // Soát bảo mật 03/10: luật mật khẩu chung — kể cả Super Admin tự đặt cho mình ở đây (trước đây "a" vẫn được nhận).
      const pwProblem = passwordProblem(password);
      if (pwProblem) return NextResponse.json({ success: false, error: pwProblem }, { status: 400 });
      updates.password_hash = hashPassword(normalizePassword(password));
      // Đợt 21 B: đặt lại mật khẩu HỘ người khác → họ phải tự đổi ở lần đăng nhập tới (đặt cho chính mình thì không).
      updates.must_change_password = id !== currentUser.id;
    }
    // Đợt 21 A5 (soát bảo mật): danh sách sai → 400 (trước đây bỏ qua âm thầm, giữ giá trị cũ).
    if (company_access !== undefined) {
      if (!Array.isArray(company_access) || company_access.length === 0 || !company_access.every((a) => validAccess.includes(a))) {
        return NextResponse.json({ success: false, error: "Công ty truy cập không hợp lệ" }, { status: 400 });
      }
      updates.company_access = company_access;
    }
    // Đổi SANG vai trò chung (admin/viewer) thì PHẢI gửi kèm danh sách công ty: vai trò cũ đều đang lưu ["ALL"] (vô hại với
    // vai trò cũ vì phạm vi theo vai trò) — giữ nguyên ["ALL"] khi đổi sang vai trò chung là âm thầm cấp MỌI công ty.
    if (role !== undefined && GENERIC_ROLES.includes(role) && updates.company_access === undefined) {
      return NextResponse.json({ success: false, error: "Đổi sang vai trò Admin / Viewer phải chọn kèm công ty truy cập" }, { status: 400 });
    }

    // Capture before-state for diff (exclude password_hash)
    const before = await getMember(id);
    const { password_hash: _bph, ...beforeSafe } = before ?? { password_hash: undefined };

    const updated = await updateMember(id, updates);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy người dùng" },
        { status: 404 }
      );
    }

    const { password_hash: _ph, ...safe } = updated;

    // Audit — diff excludes password changes (only log field name)
    const safeBefore = { ...beforeSafe } as Record<string, unknown>;
    const safeAfter  = { ...safe }       as Record<string, unknown>;
    // If password changed, note it without logging the value
    const changedFields = Object.keys(updates)
      .filter(k => k !== "password_hash")
      .join(", ");
    const passwordChanged = "password_hash" in updates;
    const fieldSummary = passwordChanged
      ? [changedFields, "password"].filter(Boolean).join(", ")
      : changedFields || "no-op";

    await writeAuditEntry(
      "users", currentUser, "update",
      `user:${safe.email} → [${fieldSummary}]`,
      safeBefore, safeAfter, "ALL",
      {
        diff: computeDiff(safeBefore, safeAfter),
        note: `Updated by ${currentUser.email}`,
      },
    );

    return NextResponse.json({ success: true, data: safe });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
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

    const { id } = await params;

    if (id === currentUser.id) {
      return NextResponse.json(
        { success: false, error: "Không thể xóa tài khoản của chính mình" },
        { status: 400 }
      );
    }

    // Capture before-state for audit
    const target = await getMember(id);
    const targetEmail = target?.email ?? id;
    const { password_hash: _tph, ...targetSafe } = (target ?? {}) as typeof target & { password_hash?: string };

    const removed = await removeMember(id);
    if (!removed) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy người dùng" },
        { status: 404 }
      );
    }

    await writeAuditEntry(
      "users", currentUser, "delete",
      `user:${targetEmail}`,
      targetSafe ?? null, null, "ALL",
      { note: `Deleted by ${currentUser.email}` },
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
