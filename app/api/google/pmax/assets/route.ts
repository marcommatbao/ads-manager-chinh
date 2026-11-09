// Đợt 10d (A5 + E2) — sức khoẻ asset PMax + thay asset chữ yếu.
// GET  ?company=&from=&to=                                        — chấm từng asset group + lịch sử thay
// POST {company, op: "draft", groupId, links[], from?, to?}         — Gemini viết 3 phương án/dòng (đã kiểm độ dài + luật)
// POST {company, op: "apply", swaps: [{link, newText}], validateOnly, confirmText?}
// POST {company, op: "undo", id}
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { hasPermission } from "@/lib/permissions"
import { applySwaps, draftReplacements, FIELD_LABEL, fieldLabelT, listSwaps, readAssetHealth, TEXT_LIMIT, undoSwaps } from "@/lib/pmax/assets"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
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
  const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try {
    const h = await readAssetHealth(co.value, pr.range, t)
    return NextResponse.json({ success: true, range: pr.range, ...h, history: listSwaps(co.value), fieldLabels: Object.fromEntries(Object.keys(FIELD_LABEL).map((k) => [k, fieldLabelT(k, t)])), textLimits: TEXT_LIMIT, canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT })
  } catch (e) { return err(e, t) }
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; groupId?: string; links?: unknown; from?: string; to?: string; swaps?: unknown; validateOnly?: boolean; confirmText?: string; id?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try {
    if (b.op === "draft") {
      const pr = parseRange(b.from, b.to, { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
      if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
      const links = Array.isArray(b.links) ? b.links.filter((x): x is string => typeof x === "string").slice(0, 10) : []
      return NextResponse.json({ success: true, ...(await draftReplacements(co.value, String(b.groupId ?? ""), links, pr.range, t)) })
    }
    if (b.op === "apply") {
      const swaps = Array.isArray(b.swaps) ? b.swaps.filter((x): x is { link: string; newText: string } => !!x && typeof (x as { link?: unknown }).link === "string" && typeof (x as { newText?: unknown }).newText === "string").slice(0, 20) : []
      return NextResponse.json({ success: true, validated: b.validateOnly !== false, execution: await applySwaps({ company: co.value, swaps, actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText }, t) })
    }
    if (b.op === "undo") return NextResponse.json({ success: true, execution: await undoSwaps(co.value, String(b.id ?? ""), actorOf(u.value), t) })
    return NextResponse.json({ success: false, error: t("libgoogle.rt.badOp") }, { status: 400 })
  } catch (e) { return err(e, t) }
}
