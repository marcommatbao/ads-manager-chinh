// POST /api/cases/[id]/execute {idempotencyKey, validateOnly?}
// validateOnly=true: nhờ Google kiểm hợp lệ, KHÔNG ghi (nút "Kiểm trước").
// Ghi thật: đọc trước → validate → ghi → đọc lại so từng dòng. Cần can_edit.
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { actorOf, fail, requireCase } from "@/lib/case/http"
import { executeCase } from "@/lib/case/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t)
  if (!g.ok) return g.response
  const b = (await request.json().catch(() => ({}))) as { idempotencyKey?: string; validateOnly?: boolean }
  if (!b.idempotencyKey || !/^[\w-]{8,80}$/.test(b.idempotencyKey)) {
    return NextResponse.json({ success: false, error: t("libcase.s.api.idemKey") }, { status: 400 })
  }
  try {
    const r = await executeCase(g.value.c.id, { actor: actorOf(g.value.user), idempotencyKey: b.idempotencyKey, validateOnly: !!b.validateOnly }, t)
    // success = yêu cầu đã được xử lý. Kết quả ghi (done/failed + lỗi + bảng đọc lại)
    // nằm trong execution — trả success:false ở đây từng làm giao diện mất hết chi tiết lỗi.
    return NextResponse.json({ success: true, ...r, case: localizeCase(r.case, t) })
  } catch (err) {
    return fail(err, t)
  }
}
