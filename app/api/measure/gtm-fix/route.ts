// POST /api/measure/gtm-fix {company, fixIds[], validateOnly, confirmText?}
// C2 — sửa thẻ GTM qua API (user chốt 28/09). Cần can_edit + quyền công ty.
// validateOnly=true: workspace tạm, biên dịch thử rồi XOÁ — không publish. Publish thật cần "XAC NHAN".
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { tagDoctor } from "@/lib/measure/tag-doctor"
import { GtmFixError, runGtmFix } from "@/lib/measure/gtm-fix"
import { friendlyError } from "@/lib/not-configured";
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; fixIds?: unknown; validateOnly?: boolean; confirmText?: string; acknowledgeSignalLoss?: boolean }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const fixIds = Array.isArray(b.fixIds) ? b.fixIds.filter((x): x is string => typeof x === "string").slice(0, 20) : []
  const t = await getT()
  try {
    const report = await tagDoctor(co.value, {}, t)
    const exec = await runGtmFix({ company: co.value, report, fixIds, actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText, acknowledgeSignalLoss: !!b.acknowledgeSignalLoss }, t)
    if (exec.mode === "write") await tagDoctor(co.value, { force: true }, t).catch(() => null)
    return NextResponse.json({ success: true, execution: exec })
  } catch (err) {
    if (err instanceof GtmFixError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err)
  }
}
