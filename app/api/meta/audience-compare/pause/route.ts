// POST /api/meta/audience-compare/pause { company, ids:[campaignId…], from, to, adsetId } — Đợt 26d.
// Tạm dừng MỘT nhóm "kém rõ rệt" từ trang So sánh tệp. Cần quyền sửa. Máy chủ chấm lại + đọc trạng thái thật trước khi ghi
// (lib/meta/adset-pause.ts); ghi nhật ký cấp nhóm → Hoàn tác được ở "Đã làm & kết quả".
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { parseRange } from "@/lib/case/dates"
import { compareAudiences, forgetCompare } from "@/lib/meta/audience-compare-fetch"
import { checkPausable, pauseClearlyWorse, PauseRefused } from "@/lib/meta/adset-pause"
import { friendlyError } from "@/lib/not-configured"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Hai lần bấm cùng lúc cùng một nhóm → lần sau bị chặn (không ghi đôi nhật ký). */
const inFlight = new Set<string>()

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: unknown; ids?: unknown; from?: unknown; to?: unknown; adsetId?: unknown }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const pr = parseRange(typeof b.from === "string" ? b.from : null, typeof b.to === "string" ? b.to : null, { defaultDays: 30 })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  const ids = Array.isArray(b.ids) ? b.ids.map(String) : []
  const adsetId = String(b.adsetId ?? "")
  if (!/^\d{5,25}$/.test(adsetId)) return NextResponse.json({ success: false, error: "Mã nhóm quảng cáo không hợp lệ" }, { status: 400 })
  if (inFlight.has(adsetId)) return NextResponse.json({ success: false, error: "Đang tạm dừng nhóm này — chờ lần bấm trước xong" }, { status: 409 })
  inFlight.add(adsetId)
  try {
    const result = await compareAudiences(co.value, ids, pr.range)
    const chk = checkPausable(result, adsetId)
    if (!chk.ok) return NextResponse.json({ success: false, error: chk.reason }, { status: 409 })
    const out = await pauseClearlyWorse(chk.row, co.value, actorOf(u.value))
    forgetCompare(co.value) // số trên trang phải đọc lại (trạng thái đã đổi)
    return NextResponse.json({ success: true, ...out, ok: out.after === "PAUSED" })
  } catch (e) {
    if (e instanceof PauseRefused) return NextResponse.json({ success: false, error: e.message }, { status: 409 })
    const msg = e instanceof Error ? e.message : String(e)
    if (/^Chọn 2–|không thuộc công ty/.test(msg)) return NextResponse.json({ success: false, error: msg }, { status: 400 })
    if (/Application request limit|User request limit|#17|#4\b/.test(msg)) return NextResponse.json({ success: false, error: "Meta đang giới hạn số lượt gọi của app — thử lại sau ít phút." }, { status: 429 })
    return fail(e instanceof Error ? new Error(friendlyError(msg)) : e)
  } finally {
    inFlight.delete(adsetId)
  }
}
