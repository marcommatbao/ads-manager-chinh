// PUT /api/google/pmax/controls/auto {company, kinds[]} — bật/tắt tự động theo loại việc (can_edit + quyền công ty).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, requireCompany, requireUser } from "@/lib/case/http"
import { readAutoSettings, saveAutoSettings, validAutoKinds } from "@/lib/pmax/auto"

export const dynamic = "force-dynamic"

export async function PUT(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; kinds?: unknown }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  const s = readAutoSettings()
  s.companies[co.value] = validAutoKinds(b.kinds)
  s.updatedBy = actorOf(u.value); s.updatedAt = new Date().toISOString()
  saveAutoSettings(s)
  return NextResponse.json({ success: true, kinds: s.companies[co.value] })
}
