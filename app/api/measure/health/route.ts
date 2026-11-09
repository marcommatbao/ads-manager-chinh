// GET /api/measure/health?platform=facebook|google&company=MBI&force=1
// Sức khoẻ đo lường (Đợt 4 · A) — CHỈ ĐỌC. Đệm 30 phút; force=1 kéo lại.
import { NextRequest, NextResponse } from "next/server"
import { MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { metaHealth } from "@/lib/measure/meta-health"
import { googleHealth } from "@/lib/measure/google-health"
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  const platform = sp.get("platform") ?? "facebook"
  if (platform !== "facebook" && platform !== "google") {
    return NextResponse.json({ success: false, error: "platform phải là facebook hoặc google" }, { status: 400 })
  }
  const force = sp.get("force") === "1"
  // from/to tuỳ chọn (tối đa 90 ngày). Không truyền → khoảng mặc định cũ (28 ngày) — giao diện luôn gửi 30 ngày.
  let range: { from: string; to: string } | undefined
  if (sp.get("from") || sp.get("to")) {
    const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: 30, maxDays: MAX_RANGE_DAYS })
    if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
    range = pr.range
  }
  try {
    const data = platform === "facebook" ? await metaHealth(co.value, { force, range }, await getT()) : await googleHealth(co.value, { force, range })
    return NextResponse.json({ success: true, platform, ...data })
  } catch (err) {
    return fail(err)
  }
}
