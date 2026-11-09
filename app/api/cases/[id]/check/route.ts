// POST /api/cases/[id]/check — 14/10/2026: "Kiểm tra ngay" — đo kỳ [ngày thực hiện, hôm nay] ngoài lịch để xem chẩn đoán
// ("vì sao" + "nên làm gì"). Chỉ ĐỌC Google/Meta; không đổi lịch đo, không mở lại phiên. Chặn bấm liên tục 10 phút.
import { NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { fail, requireCase } from "@/lib/case/http"
import { checkNow } from "@/lib/case/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ success: true, case: localizeCase(await checkNow(g.value.c.id), t) })
  } catch (err) {
    return fail(err, t)
  }
}
