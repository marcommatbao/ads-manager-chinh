// ============================================================
// POST /api/decision-memory/[id]/override
// Human manual override — overwrites any existing outcome.
// Requires super_admin or admin; records who overrode and why.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, canAccessCompany } from "@/lib/permissions";
import { getById } from "@/lib/decision-memory/store";
import { addManualOverride } from "@/lib/decision-memory/recorder";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const { id } = await params;
  const entry = getById(id);
  // Đợt 21 A5b: quyết định của công ty KHÔNG được giao → 404 như không tồn tại (không lộ mã có hay không).
  if (!entry || !canAccessCompany(user, entry.target.company)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { reason?: string; overrodeTo?: string };
  if (!body.reason || body.reason.trim().length < 5) {
    return NextResponse.json({ error: "reason required (min 5 chars)" }, { status: 400 });
  }
  if (!body.overrodeTo || body.overrodeTo.trim().length < 2) {
    return NextResponse.json({ error: "overrodeTo required — describe what the correct action/outcome was" }, { status: 400 });
  }

  await addManualOverride(id, user.email, body.reason.trim(), body.overrodeTo.trim());
  return NextResponse.json({ success: true });
}
