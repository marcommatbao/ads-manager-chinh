// POST /api/cases/[id]/undo {executionId} — hoàn tác đúng những gì lần thực hiện đó đã đổi
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { actorOf, fail, requireCase } from "@/lib/case/http"
import { undoExecution } from "@/lib/case/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t)
  if (!g.ok) return g.response
  const { executionId } = (await request.json().catch(() => ({}))) as { executionId?: string }
  if (!executionId) return NextResponse.json({ success: false, error: t("libcase.s.api.execId") }, { status: 400 })
  try {
    const r = await undoExecution(g.value.c.id, executionId, actorOf(g.value.user), t)
    return NextResponse.json({ success: true, ...r, case: localizeCase(r.case, t) })
  } catch (err) {
    return fail(err, t)
  }
}
