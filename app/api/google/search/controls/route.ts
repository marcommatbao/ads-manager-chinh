// Đợt 11b — Việc nên làm cho Search.
// GET  ?company=&from=&to=                                  — việc nên làm + đề xuất + lịch sử
// POST {company, from, to, ids[], validateOnly, confirmText?} — Kiểm trước / áp dụng (đề xuất TÍNH LẠI ở máy chủ)
// POST {company, op: "undo", id}
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { hasPermission } from "@/lib/permissions"
import { lexiconFor } from "@/lib/case/targets"
import { searchXray } from "@/lib/search/xray"
import { listSearchExecutions, proposeSearch, readSearchNegatives, runSearchControls, SEARCH_CONFIRM_TEXT, undoSearchControls } from "@/lib/search/controls"
import { activeSplitsBySource, recommendSearch } from "@/lib/search/recommend"
import { allSplits, splitTargets } from "@/lib/search/split"
import { PmaxControlError } from "@/lib/pmax/controls"
import type { Company } from "@/lib/case/types"
import { friendlyError } from "@/lib/not-configured";
import type { TFunction } from "@/lib/i18n/translate"

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown, t: TFunction) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e, t))

async function build(company: Company, range: { from: string; to: string }, t: TFunction) {
  const [x, negs] = await Promise.all([searchXray(company, range, {}, t), readSearchNegatives(company)])
  const splits = activeSplitsBySource(allSplits().filter((r) => r.company === company), new Date(), t)
  const proposals = proposeSearch(x, negs, lexiconFor(company), new Set(splits.keys()), splits.size ? await splitTargets(company) : new Map(), t)
  return { x, proposals, recommendations: recommendSearch(x, proposals, splits, t) }
}

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
    const { proposals, recommendations } = await build(co.value, pr.range, t)
    return NextResponse.json({ success: true, range: pr.range, recommendations, proposals, history: listSearchExecutions(co.value), canEdit: hasPermission(u.value.role, "can_edit"), confirmText: SEARCH_CONFIRM_TEXT })
  } catch (e) { return err(e, t) }
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; id?: string; from?: string; to?: string; ids?: unknown; validateOnly?: boolean; confirmText?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  try {
    if (b.op === "undo" && b.confirmText?.trim() !== SEARCH_CONFIRM_TEXT) return NextResponse.json({ success: false, error: t("libgoogle.rt.undoConfirm", { text: SEARCH_CONFIRM_TEXT }) }, { status: 428 })
    if (b.op === "undo") return NextResponse.json({ success: true, execution: await undoSearchControls(co.value, String(b.id ?? ""), actorOf(u.value), t) })
    const pr = parseRange(b.from, b.to, { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
    if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 300) : []
    const { proposals } = await build(co.value, pr.range, t)
    return NextResponse.json({ success: true, execution: await runSearchControls({ company: co.value, proposals, ids, actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText }, t) })
  } catch (e) { return err(e, t) }
}
