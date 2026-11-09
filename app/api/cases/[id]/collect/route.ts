// POST /api/cases/[id]/collect — kéo lại bằng chứng từ Google (CHỈ ĐỌC)
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { fail, requireCase } from "@/lib/case/http"
import { recollect } from "@/lib/case/service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, undefined, t)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ success: true, case: localizeCase(await recollect(g.value.c.id), t) })
  } catch (err) {
    return fail(err, t)
  }
}
