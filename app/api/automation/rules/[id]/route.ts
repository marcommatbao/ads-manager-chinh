// ============================================================
// Automation Rule [id] API — GET/PUT/DELETE single rule
// ============================================================

import { getT } from "@/lib/i18n/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllRules,
  updateRule,
  deleteRule,
  toggleRule,
} from "@/lib/automation-engine";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany, getCompaniesForRole } from "@/lib/permissions";
import { canTouchRuleScope, ruleTouchesBudget } from "@/lib/automation-rule-permission";
import { friendlyError } from "@/lib/not-configured";

// ── GET: get a single rule by ID ──
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const rules = getAllRules();
    const rule = rules.find(r => r.id === id);
    if (!rule) {
      return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: rule });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

// ── PUT: update a single rule ──
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: t("libcase.r.ari.1") }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await request.json();
    // Hai đường phải chặn: gửi kèm hành động đổi ngân sách, HOẶC bật một rule
    // sẵn có mà không gửi lại actions (body chỉ có { isActive: true }).
    const current = getAllRules().find(r => r.id === id);

    // CHẶN GHI CHÉO CÔNG TY — hai chiều:
    //   • rule ĐANG thuộc công ty mình không được phép → không cho sửa;
    //   • đổi rule sang công ty mình không được phép → cũng không cho.
    // Thiếu phép kiểm này thì admin một công ty sửa được rule tự động của công
    // ty kia, và engine chạy theo lịch sẽ áp lên campaign THẬT.
    // Audit 30/09: company trống/null = "cả hai công ty" (engine hiểu như vậy) — trước đây filter(Boolean) bỏ qua
    // nó nên PUT {company:null} mở rộng được rule sang công ty kia.
    const scopes: unknown[] = [current?.company, ...(body && "company" in body ? [body.company] : [])];
    for (const c of scopes) {
      if (!canTouchRuleScope(user, c)) {
        return NextResponse.json({
          success: false,
          error: t("libcase.r.ari.2", { v1: String(c ?? "cả hai công ty") }),
        }, { status: 403 });
      }
    }

    const armingExisting = body?.isActive === true && ruleTouchesBudget(current?.actions);
    if ((ruleTouchesBudget(body?.actions) || armingExisting)
        && !hasPermission(user.role, "can_manage_budget")) {
      return NextResponse.json({
        success: false,
        error: t("libcase.r.ari.3"),
      }, { status: 403 });
    }
    const updated = updateRule(id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

// ── DELETE: delete a single rule ──
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: t("libcase.r.ari.1") }, { status: 403 });
  }

  const { id } = await params;
  try {
    // Cùng lý do như PUT: thiếu phép kiểm này thì admin một công ty xoá được
    // rule tự động của công ty kia.
    const current = getAllRules().find(r => r.id === id);
    if (current?.company) {
      const ok = current.company === "all"
        ? getCompaniesForRole(user).length === 2
        : canAccessCompany(user, current.company as string);
      if (!ok) {
        return NextResponse.json({
          success: false,
          error: t("libcase.r.ari.4", { v1: current.company }),
        }, { status: 403 });
      }
    }

    const deleted = deleteRule(id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

// ── PATCH: toggle rule active status ──
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: t("libcase.r.ari.1") }, { status: 403 });
  }

  const { id } = await params;
  try {
    // Bật một rule đổi ngân sách = đổi ngân sách, lặp mỗi 6 giờ. Đòi đúng quyền
    // như đường đổi trực tiếp thay vì để đường vòng dễ hơn đường thẳng.
    const existing = getAllRules().find(r => r.id === id);
    // Xác minh audit 01/10: PATCH (bật/tắt) cũng phải kiểm công ty của rule đang lưu — trước đây admin_mbc bật/tắt
    // được rule của MBI qua đường này dù PUT/DELETE đã chặn.
    if (existing && !canTouchRuleScope(user, existing.company)) {
      return NextResponse.json({ success: false, error: t("libcase.r.ari.5") }, { status: 403 });
    }
    if (existing && !existing.isActive && ruleTouchesBudget(existing.actions)
        && !hasPermission(user.role, "can_manage_budget")) {
      return NextResponse.json({
        success: false,
        error: t("libcase.r.ari.6"),
      }, { status: 403 });
    }
    const toggled = toggleRule(id);
    if (!toggled) {
      return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: toggled });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
