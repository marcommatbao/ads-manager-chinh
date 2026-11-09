// GET /api/google/pmax/signals?company= — Đợt 10c: D2 ngưỡng học + C2 khách mới + C1 mốc thay đổi (chỉ đọc).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { listMarks, listNewCustomerChanges, MODE_LABEL, modeLabelT, readLearning, readNewCustomer } from "@/lib/pmax/signals"
import { PMAX_CONFIRM_TEXT } from "@/lib/pmax/controls"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"), t)
  if (!co.ok) return co.response
  try {
    const [learning, newCustomer] = await Promise.all([readLearning(co.value, t), readNewCustomer(co.value, t)])
    return NextResponse.json({ success: true, learning, newCustomer, modeLabels: Object.fromEntries(Object.keys(MODE_LABEL).map((k) => [k, modeLabelT(k, t)])), newCustomerHistory: listNewCustomerChanges(co.value), marks: listMarks(co.value), canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT })
  } catch (err) { return fail(err, t) }
}
