// GET /api/overview/monitor — các lần giám sát đo lường gần nhất (Đợt 6 · A), lọc theo quyền công ty.
import { NextResponse } from "next/server"
import { requireUser } from "@/lib/case/http"
import { canAccessCompany, isSuperAdmin } from "@/lib/permissions"
import { getT } from "@/lib/i18n/server"
import { listRuns, localizedChanges, localizedTeams, monitorWebhook } from "@/lib/monitor/measure-monitor"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  const can = (c: string) => canAccessCompany(u.value, c)
  const t = await getT()
  const all = listRuns(20)
  const runs = all.slice(0, 7).map((r) => ({
    date: r.date, at: r.at, comparedTo: r.comparedTo, teams: localizedTeams(r.teams, t),
    changes: localizedChanges(r, all, t).filter((c) => can(c.company)),
  }))
  return NextResponse.json({ success: true, runs, teamsConfigured: !!monitorWebhook(), canRunNow: isSuperAdmin(u.value.role), jobId: "measure_monitor" })
}
