// GET   /api/jobs/[id] — single job state
// PATCH /api/jobs/[id] — pause / resume / update note (super_admin only)
//   Body: { action: "pause" | "resume", reason?: string }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { buildJobState } from "@/lib/jobs/state";
import { getJobControl, saveJobControl } from "@/lib/jobs/store";
import { JOBS_BY_ID } from "@/lib/jobs/registry";
import type { JobId } from "@/lib/jobs/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(id in JOBS_BY_ID)) {
    return NextResponse.json({ error: `Unknown job: ${id}` }, { status: 400 });
  }

  const state = buildJobState(id as JobId);
  return NextResponse.json({ state, meta: JOBS_BY_ID[id as JobId] });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "Chỉ Super Admin mới có quyền kiểm soát job" }, { status: 403 });
  }

  const { id } = await params;
  if (!(id in JOBS_BY_ID)) {
    return NextResponse.json({ error: `Unknown job: ${id}` }, { status: 400 });
  }

  const body = await req.json() as { action: "pause" | "resume"; reason?: string };
  const { action, reason } = body;

  if (action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: "action must be 'pause' or 'resume'" }, { status: 400 });
  }

  const jobId   = id as JobId;
  const control = getJobControl(jobId);
  const now     = new Date().toISOString();

  if (action === "pause") {
    if (!reason?.trim()) {
      return NextResponse.json({ error: "Cần nhập lý do để tạm dừng job" }, { status: 400 });
    }
    control.enabled      = false;
    control.pausedAt     = now;
    control.pausedBy     = user.email;
    control.pauseReason  = reason.trim();
  } else {
    control.enabled      = true;
    control.pausedAt     = null;
    control.pausedBy     = null;
    control.pauseReason  = null;
  }

  await saveJobControl(control);

  return NextResponse.json({
    success:  true,
    jobId,
    action,
    control,
  });
}
