// Đợt 11c — RSA của Search.
// GET  ?company=&from=&to=                                                    — quảng cáo + số theo dòng + dòng yếu + lịch sử sửa
// POST {company, op: "draft", ad, lines: [{field, text}], from?, to?}           — Gemini 3 phương án/dòng (đã kiểm độ dài + luật)
// POST {company, op: "edit", ad, changes: [{field, oldText, newText}], validateOnly, confirmText?}
// POST {company, op: "undo", id}
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { hasPermission } from "@/lib/permissions"
import { draftRsa, editRsa, listRsaEdits, readRsa, undoRsa } from "@/lib/search/rsa"
import { SEARCH_CONFIRM_TEXT } from "@/lib/search/controls"
import { PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";
import type { TFunction } from "@/lib/i18n/translate"

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown, t: TFunction) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e, t))
type Line = { field: "HEADLINE" | "DESCRIPTION"; text: string }
const lines = (x: unknown): Line[] => (Array.isArray(x) ? x.filter((l): l is Line => !!l && (l.field === "HEADLINE" || l.field === "DESCRIPTION") && typeof l.text === "string").slice(0, 10) : [])

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try { return NextResponse.json({ success: true, range: pr.range, ...(await readRsa(co.value, pr.range, t)), history: listRsaEdits(co.value), canEdit: hasPermission(u.value.role, "can_edit"), confirmText: SEARCH_CONFIRM_TEXT }) } catch (e) { return err(e, t) }
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try {
    if (b.op === "draft") {
      const pr = parseRange(b.from, b.to, { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
      if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
      return NextResponse.json({ success: true, ...(await draftRsa(co.value, String(b.ad ?? ""), lines(b.lines), pr.range, t)) })
    }
    if (b.op === "edit") {
      const changes = Array.isArray(b.changes) ? b.changes.filter((c): c is { field: string; oldText: string; newText: string } => !!c && typeof c.oldText === "string" && typeof c.newText === "string" && (c.field === "HEADLINE" || c.field === "DESCRIPTION")).slice(0, 10) : []
      return NextResponse.json({ success: true, validated: b.validateOnly !== false, edit: await editRsa({ company: co.value, ad: String(b.ad ?? ""), changes, actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: typeof b.confirmText === "string" ? b.confirmText : undefined }, t) })
    }
    if (b.op === "undo") return NextResponse.json({ success: true, edit: await undoRsa(co.value, String(b.id ?? ""), t) })
    return NextResponse.json({ success: false, error: t("libgoogle.rt.badOp") }, { status: 400 })
  } catch (e) { return err(e, t) }
}
