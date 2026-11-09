// GET  /api/inbox — hộp "Việc nên làm hôm nay" (Đợt 15a): ảnh chụp lần dựng gần nhất + trạng thái, lọc theo công ty được phép.
// POST /api/inbox — { key, status: new|seen|snoozed|done|dismissed, until?, reason? } đổi trạng thái một việc (bỏ qua bắt buộc lý do).
// Không ghi gì lên tài khoản quảng cáo.
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireUser } from "@/lib/case/http"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { readSnapshot, readStates, setItemStatus, validateStatusInput, viewItems } from "@/lib/inbox/store"
import { isTeamsAlertConfigured } from "@/lib/teams-alert"
import { getT } from "@/lib/i18n/server"
import { localizeItem } from "@/lib/inbox/localize"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  try {
    const t = await getT()
    const snap = readSnapshot()
    if (!snap) return NextResponse.json({ success: true, builtAt: null, items: [], errors: [], digest: null, adsChannel: !!(process.env.TEAMS_WEBHOOK_ADS ?? "").trim(), canEdit: hasPermission(u.value.role, "can_edit") })
    const ok = (co: string) => co === "ALL" || canAccessCompany(u.value, co as string)
    return NextResponse.json({
      success: true, builtAt: snap.builtAt,
      items: viewItems(snap.items.filter((i) => ok(i.company)), readStates(), Date.now(), t).map((v) => localizeItem(v, t)),
      errors: snap.errors.filter((e) => ok(e.company)), digest: snap.digest ?? null,
      adsChannel: !!(process.env.TEAMS_WEBHOOK_ADS ?? "").trim(), opsChannel: isTeamsAlertConfigured(),
      canEdit: hasPermission(u.value.role, "can_edit"),
    })
  } catch (e) { return fail(e) }
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  try {
    const t = await getT()
    const input = validateStatusInput(await request.json().catch(() => null), t)
    if (typeof input === "string") return NextResponse.json({ success: false, error: input }, { status: 400 })
    const item = readSnapshot()?.items.find((i) => i.key === input.key)
    if (!item) return NextResponse.json({ success: false, error: t("libcase.w.err.itemNotFound") }, { status: 404 })
    if (!canAccessCompany(u.value, item.company)) return NextResponse.json({ success: false, error: t("libcase.w.err.noCompanyAccess") }, { status: 403 })
    return NextResponse.json({ success: true, state: setItemStatus(input, actorOf(u.value)) })
  } catch (e) { return fail(e) }
}
