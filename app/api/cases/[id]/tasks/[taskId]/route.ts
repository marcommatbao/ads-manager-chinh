// PATCH /api/cases/[id]/tasks/[taskId] {status?, assignee?} — việc giao người (tool không ghi được)
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { fail, requireCase } from "@/lib/case/http"
import { updateManualTask } from "@/lib/case/service"

export const dynamic = "force-dynamic"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params
  const t = await getT()
  const g = await requireCase(id, "can_edit", t)
  if (!g.ok) return g.response
  const b = (await request.json().catch(() => ({}))) as { status?: string; assignee?: string | null }
  if (b.status !== undefined && b.status !== "open" && b.status !== "done") {
    return NextResponse.json({ success: false, error: t("libcase.s.api.taskStatus") }, { status: 400 })
  }
  try {
    const patch = { status: b.status as "open" | "done" | undefined, assignee: b.assignee === undefined ? undefined : (b.assignee ? String(b.assignee).slice(0, 120) : null) }
    return NextResponse.json({ success: true, case: localizeCase(await updateManualTask(id, taskId, patch), t) })
  } catch (err) {
    return fail(err, t)
  }
}
