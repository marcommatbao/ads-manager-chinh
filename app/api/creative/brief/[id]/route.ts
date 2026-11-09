// ============================================================
// GET    /api/creative/brief/[id]  — get single draft
// DELETE /api/creative/brief/[id]  — remove draft
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDraft, deleteDraft } from "@/lib/creative-brief/store";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const draft = getDraft(id);
  if (!draft) return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });

  const allowed = new Set(user.companies ?? []);
  if (!allowed.has("*") && !allowed.has(draft.input.company)) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  return NextResponse.json({ success: true, data: { draft } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const draft = getDraft(id);
  if (!draft) return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });

  const allowed = new Set(user.companies ?? []);
  if (!allowed.has("*") && !allowed.has(draft.input.company)) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  const deleted = await deleteDraft(id);
  return NextResponse.json({ success: deleted });
}
