// ============================================================
// PATCH  /api/notifications/[id]  — resolve / mark_read
// DELETE /api/notifications/[id]  — delete (super_admin only)
//
// Was missing entirely — NotificationBell.tsx and notifications/page.tsx
// already called these endpoints ("Giải quyết"/"Xóa" buttons 404'd silently
// since fetch() errors there are swallowed). Filled in while wiring
// root-cause diagnosis into the same alert list.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin, canAccessCompany } from "@/lib/permissions";
import { getAlertById, markAlertRead, resolveAlert, deleteAlert } from "@/lib/alert-engine";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const alert = await getAlertById(id);
  if (!alert) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  if (!canAccessCompany(user, alert.company as string)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action;

  if (action === "resolve") {
    const updated = await resolveAlert(id, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ success: true, data: updated });
  }
  if (action === "mark_read") {
    const updated = await markAlertRead(id);
    return NextResponse.json({ success: true, data: updated });
  }

  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ success: false, error: "Chỉ Super Admin mới có quyền xoá thông báo" }, { status: 403 });
  }

  const { id } = await params;
  const alert = await getAlertById(id);
  if (!alert) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  const ok = await deleteAlert(id);
  return NextResponse.json({ success: ok });
}
