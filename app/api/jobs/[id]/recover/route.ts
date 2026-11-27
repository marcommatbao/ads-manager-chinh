import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { acknowledgeExpiredCheckpoint } from "@/lib/jobs/store"

/** Acknowledge uncertain history only; no execution/retry/control changes. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSuperAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if ((await params).id !== "quality_checkpoint") return NextResponse.json({ error: "recovery_not_supported" }, { status: 400 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }) }
  if (!body || typeof body !== "object" || !("runId" in body) || !("expectedStartedAt" in body)
    || typeof body.runId !== "string" || !body.runId || body.runId.length > 128
    || typeof body.expectedStartedAt !== "string" || body.expectedStartedAt.length > 40) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  try {
    const recovered = await acknowledgeExpiredCheckpoint(body.runId, body.expectedStartedAt, user.email)
    return NextResponse.json({ recovered }, { status: recovered ? 200 : 409 })
  } catch {
    return NextResponse.json({ error: "job_history_unavailable" }, { status: 503 })
  }
}
