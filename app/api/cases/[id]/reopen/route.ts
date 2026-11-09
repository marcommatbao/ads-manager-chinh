// POST /api/cases/[id]/reopen — 14/10/2026: mở lại phiên ở bước 4 NGAY (không chờ mốc đo cuối): thu lại bằng chứng 30 ngày
// gần nhất, tính lại nguyên nhân + hướng xử lý theo mục tiêu đã chốt. Không ghi gì lên Google/Meta.
import { NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { actorOf, fail, requireCase } from "@/lib/case/http"
import { reopenNow } from "@/lib/case/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ success: true, case: localizeCase(await reopenNow(g.value.c.id, actorOf(g.value.user), new Date(), t), t) })
  } catch (err) {
    return fail(err, t)
  }
}
