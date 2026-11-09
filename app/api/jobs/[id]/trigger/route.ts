// POST /api/jobs/[id]/trigger — manual trigger (super_admin only)
// Calls the job's actual endpoint with CRON_SECRET auth.
// Only allowed for jobs where manualTriggerAllowed = true.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { JOBS_BY_ID } from "@/lib/jobs/registry";
import type { JobId } from "@/lib/jobs/types";
import { friendlyError } from "@/lib/not-configured";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "Chỉ Super Admin mới có quyền trigger job thủ công" }, { status: 403 });
  }

  const { id } = await params;
  if (!(id in JOBS_BY_ID)) {
    return NextResponse.json({ error: `Unknown job: ${id}` }, { status: 400 });
  }

  const desc = JOBS_BY_ID[id as JobId];
  if (!desc.manualTriggerAllowed) {
    return NextResponse.json({ error: `${desc.displayName} không hỗ trợ trigger thủ công` }, { status: 400 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET chưa được cấu hình" }, { status: 503 });
  }

  // Build the internal URL — use Next.js base URL.
  // Bug fix 2026-07-13: `process.env.NEXTAUTH_URL || process.env.VERCEL_URL ? ... : ...`
  // evaluated the ternary condition on the whole `||` expression, so when
  // only NEXTAUTH_URL was set (true in this Coolify deployment) and
  // VERCEL_URL wasn't, baseUrl resolved to "https://undefined".
  const baseUrl = process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const targetUrl = `${baseUrl}${desc.endpoint}`;

  try {
    const res = await fetch(targetUrl, {
      // Bug fix 2026-07-13: this used to hardcode GET, which silently
      // 405'd every manual trigger for the 3 POST-only routes
      // (automation_sim_apply, decision_memory_eval, weekly_report).
      method: desc.httpMethod,
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "X-Manual-Trigger": user.email,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(desc.maxDurationSec * 1000),
    });

    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown;
    if (contentType.includes("application/json")) {
      body = await res.json();
    } else {
      body = { raw: await res.text() };
    }

    return NextResponse.json({
      success:    res.ok,
      statusCode: res.status,
      triggeredBy: user.email,
      jobId: id,
      result: body,
    }, { status: res.ok ? 200 : 502 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: friendlyError(msg), jobId: id }, { status: 500 });
  }
}
