// C1 — mốc thay đổi cài đặt ghi nhận (vd hạ cửa sổ engaged-view trong Google Ads) + so trước/sau.
// GET    ?company=&id=           — so N ngày trước / sau mốc
// POST   {company, date, label}  — thêm mốc
// DELETE ?company=&id=           — xoá mốc
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { addMark, beforeAfter, removeMark } from "@/lib/pmax/signals"
import { PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown, t: TFunction) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e, t))

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  try { return NextResponse.json({ success: true, result: await beforeAfter(co.value, String(sp.get("id") ?? ""), t) }) } catch (e) { return err(e, t) }
}
export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; date?: string; label?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try { return NextResponse.json({ success: true, mark: await addMark(co.value, String(b.date ?? ""), String(b.label ?? ""), actorOf(u.value), t) }) } catch (e) { return err(e, t) }
}
export async function DELETE(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  try { await removeMark(co.value, String(sp.get("id") ?? "")); return NextResponse.json({ success: true }) } catch (e) { return err(e, t) }
}
