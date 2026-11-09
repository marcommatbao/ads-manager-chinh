// GET /api/playbook/outcomes?company=MBI|MBC — 7c: chiến dịch đã dùng kinh nghiệm + kết quả chấm 14/28 ngày. CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { addDays, vnDate } from "@/lib/case/dates"
import { isSuperAdmin } from "@/lib/permissions"
import { readOutcomes, usageKeyOf, CHECKPOINTS } from "@/lib/playbook/outcomes"
import { readUsage } from "@/lib/playbook/usage"
import { readPlaybook } from "@/lib/playbook/store"
import { getT } from "@/lib/i18n/server"
import { localizeEntryLabel, localizeOutcomeWhy, localizeProduct } from "@/lib/playbook/localize"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  const t = await getT()
  const records = readOutcomes().filter((r) => r.company === co.value)
  const labels = new Map(readPlaybook(co.value).entries.map((e) => [e.id, localizeEntryLabel(e.label, t)]))
  const today = vnDate()
  const usages = readUsage().filter((x) => x.company === co.value).reverse().slice(0, 100).map((x) => {
    const key = usageKeyOf(x), start = vnDate(new Date(x.at))
    return {
      key, at: x.at, by: x.by, platform: x.platform, productKey: x.productKey, campaignId: x.campaignId, campaignName: x.campaignName,
      entries: x.entryIds.map((id) => ({ id, label: labels.get(id) ?? t("libcase.w.pb.expired") })),
      overriddenAvoid: x.overriddenAvoidIds.map((id) => ({ id, label: labels.get(id) ?? t("libcase.w.pb.expired") })),
      checkpoints: CHECKPOINTS.map((cp) => {
        const due = addDays(start, cp)
        const r = records.find((y) => y.usageKey === key && y.checkpoint === cp)
        return { days: cp, due, status: r ? "done" : due <= today ? "pending_run" : "waiting", record: r ? { ...r, why: localizeOutcomeWhy(r.why, t), product: localizeProduct(r.product, t) } : null }
      }),
    }
  })
  return NextResponse.json({ success: true, usages, canRunNow: isSuperAdmin(u.value.role), jobId: "playbook_outcomes" })
}
