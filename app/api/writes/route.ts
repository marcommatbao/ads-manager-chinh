// GET /api/writes?days=30 — "Đã làm & kết quả" (Đợt 15b): mọi lần tool ghi lên tài khoản + kết quả đo lại 7/14 ngày.
// Đọc luồng ĐÃ LƯU + nhật ký hiện tại (không gọi Google/Meta). Phiên xử lý lấy kết quả đo lại của chính phiên.
import { NextRequest, NextResponse } from "next/server"
import { fail, requireUser } from "@/lib/case/http"
import { canAccessCompany } from "@/lib/permissions"
import { collectWrites } from "@/lib/writes/feed"
import { readOutcomes, outcomeKey, skipReason } from "@/lib/writes/job"
import { WINDOWS, windowRanges } from "@/lib/writes/outcome"
import { readCase } from "@/lib/case/store"
import { vnDate } from "@/lib/case/dates"
import { getT } from "@/lib/i18n/server"
import { localizeEvent, localizeOutcomeNote } from "@/lib/writes/localize"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  try {
    const t = await getT()
    const days = Math.min(400, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30))
    const since = Date.now() - days * 86_400_000
    const { events, errors } = await collectWrites(new Date(), { persist: false })
    const outcomes = readOutcomes(), today = vnDate()
    const rows = events.filter((e) => canAccessCompany(u.value, e.company) && Date.parse(e.at) >= since).map((e) => ({
      ...localizeEvent(e, t),
      windows: WINDOWS.map((d) => {
        const w = windowRanges(e.at, d)
        const o = outcomes[outcomeKey(e.id, d)]
        if (o) return { days: d, state: "done" as const, dueOn: w.dueOn, result: { ...o, note: localizeOutcomeNote(o.note, t) } }
        if (e.ownOutcome === "case") {
          const c = readCase(e.id.split(":")[1])
          const r = c?.remeasure[d === 7 ? 0 : 1]
          if (r?.status === "done") return { days: d, state: "case" as const, dueOn: r.due, result: r.result ?? null }
        }
        const why = w.dueOn <= today ? skipReason(e, d, t) : null
        return { days: d, state: w.dueOn <= today ? (why ? "skip" as const : "pending_job" as const) : "not_due" as const, dueOn: w.dueOn, note: why }
      }),
    }))
    return NextResponse.json({ success: true, days, rows, errors })
  } catch (e) { return fail(e) }
}
