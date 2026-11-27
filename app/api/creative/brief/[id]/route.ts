import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, hasPermission } from "@/lib/permissions";
import { getDraft, saveDraft, reviewDraft, BriefStoreError } from "@/lib/creative-brief/store";
import type { BriefInput, CreativeBrief } from "@/lib/creative-brief/types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function error(err: unknown) {
  return NextResponse.json({ success: false, error: err instanceof BriefStoreError ? err.message : "Brief unavailable" }, { status: err instanceof BriefStoreError ? err.status : 503 });
}
export async function GET(_req: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  try {
    const draft = getDraft((await params).id);
    if (!draft) throw new BriefStoreError(404, "Draft not found");
    if (!canAccessCompany(user, draft.input.company)) throw new BriefStoreError(403, "Access denied");
    return NextResponse.json({ success: true, data: { draft, canEdit: hasPermission(user.role, "can_edit") } });
  } catch (err) { return error(err); }
}
/** Explicit review or manual content edit; never calls a provider. */
export async function PATCH(req: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) return NextResponse.json({ success: false }, { status: 403 });
  try {
    let body;
    try { body = await req.json(); } catch { throw new BriefStoreError(400, "Invalid JSON"); }
    if (!body || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || typeof body.company !== "string") throw new BriefStoreError(400, "Company and expectedRevision required");
    if (!canAccessCompany(user, body.company)) throw new BriefStoreError(403, "Access denied");
    const id = (await params).id;
    const current = getDraft(id);
    if (!current) throw new BriefStoreError(404, "Draft not found");
    if (!canAccessCompany(user, current.input.company) || current.input.company !== body.company) throw new BriefStoreError(403, "Company mismatch");
    if (current.revision !== body.expectedRevision) throw new BriefStoreError(409, "Brief revision conflict");
    let draft;
    if (body.action === "review") {
      if (typeof body.contentHash !== "string") throw new BriefStoreError(400, "Content reference required");
      draft = await reviewDraft(id, body.company, body.expectedRevision, body.contentHash, user.id);
    } else if (body.action === "edit") {
      // Deliberately narrow manual edit: USP/value proposition only. All other
      // generated content and source references come from the stored revision.
      if (typeof body.usp !== "string" || !body.usp.trim() || body.usp.length > 4000 || typeof body.valueProposition !== "string" || !body.valueProposition.trim() || body.valueProposition.length > 4000 || !current.output) throw new BriefStoreError(400, "USP and value proposition required (max 4000 characters)");
      const output: CreativeBrief = { ...current.output, usp: body.usp, valueProposition: body.valueProposition };
      draft = await saveDraft(id, current.name, current.input as BriefInput, output, body.expectedRevision);
    } else throw new BriefStoreError(400, "Unknown brief action");
    return NextResponse.json({ success: true, data: { draft } });
  } catch (err) { return error(err); }
}
export async function DELETE(_req: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) return NextResponse.json({ success: false }, { status: 403 });
  try {
    const draft = getDraft((await params).id);
    if (!draft) throw new BriefStoreError(404, "Draft not found");
    if (!canAccessCompany(user, draft.input.company)) throw new BriefStoreError(403, "Access denied");
    throw new BriefStoreError(409, "Brief history retained; deletion disabled");
  } catch (err) { return error(err); }
}
