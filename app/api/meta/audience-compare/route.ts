// GET /api/meta/audience-compare?company=&ids=a,b,c&from=&to=&force=1 — Đợt 26a: so sánh tệp đối tượng giữa 2–3 chiến dịch Meta.
// CHỈ ĐỌC Meta. Công ty kiểm theo tên chiến dịch phía Meta (lib/meta/audience-compare-fetch.ts).
import { NextRequest, NextResponse } from "next/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { parseRange } from "@/lib/case/dates"
import { allowForce } from "@/lib/cost-guard"
import { hasPermission } from "@/lib/permissions"
import { compareAudiences, CompareInputError } from "@/lib/meta/audience-compare-fetch"
import { getT } from "@/lib/i18n/server"
import { friendlyError } from "@/lib/not-configured"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const q = request.nextUrl.searchParams
  const co = requireCompany(u.value, q.get("company"))
  if (!co.ok) return co.response
  const pr = parseRange(q.get("from"), q.get("to"), { defaultDays: 30 }) // tối đa 90 ngày, không quá hôm nay (soát 07/10)
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  const { from, to } = pr.range
  const t = await getT()
  const ids = (q.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  try {
    return NextResponse.json({ success: true, ...(await compareAudiences(co.value, ids, { from, to }, { force: q.get("force") === "1" && allowForce(`compare|${co.value}|${ids.slice().sort().join(",")}|${from}|${to}`, hasPermission(u.value.role, "can_edit")) }, t)) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof CompareInputError || /^Chọn 2–|không thuộc công ty/.test(msg)) return NextResponse.json({ success: false, error: msg }, { status: 400 })
    if (/Application request limit|User request limit|#17|#4\b/.test(msg)) return NextResponse.json({ success: false, error: t("libmeta.api.metaRateLimit") }, { status: 429 })
    return fail(e instanceof Error ? new Error(friendlyError(msg)) : e)
  }
}
