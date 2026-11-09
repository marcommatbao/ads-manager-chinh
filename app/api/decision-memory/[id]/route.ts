// ============================================================
// GET   /api/decision-memory/[id]  — single entry
// PATCH /api/decision-memory/[id]  — mark reviewed
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, isAdmin, canAccessCompany } from "@/lib/permissions";
import { getById } from "@/lib/decision-memory/store";
import { markReviewed } from "@/lib/decision-memory/recorder";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role) /* Đợt 21 A4: can_view_credentials nay CHỈ super_admin (xem khoá). Tính năng này không phải khoá → giữ phạm vi cũ admin+. */) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const entry = getById(id);
  // Đợt 21 A5b: quyết định của công ty KHÔNG được giao → 404 như không tồn tại (không lộ mã có hay không).
  if (!entry || !canAccessCompany(user, entry.target.company)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ success: true, data: entry });
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role) /* Đợt 21 A4: can_view_credentials nay CHỈ super_admin (xem khoá). Tính năng này không phải khoá → giữ phạm vi cũ admin+. */) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const entry = getById(id);
  // Đợt 21 A5b: quyết định của công ty KHÔNG được giao → 404 như không tồn tại (không lộ mã có hay không).
  if (!entry || !canAccessCompany(user, entry.target.company)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await markReviewed(id, user.email);
  return NextResponse.json({ success: true });
}
