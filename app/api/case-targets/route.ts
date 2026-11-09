// GET /api/case-targets        — mục tiêu/trần theo sản phẩm (ai đăng nhập cũng xem được)
// PUT /api/case-targets {rows} — lưu, cần can_edit_thresholds + quyền với công ty từng dòng
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { listTargets, saveTargets, validateTarget, type TargetRow } from "@/lib/case/targets"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  return NextResponse.json({ success: true, rows: listTargets() })
}

export async function PUT(request: NextRequest) {
  const u = await requireUser("can_edit_thresholds")
  if (!u.ok) return u.response
  const { rows } = (await request.json().catch(() => ({}))) as { rows?: Partial<TargetRow>[] }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    return NextResponse.json({ success: false, error: "rows phải là mảng 1–100 dòng" }, { status: 400 })
  }
  for (const r of rows) {
    const co = requireCompany(u.value, r.company)
    if (!co.ok) return co.response
    const err = validateTarget(r)
    if (err) return NextResponse.json({ success: false, error: `${r.company}/${r.group}: ${err}` }, { status: 400 })
  }
  try {
    await saveTargets(rows.map((r) => ({ company: r.company!, group: r.group!, basis: r.basis!, target: Number(r.target), ceiling: Number(r.ceiling), aov: r.aov ?? null, cplTarget: r.cplTarget ?? null, cplCeiling: r.cplCeiling ?? null })), actorOf(u.value))
    return NextResponse.json({ success: true, rows: listTargets() })
  } catch (err) {
    return fail(err)
  }
}
