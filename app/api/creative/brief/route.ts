// ============================================================
// POST /api/creative/brief   — generate + save a brief
// GET  /api/creative/brief   — list drafts (?limit=20)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { canAccessCompany } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth";
import { buildBrief } from "@/lib/creative-brief/builder";
import { briefReferences } from "@/lib/playbook/suggest";
import { saveDraft, listDrafts } from "@/lib/creative-brief/store";
import { randomUUID } from "crypto";
import type { BriefInput } from "@/lib/creative-brief/types";
import { friendlyError } from "@/lib/not-configured";
import { getT } from "@/lib/i18n/server";

export const dynamic  = "force-dynamic";
export const revalidate = 0;

// ── POST: generate brief ──────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  let body: { input: BriefInput; name?: string; draftId?: string };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }

  const { input, name, draftId } = body;

  if (!input?.company || !input?.product || !input?.objective || !input?.funnelStage || !input?.platform) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: company, product, objective, funnelStage, platform" },
      { status: 400 },
    );
  }

  // Chấm theo VAI TRÒ. Bản cũ coi "ALL"/"*" trong user.companies là cờ toàn
  // quyền — mà MỌI tài khoản đều mang ["ALL"], kể cả viewer_mbc, nên phép kiểm
  // này chưa từng chặn được ai.
  if (!canAccessCompany(user, input.company as string)) {
    return NextResponse.json(
      { success: false, error: `Access denied: user cannot access company ${input.company}` },
      { status: 403 },
    );
  }

  try {
    const brief = buildBrief(input, await getT());
    // Đợt 7b — đính mẫu đã thắng/thua từ Sổ kinh nghiệm. Sổ hỏng không được chặn brief.
    try {
      const refs = briefReferences(input.company, input.platform === "both" ? ["facebook", "google"] : [input.platform], String(input.product));
      if (refs.length) brief.playbookReferences = refs;
    } catch (e) { console.error("[brief] không đọc được Sổ kinh nghiệm:", e); }
    const id    = draftId ?? randomUUID();
    const draft = await saveDraft(id, name ?? brief.product.displayName, input, brief);

    return NextResponse.json({ success: true, data: { brief, draft } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/creative/brief]", message);
    // Compliance BLOCK errors → 422
    if (message.includes("blocked by compliance") || message.includes("does not belong")) {
      return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 422 });
    }
    return NextResponse.json({ success: false, error: `Brief generation failed: ${message}` }, { status: 500 });
  }
}

// ── GET: list drafts ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const url   = new URL(request.url);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? "20")), 50);

  try {
    const allDrafts = listDrafts(50);
    // Filter by company access
    const drafts  = allDrafts
      .filter(d => canAccessCompany(user, d.input.company as string))
      .slice(0, limit);

    return NextResponse.json({ success: true, data: { drafts, total: drafts.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
