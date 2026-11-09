// POST /api/google/pmax/signals/new-customer {company, campaignId, mode, validateOnly, confirmText?} — đổi chế độ khách mới.
// POST ... {company, undoId} — hoàn tác một lần đổi (trả chế độ cũ).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { setNewCustomerMode, undoNewCustomerMode } from "@/lib/pmax/signals"
import { PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; campaignId?: string; mode?: string; validateOnly?: boolean; confirmText?: string; undoId?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try {
    if (b.undoId) return NextResponse.json({ success: true, change: await undoNewCustomerMode(co.value, String(b.undoId), actorOf(u.value), t) })
    if (!/^\d+$/.test(String(b.campaignId ?? ""))) return NextResponse.json({ success: false, error: t("libgoogle.rt.noCampaign") }, { status: 400 })
    const change = await setNewCustomerMode({ company: co.value, campaignId: String(b.campaignId), mode: String(b.mode ?? ""), actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText }, t)
    return NextResponse.json({ success: true, validated: b.validateOnly !== false, change })
  } catch (err) {
    if (err instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err, t)
  }
}
