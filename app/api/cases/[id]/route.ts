// GET   /api/cases/[id]          — toàn bộ phiên
// PATCH /api/cases/[id] {step}   — chuyển bước (chỉ lùi, hoặc tiến tới bước đã có dữ liệu)
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { fail, requireCase } from "@/lib/case/http"
import { setStep } from "@/lib/case/service"
import type { CampaignCase } from "@/lib/case/store"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, undefined, t)
  if (!g.ok) return g.response
  return NextResponse.json({ success: true, case: localizeCase(g.value.c, t) })
}

/** Bước muốn tới phải đã có dữ liệu cần cho nó. */
function reachable(c: CampaignCase, step: number): boolean {
  if (step <= 3) return true
  if (step <= 5) return !!c.diagnosis
  if (step === 6) return c.actions.length > 0
  return c.executions.length > 0
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, undefined, t)
  if (!g.ok) return g.response
  const { step } = (await request.json().catch(() => ({}))) as { step?: number }
  if (!step || step < 1 || step > 7 || !Number.isInteger(step)) {
    return NextResponse.json({ success: false, error: t("libcase.s.api.stepRange") }, { status: 400 })
  }
  if (!reachable(g.value.c, step)) {
    return NextResponse.json({ success: false, error: t("libcase.s.api.stepUnreachable") }, { status: 409 })
  }
  try {
    return NextResponse.json({ success: true, case: localizeCase(await setStep(g.value.c.id, step as CampaignCase["step"]), t) })
  } catch (err) {
    return fail(err, t)
  }
}
