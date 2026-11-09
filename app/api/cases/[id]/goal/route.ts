// POST /api/cases/[id]/goal {basis, target, ceiling, where, saveAsDefault?}
// Chốt mục tiêu → tính nguyên nhân + hướng xử lý (có mô phỏng). Lưu làm mặc định
// cho sản phẩm cần quyền can_edit_thresholds.
// Đợt 23 (3d): phiên chiến dịch thu lead chốt theo basis "cpl"; lưu mặc định ghi vào CPL mục tiêu/trần của dòng sản phẩm
// (giữ nguyên mục tiêu bán hàng của dòng đó).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { actorOf, fail, requireCase } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { productGroupOf } from "@/lib/case/product"
import { confirmGoal } from "@/lib/case/service"
import { listTargets, saveTargets, validateTarget } from "@/lib/case/targets"
import { evidenceGoalKind } from "@/lib/case/goal-kind"
import type { CaseBasis } from "@/lib/case/verdict"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await getT()
  const g = await requireCase((await params).id, "can_edit", t) // soát 07/10: chốt mục tiêu đổi kết luận của phiên — người chỉ xem không được
  if (!g.ok) return g.response
  const { user, c } = g.value
  const b = (await request.json().catch(() => ({}))) as { basis?: string; target?: number; ceiling?: number; where?: string; saveAsDefault?: boolean }
  const group = productGroupOf(c.campaignName)
  const leads = evidenceGoalKind(c.evidence) === "leads"
  const err = leads
    ? b.basis !== "cpl" ? t("libcase.s.svc.err.leadBasis")
      : validateTarget({ company: c.company, group, basis: "cpa", target: 0, ceiling: 0, cplTarget: b.target, cplCeiling: b.ceiling })
    : validateTarget({ company: c.company, group, basis: b.basis as "cpa" | "roas", target: b.target, ceiling: b.ceiling })
  if (err) return NextResponse.json({ success: false, error: err }, { status: 400 })
  if (b.saveAsDefault && !hasPermission(user.role, "can_edit_thresholds")) {
    return NextResponse.json({ success: false, error: t("libcase.s.api.goalPerm") }, { status: 403 })
  }
  try {
    const goal = { basis: b.basis as CaseBasis, target: Number(b.target), ceiling: Number(b.ceiling), where: String(b.where ?? "").slice(0, 300) }
    if (b.saveAsDefault) {
      if (leads) {
        const cur = listTargets().find((r) => r.company === c.company && r.group === group)
        const { updatedBy: _u, updatedAt: _a, ...keep } = cur ?? { company: c.company, group, basis: "cpa" as const, target: 0, ceiling: 0, updatedBy: "", updatedAt: "" } // eslint-disable-line @typescript-eslint/no-unused-vars
        await saveTargets([{ ...keep, cplTarget: goal.target, cplCeiling: goal.ceiling }], actorOf(user))
      } else {
        const cur = listTargets().find((r) => r.company === c.company && r.group === group)
        // Giữ CPL đã nhập của dòng (trước đây lưu mặc định bán hàng ghi đè cả dòng).
        await saveTargets([{ company: c.company, group, basis: goal.basis as "cpa" | "roas", target: goal.target, ceiling: goal.ceiling, cplTarget: cur?.cplTarget ?? null, cplCeiling: cur?.cplCeiling ?? null }], actorOf(user))
      }
    }
    return NextResponse.json({ success: true, case: localizeCase(await confirmGoal(c.id, goal, actorOf(user), t), t) })
  } catch (e) {
    return fail(e, t)
  }
}
