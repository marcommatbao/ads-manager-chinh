// GET /api/jobs — all job states + registry metadata
// Requires: authenticated user (all roles can view)

import { schedulerHealth } from "@/lib/jobs/heartbeat";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { buildJobStates } from "@/lib/jobs/state";
import { ACTIVE_JOBS as JOB_REGISTRY } from "@/lib/jobs/registry";
import { jobInInstall } from "@/lib/jobs/store";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Đợt 25: bản khách không thấy job của Mắt Bão (Lead/Order Notify matbao.in, Quality Score MBC/MBI…).
  const states  = buildJobStates().filter((s) => jobInInstall(s.jobId));
  const meta    = JOB_REGISTRY.filter((d) => jobInInstall(d.id)).map(d => ({
    id:                   d.id,
    displayName:          d.displayName,
    description:          d.description,
    cronExpr:             d.cronExpr,
    intervalLabel:        d.intervalLabel,
    riskLevel:            d.riskLevel,
    riskNote:             d.riskNote ?? null,
    endpoint:             d.endpoint,
    manualTriggerAllowed: d.manualTriggerAllowed,
    schedulingStatus:     d.schedulingStatus,
  }));

  return NextResponse.json({
    states,
    meta,
    canControl: isSuperAdmin(user.role),
    nbaAutoApply: process.env.NBA_AUTO_APPLY ?? "dry_run",
    scheduler: schedulerHealth(), // Đợt 22b: crond / tick còn chạy không
  });
}
