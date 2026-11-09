// ============================================================
// POST /api/outcome-eval
// Evaluate a before/after metric snapshot pair and return
// a structured EvaluationResult.
//
// Used by: decision-memory evaluation UI, manual review, briefing.
// Auth: can_view_credentials minimum.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, isAdmin, canAccessCompany } from "@/lib/permissions";
import { evaluate } from "@/lib/outcome-evaluator/evaluator";
import { getWindow, recommendedWindow } from "@/lib/outcome-evaluator/windows";
import type { EvaluationInput } from "@/lib/outcome-evaluator/types";
import { isCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role) /* Đợt 21 A4: can_view_credentials nay CHỈ super_admin (xem khoá). Tính năng này không phải khoá → giữ phạm vi cũ admin+. */) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Partial<EvaluationInput> & { windowLabel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.entityId || !body.company || !body.before || !body.after || !body.event) {
    return NextResponse.json({ error: "Required: entityId, company, event, before, after" }, { status: 400 });
  }
  if (!isCompany(body.company!)) {
    return NextResponse.json({ error: "company không hợp lệ" }, { status: 400 });
  }
  if (!canAccessCompany(user, body.company!)) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); // Đợt 21 A5b

  const window = body.windowLabel
    ? getWindow(body.windowLabel)
    : recommendedWindow(body.event!);

  const input: EvaluationInput = {
    entityId:   body.entityId,
    entityName: body.entityName ?? body.entityId,
    company:    body.company as string,
    event:      body.event!,
    objective:  body.objective,
    before:     body.before!,
    after:      body.after!,
    window,
    context:    body.context ?? {},
    decisionId: body.decisionId,
  };

  const result = evaluate(input);
  return NextResponse.json({ success: true, data: result });
}
