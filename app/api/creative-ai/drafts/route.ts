// ============================================================
// GET    /api/creative-ai/drafts?company=X           — list pending drafts
// GET    /api/creative-ai/drafts?id=X&company=Y       — fetch one draft
// POST   /api/creative-ai/drafts   { company }         — create draft
// PATCH  /api/creative-ai/drafts   { id, ... }          — update draft
// DELETE /api/creative-ai/drafts   { id }               — delete draft
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { canAccessCompany, hasPermission } from "@/lib/permissions";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import {
  createDraft, getDraft, listPendingDrafts, updateDraft, deleteDraftById,
  type DraftStepKey, type DraftStatus,
} from "@/lib/creative-ai-draft-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Chấm theo VAI TRÒ. Bản cũ chấm theo user.companies — trường đó là PHẠM VI và
// đang mang ["ALL"] cho MỌI tài khoản (kể cả viewer_mbc), nên phép kiểm này
// luôn đúng cho tất cả mọi người, tức không kiểm gì cả.
function hasCompanyAccess(user: SessionUser, company: string): boolean {
  return canAccessCompany(user, company as string);
}

// ── GET: list pending drafts, or fetch one by id ──────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const company = url.searchParams.get("company") ?? "";

  if (!company) return NextResponse.json({ error: "Missing company" }, { status: 400 });
  if (!hasCompanyAccess(user, company)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (id) {
    const draft = getDraft(id, company);
    return NextResponse.json({ draft });
  }

  const drafts = listPendingDrafts(company);
  return NextResponse.json({ drafts });
}

// ── POST: create a new draft ───────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // viewer_* chỉ được ĐỌC. Bản cũ chỉ kiểm đăng nhập, nên người chỉ có
  // quyền xem vẫn tạo/sửa/xoá được bản nháp của bất kỳ công ty nào.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa" }, { status: 403 });
  }

  let body: { company?: string };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const company = body.company ?? "";
  if (!company) return NextResponse.json({ error: "Missing company" }, { status: 400 });
  if (!hasCompanyAccess(user, company)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const draft = await createDraft(company);
  return NextResponse.json({ draft });
}

// ── PATCH: auto-save step data / rename / mark launched ────────

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // viewer_* chỉ được ĐỌC. Bản cũ chỉ kiểm đăng nhập, nên người chỉ có
  // quyền xem vẫn tạo/sửa/xoá được bản nháp của bất kỳ công ty nào.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa" }, { status: 403 });
  }

  let body: {
    id?: string; name?: string; status?: string; currentStep?: number;
    stepKey?: string; stepData?: unknown;
  };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = getDraft(body.id);
  if (!existing) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!hasCompanyAccess(user, existing.company)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const stepKey: DraftStepKey | undefined =
    body.stepKey === "step1Data" || body.stepKey === "step2Data" ||
    body.stepKey === "step3Data" || body.stepKey === "step4Data"
      ? body.stepKey : undefined;
  const status: DraftStatus | undefined =
    body.status === "ACTIVE" || body.status === "LAUNCHED" ? body.status : undefined;

  const draft = await updateDraft(body.id, {
    name: body.name,
    status,
    currentStep: body.currentStep,
    stepKey,
    stepData: body.stepData,
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  return NextResponse.json({ draft });
}

// ── DELETE: discard a draft ────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // viewer_* chỉ được ĐỌC. Bản cũ chỉ kiểm đăng nhập, nên người chỉ có
  // quyền xem vẫn tạo/sửa/xoá được bản nháp của bất kỳ công ty nào.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa" }, { status: 403 });
  }

  let body: { id?: string };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = getDraft(body.id);
  if (existing && !hasCompanyAccess(user, existing.company)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const success = await deleteDraftById(body.id);
  return NextResponse.json({ success });
}
