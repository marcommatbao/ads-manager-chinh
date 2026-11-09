// POST /api/cases/[id]/close — đóng phiên (bước 7); lịch đo lại 7/14 ngày giữ nguyên
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { fail, requireCase } from "@/lib/case/http"
import { closeCase } from "@/lib/case/service"

export const dynamic = "force-dynamic"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t)
  if (!g.ok) return g.response
  if (!g.value.c.executions.length) return NextResponse.json({ success: false, error: t("libcase.s.api.closeNoExec") }, { status: 409 })
  try {
    return NextResponse.json({ success: true, case: localizeCase(await closeCase(g.value.c.id), t) })
  } catch (err) {
    return fail(err, t)
  }
}
