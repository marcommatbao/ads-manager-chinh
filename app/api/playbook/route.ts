// GET /api/playbook?company=MBI|MBC — Sổ kinh nghiệm (Đợt 7 · 7a), CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission, isSuperAdmin } from "@/lib/permissions"
import { readPlaybook } from "@/lib/playbook/store"
import { withOutcomes } from "@/lib/playbook/outcomes"
import { loadHalves, CHUNKS_NEEDED } from "@/lib/playbook/meta-chunks"
import { vnDate } from "@/lib/case/dates"
import { getT } from "@/lib/i18n/server"
import { localizeEntry, localizePlaybookNote } from "@/lib/playbook/localize"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  const t = await getT()
  const p = withOutcomes(readPlaybook(co.value))
  return NextResponse.json({
    success: true, ...p, entries: p.entries.map((e) => localizeEntry(e, t)), notes: p.notes.map((n) => localizePlaybookNote(n, t)),
    metaCoverage: { have: loadHalves(vnDate()).have, need: CHUNKS_NEEDED },
    canDecide: hasPermission(u.value.role, "can_edit_thresholds"), canRunNow: isSuperAdmin(u.value.role),
  })
}
