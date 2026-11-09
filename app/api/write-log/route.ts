// Đợt 11d — nhật ký các lần ghi qua lớp an toàn + hoàn tác một chạm.
// GET  ?company=&source=   — 100 lần ghi gần nhất
// POST {company, id}       — hoàn tác (một lệnh nguyên khối; hỏng thì không đổi gì)
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { listWrites, undoWrite, WriteGuardError } from "@/lib/write-guard"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  return NextResponse.json({ success: true, writes: listWrites(co.value, sp.get("source") ?? undefined).map(({ inverse, ...w }) => ({ ...w, canUndo: inverse.length > 0 && !w.undoneAt && w.status === "done" })), canEdit: hasPermission(u.value.role, "can_edit") })
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; id?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  try { const { inverse: _i, ...w } = await undoWrite(co.value, String(b.id ?? ""), actorOf(u.value)); void _i; return NextResponse.json({ success: true, write: w }) } catch (e) {
    if (e instanceof WriteGuardError) return NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status })
    return fail(e)
  }
}
