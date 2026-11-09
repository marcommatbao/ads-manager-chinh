// POST /api/google/pmax/experiment/csv {company, csv} — tải đơn theo tỉnh "ngay,tinh,so_don" (không phụ thuộc ERP).
// Chỉ lưu ngày/tỉnh/số đơn — không có thông tin khách. Thay toàn bộ bản cũ của công ty đó.
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { parseKpiCsv, saveCsvKpi } from "@/lib/pmax/geo-experiment"

export const dynamic = "force-dynamic"
const MAX_BYTES = 2_000_000

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; csv?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  if (typeof b.csv !== "string" || !b.csv.trim()) return NextResponse.json({ success: false, error: t("libgoogle.rt.csvEmpty") }, { status: 400 })
  if (b.csv.length > MAX_BYTES) return NextResponse.json({ success: false, error: t("libgoogle.rt.csvBig") }, { status: 413 })
  try {
    const { rows, errors } = parseKpiCsv(b.csv)
    if (!rows.length) return NextResponse.json({ success: false, error: t("libgoogle.rt.csvNoRows"), errors }, { status: 400 })
    await saveCsvKpi(co.value, rows, actorOf(u.value))
    return NextResponse.json({ success: true, rows: rows.length, errors })
  } catch (err) { return fail(err, t) }
}
