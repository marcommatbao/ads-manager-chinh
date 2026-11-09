// GET /api/dashboard/trends/breakdown?company=&platform=all|meta|google&from=&to=&force=1 — Đợt 28d: tách theo đối tượng /
// vị trí cho tab "Diễn biến". CHỈ ĐỌC, chỉ gọi khi người dùng bấm "Xem tách" (đệm 30 phút).
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { parseRange } from "@/lib/case/dates"
import { allowForce } from "@/lib/cost-guard"
import { hasPermission } from "@/lib/permissions"
import { friendlyError } from "@/lib/not-configured"
import { googleBreakdown, metaBreakdown } from "@/lib/trends/breakdown-fetch"
import { localizeTable, type BTable } from "@/lib/trends/breakdown"
import { getT } from "@/lib/i18n/server"

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
  const platform = q.get("platform") === "meta" ? "meta" : q.get("platform") === "google" ? "google" : "all"
  const force = q.get("force") === "1" && allowForce(`breakdown|${co.value}|${platform}|${from}|${to}`, hasPermission(u.value.role, "can_edit"))
  const wanted: ("meta" | "google")[] = platform === "all" ? ["meta", "google"] : [platform]
  const tables: BTable[] = [], errors: { platform: string; error: string }[] = []
  for (const p of wanted) {
    try { tables.push(...(p === "meta" ? await metaBreakdown(co.value, { from, to }, force) : await googleBreakdown(co.value, { from, to }, force))) }
    catch (e) { errors.push({ platform: p, error: friendlyError(e instanceof Error ? e.message : String(e)) }) }
  }
  const t = await getT()
  return NextResponse.json({ success: true, tables: tables.map((x) => localizeTable(x, t)), errors })
}
