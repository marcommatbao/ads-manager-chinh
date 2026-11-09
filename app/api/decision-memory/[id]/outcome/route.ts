// ============================================================
// PATCH /api/decision-memory/[id]/outcome
// Human closes a decision outcome (admin only).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, canAccessCompany } from "@/lib/permissions";
import { getById } from "@/lib/decision-memory/store";
import { closeOutcome } from "@/lib/decision-memory/recorder";
import type { FinalVerdict } from "@/lib/decision-memory/types";

export const dynamic = "force-dynamic";

const VALID_VERDICTS: FinalVerdict[] = ["better", "worse", "neutral", "inconclusive", "overridden"];

export async function PATCH(
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
  if (entry.outcome) return NextResponse.json({ error: "Outcome already set — use override endpoint to change" }, { status: 409 });

  const body = await request.json() as { verdict?: string; summaryNote?: string };
  if (!body.verdict || !VALID_VERDICTS.includes(body.verdict as FinalVerdict)) {
    return NextResponse.json({ error: `verdict must be one of: ${VALID_VERDICTS.join(", ")}` }, { status: 400 });
  }
  if (!body.summaryNote || body.summaryNote.trim().length < 5) {
    return NextResponse.json({ error: "summaryNote required (min 5 chars)" }, { status: 400 });
  }

  await closeOutcome(id, body.verdict as FinalVerdict, body.summaryNote.trim());
  return NextResponse.json({ success: true });
}
