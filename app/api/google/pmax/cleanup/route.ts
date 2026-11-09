// Đợt 10d (D3) — PMax đã dừng lâu: gắn nhãn "AdsCommand · PMax cũ" (không xoá; gỡ nhãn = hoàn tác).
// GET  ?company=
// POST {company, op: "apply", ids[], validateOnly, confirmText?} | {company, op: "undo", id}
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { IDLE_DAYS, labelOld, listCleanups, readOldPmax, undoLabel } from "@/lib/pmax/cleanup"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60
const err = (e: unknown, t: TFunction) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e, t))

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"), t)
  if (!co.ok) return co.response
  try { return NextResponse.json({ success: true, ...(await readOldPmax(co.value, t)), idleDays: IDLE_DAYS, history: listCleanups(co.value), canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT }) } catch (e) { return err(e, t) }
}
export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; ids?: unknown; validateOnly?: boolean; confirmText?: string; id?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try {
    if (b.op === "apply") return NextResponse.json({ success: true, validated: b.validateOnly !== false, execution: await labelOld({ company: co.value, ids: Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)).slice(0, 100) : [], actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText }, t) })
    if (b.op === "undo") return NextResponse.json({ success: true, execution: await undoLabel(co.value, String(b.id ?? ""), t) })
    return NextResponse.json({ success: false, error: t("libgoogle.rt.badOp") }, { status: 400 })
  } catch (e) { return err(e, t) }
}
