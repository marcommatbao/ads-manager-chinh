// Đợt 15c — Báo cáo quản lý tuần.
// GET  ?week=YYYY-MM-DD   — một tuần đã lưu (mặc định tuần mới nhất) + danh sách tuần
// POST {op: "rebuild"}    — dựng lại tuần trọn gần nhất, CHỈ lưu (không gửi Teams)
// Báo cáo gộp MBC + MBI → cần quyền với cả hai công ty.
import { companyIds } from "@/lib/companies/registry"
import { NextRequest, NextResponse } from "next/server"
import { fail, requireUser } from "@/lib/case/http"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { getT } from "@/lib/i18n/server"
import { localizeWeeklyReport, readWeeklyHistory, runWeeklyReport } from "@/lib/reports/weekly"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Đợt 21 A5: "đủ quyền" = mọi công ty của bản cài (bản Mắt Bão: MBC + MBI như cũ)
const bothCompanies = (role: Parameters<typeof canAccessCompany>[0]) => companyIds().every((c) => canAccessCompany(role, c))
const noAccess = async () => NextResponse.json({ success: false, error: (await getT())("libcase.r.wkApi.noAccess") }, { status: 403 })

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  if (!bothCompanies(u.value)) return await noAccess()
  const t = await getT()
  try {
    const all = readWeeklyHistory()
    const weeks = Object.keys(all).sort().reverse()
    const want = request.nextUrl.searchParams.get("week")
    const key = want && all[want] ? want : weeks[0]
    return NextResponse.json({ success: true, weeks: weeks.map((k) => ({ key: k, label: localizeWeeklyReport(all[k], t).label })), report: key ? localizeWeeklyReport(all[key], t) : null, canEdit: hasPermission(u.value.role, "can_edit") })
  } catch (e) { return fail(e) }
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  if (!bothCompanies(u.value)) return await noAccess()
  const b = (await request.json().catch(() => ({}))) as { op?: string }
  if (b.op !== "rebuild") return NextResponse.json({ success: false, error: (await getT())("libcase.r.wkApi.badOp") }, { status: 400 })
  try {
    const rb = await runWeeklyReport(new Date(), { send: false })
    return NextResponse.json({ success: true, report: localizeWeeklyReport(readWeeklyHistory()[rb.weekKey] ?? rb, await getT()) })
  } catch (e) { return fail(e) }
}
