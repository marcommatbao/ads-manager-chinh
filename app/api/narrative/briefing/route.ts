// ============================================================
// GET /api/narrative/briefing?company=MBC|MBI
//
// Returns a NarrativeBriefing — daily digest of NBA
// recommendations and learning memory signals, rendered
// in Vietnamese business tone with confidence caveats.
//
// Also accepts POST with a single EvaluationResult body
// to generate a one-off outcome card.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { buildBriefing, cardFromEvaluation } from "@/lib/narrative/builder";
import type { EvaluationResult } from "@/lib/outcome-evaluator/types";
import { isCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") as string | null;

  if (!company || !isCompany(company)) {
    return NextResponse.json({ error: "Thiếu công ty" }, { status: 400 });
  }

  const allowed = getCompaniesForRole(user);
  if (!allowed.includes(company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  const briefing = buildBriefing(company);
  return NextResponse.json({ success: true, data: briefing });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Partial<EvaluationResult> & { company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.company || !isCompany(body.company)) {
    return NextResponse.json({ error: "Thiếu công ty" }, { status: 400 });
  }
  if (!body.entityId || !body.outcomeLabel) {
    return NextResponse.json({ error: "Required: entityId, outcomeLabel" }, { status: 400 });
  }

  const allowed = getCompaniesForRole(user);
  if (!allowed.includes(body.company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  const card = cardFromEvaluation(body as EvaluationResult, body.company as string);
  return NextResponse.json({ success: true, data: card });
}
