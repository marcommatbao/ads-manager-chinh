import { NextRequest, NextResponse } from "next/server"
import { actorOf, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { QualityWorkflowError, qualityBriefs, writeQualityAction } from "@/lib/inbox/quality-workflow"

export const dynamic = "force-dynamic"
const errorResponse = (e: unknown) => NextResponse.json({ success: false,
  code: e instanceof QualityWorkflowError ? e.code : "storeUnavailable" },
  { status: e instanceof QualityWorkflowError ? e.status : 503, headers: { "Cache-Control": "no-store" } })
export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  try {
    const [brief] = await qualityBriefs([co.value])
    return NextResponse.json({ success: true, brief, canEdit: hasPermission(u.value.role, "can_edit") }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) { return errorResponse(e) }
}
export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = await request.json().catch(() => null)
  const co = requireCompany(u.value, b?.company)
  if (!co.ok) return co.response
  if (!b || !["record", "observe", "new_cycle"].includes(b.operation) || typeof b.registryId !== "string" || !/^[a-f0-9]{64}$/.test(b.registryId)
    || !(b.expectedRevision === null || typeof b.expectedRevision === "string" && /^[a-f0-9-]{36}$/.test(b.expectedRevision))
    || (b.operation === "new_cycle" ? b.confirmed !== true : b.confirmed !== undefined)
    || Object.keys(b).some(k => !["company", "operation", "registryId", "expectedRevision", "confirmed"].includes(k))) {
    return NextResponse.json({ success: false, code: "invalidInput" }, { status: 400 })
  }
  try {
    // Record only the evidence currently presented by the server, never an old healthy/changed claim.
    if (b.operation === "record" || b.operation === "new_cycle") {
      const [current] = await qualityBriefs([co.value])
      if (current.reference.registryId !== b.registryId && current.action?.baseline.registryId !== b.registryId && !current.history?.some(a => a.baseline.registryId === b.registryId)) throw new QualityWorkflowError(409, "evidenceChanged")
    }
    const action = await writeQualityAction(co.value, b, actorOf(u.value))
    return NextResponse.json({ success: true, action }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) { return errorResponse(e) }
}
