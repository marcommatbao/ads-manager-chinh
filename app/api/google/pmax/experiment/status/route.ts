// GET /api/google/pmax/experiment/status?company=&id= — đo lại kết quả thí nghiệm (khác-biệt-trong-khác-biệt theo tuần).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { experimentStatus } from "@/lib/pmax/geo-experiment"
import { PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  try { return NextResponse.json({ success: true, experiment: await experimentStatus(co.value, String(sp.get("id") ?? ""), t) }) } catch (err) {
    if (err instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err, t)
  }
}
