// GET   /api/policy-radar/items/[id] — item detail
// PATCH /api/policy-radar/items/[id] — update review state (admin only)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getItemById, updateReview } from "@/lib/policy-radar/store";
import type { PolicyReviewStatus } from "@/lib/policy-radar/types";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await getItemById(id);
  if (!item) return NextResponse.json({ success: false, error: "Không tìm thấy mục" }, { status: 404 });
  return NextResponse.json({ success: true, data: item });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_manage_policy_radar")) {
    return NextResponse.json({ success: false, error: "Không có quyền duyệt mục Policy Radar" }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const updated = await updateReview(id, {
    status: body.status as PolicyReviewStatus | undefined,
    internalNote: body.internalNote === undefined ? undefined : (body.internalNote as string | null),
    reviewedBy: user.email,
  });
  if (!updated) return NextResponse.json({ success: false, error: "Không tìm thấy mục" }, { status: 404 });
  return NextResponse.json({ success: true, data: updated });
}
