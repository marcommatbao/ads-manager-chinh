// GET /api/google/pmax/xray?company=MBI|MBC&from=&to=&force=1 — Đợt 10a PMax X-quang (CHỈ ĐỌC).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { pmaxXray } from "@/lib/pmax/xray"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try {
    return NextResponse.json({ success: true, ...(await pmaxXray(co.value, pr.range, { force: sp.get("force") === "1" }, t)) })
  } catch (err) {
    return fail(err, t)
  }
}
