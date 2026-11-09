// ============================================================
// GET  /api/decision-memory  — paginated list (company-scoped)
// POST /api/decision-memory  — create a manual decision entry
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { queryDecisions } from "@/lib/decision-memory/query";
import { recordDecision } from "@/lib/decision-memory/recorder";
import type { QueryFilter } from "@/lib/decision-memory/query";
import type { RecordDecisionParams } from "@/lib/decision-memory/recorder";
import { isCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

// ── GET ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") as string | null;

  if (!company || !isCompany(company)) {
    return NextResponse.json({ error: "Thiếu công ty" }, { status: 400 });
  }

  // Viewers can only see their own company silo — was checking the
  // unrelated can_view_credentials permission (blocked all viewers
  // regardless of company, while letting an admin_mbc/admin_mbi request
  // the OTHER company's decision memory) — fixed to the actual company
  // scope check.
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  const filter: QueryFilter = {
    company,
    entityId:   searchParams.get("entityId")   ?? undefined,
    entityType: searchParams.get("entityType") ?? undefined,
    platform:   searchParams.get("platform")   ?? undefined,
    sinceHours: searchParams.get("sinceHours") ? Number(searchParams.get("sinceHours")) : undefined,
    verdict:    (searchParams.get("verdict") as QueryFilter["verdict"]) ?? undefined,
    hasOutcome: searchParams.get("hasOutcome") === "true" ? true
               : searchParams.get("hasOutcome") === "false" ? false : undefined,
    limit:      searchParams.get("limit") ? Math.min(200, Number(searchParams.get("limit"))) : 50,
  };

  const entries = queryDecisions(filter);

  return NextResponse.json({
    success: true,
    data: {
      entries,
      total: entries.length,
      company,
    },
  });
}

// ── POST ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(user.role, "can_edit_credentials")) {
    return NextResponse.json({ error: "Forbidden — admin required to create manual decision entries" }, { status: 403 });
  }

  let body: RecordDecisionParams;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.event || !body.target || !body.rationale || !body.action) {
    return NextResponse.json({ error: "Missing required fields: event, target, action, rationale" }, { status: 400 });
  }

  if (!isCompany(body.target.company)) {
    return NextResponse.json({ error: "Công ty không có ở bản cài này" }, { status: 400 });
  }

  // Force source to human_manual with the calling user's identity
  const params: RecordDecisionParams = {
    ...body,
    source: { type: "human_manual", actor: user.email },
  };

  try {
    const entry = await recordDecision(params);
    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: friendlyError(err instanceof Error ? err.message : "Failed to record decision") },
      { status: 500 },
    );
  }
}
