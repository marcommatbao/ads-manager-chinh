// /api/meta/winning-audiences — Đợt 26c: kho tệp thắng.
//   GET    ?company=          danh sách (theo công ty được xem)
//   POST   {company, campaignIds, from, to, adsetId, name, note}   lưu — máy chủ TỰ SO LẠI từ Meta (không tin số client gửi)
//   DELETE ?id=               xoá (cần quyền sửa)
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { canAccessCompany } from "@/lib/permissions"
import { parseRange } from "@/lib/case/dates"
import { compareAudiences } from "@/lib/meta/audience-compare-fetch"
import { targetingSummary } from "@/lib/meta/winning-audiences-text"
import { getT } from "@/lib/i18n/server"
import { buildWinning, deleteWinning, getWinning, listWinning, saveWinning } from "@/lib/meta/winning-audiences"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  const t = await getT()
  // Bản tóm tắt nhắm chọn được lưu bằng tiếng Việt lúc lưu → dựng lại theo ngôn ngữ đang xem từ chính cấu hình nhắm chọn đã lưu.
  return NextResponse.json({ success: true, rows: listWinning(co.value).map((w) => ({ ...w, summary: targetingSummary(w.targeting, t) })) })
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; campaignIds?: string[]; from?: string; to?: string; adsetId?: string; name?: string; note?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const pr = parseRange(b.from, b.to, { defaultDays: 30 }) // tối đa 90 ngày, không quá hôm nay (soát 07/10)
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try {
    const res = await compareAudiences(co.value, Array.isArray(b.campaignIds) ? b.campaignIds.map(String) : [], { from: b.from!, to: b.to! })
    const group = res.groups.find((g) => g.rows.some((r) => r.id === b.adsetId))
    const row = group?.rows.find((r) => r.id === b.adsetId)
    if (!group || !row) return NextResponse.json({ success: false, error: "Nhóm quảng cáo không có trong lần so sánh này" }, { status: 400 })
    if (row.results <= 0) return NextResponse.json({ success: false, error: "Nhóm này chưa có kết quả nào — không lưu làm tệp thắng" }, { status: 400 })
    const w = buildWinning({ name: String(b.name ?? ""), note: String(b.note ?? ""), company: co.value, range: res.range, group, row, actor: actorOf(u.value) })
    await saveWinning(w)
    return NextResponse.json({ success: true, row: w })
  } catch (e) { return fail(e) }
}

export async function DELETE(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const w = getWinning(request.nextUrl.searchParams.get("id") ?? "")
  if (!w) return NextResponse.json({ success: false, error: "Không tìm thấy tệp" }, { status: 404 })
  if (!canAccessCompany(u.value, w.company)) return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 })
  await deleteWinning(w.id)
  return NextResponse.json({ success: true })
}
