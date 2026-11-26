// GET  /api/inbox — hộp "Việc nên làm hôm nay" (Đợt 15a): ảnh chụp lần dựng gần nhất + trạng thái, lọc theo công ty được phép.
// POST /api/inbox — { key, status: new|seen|snoozed|done|dismissed, until?, reason?, expectedRevision } đổi trạng thái một việc (bỏ qua bắt buộc lý do).
// Không ghi gì lên tài khoản quảng cáo.
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireUser } from "@/lib/case/http"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { InboxStatusError, readSnapshot, readStates, setItemStatus, validateStatusInput, viewItems } from "@/lib/inbox/store"
import { isTeamsAlertConfigured } from "@/lib/teams-alert"
import { getT } from "@/lib/i18n/server"
import { companyIds } from "@/lib/companies"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import { fromGoogleHealth, fromSourceErrors } from "@/lib/inbox/evidence"
import { rankItems } from "@/lib/inbox/build"
import { localizeItem } from "@/lib/inbox/localize"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  try {
    const t = await getT()
    const companies = companyIds().filter(co => canAccessCompany(u.value, co))
    if (!companies.length) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
    const snap = readSnapshot()
    const now = Date.now()
    // Scope is authorized before any health/source read. Re-evaluate current
    // binding server-side; never replay a persisted healthy claim.
    const connectionItems = fromGoogleHealth(companies, snapshotAllConnectors().google_ads, now)
    if (!snap) return NextResponse.json({ success: true, builtAt: null, items: viewItems(connectionItems, readStates(), now, t).map(v => localizeItem(v, t)), errors: [], digest: null, adsChannel: !!(process.env.TEAMS_WEBHOOK_ADS ?? "").trim(), canEdit: hasPermission(u.value.role, "can_edit") })
    const ok = (co: string) => companies.includes(co)
    const scopedErrors = snap.errors.filter(e => e.company === "ALL" || ok(e.company))
    const items = rankItems([
      ...snap.items.filter(i => ok(i.company) && !i.evidence),
      ...connectionItems, ...fromSourceErrors(companies, scopedErrors),
    ])
    return NextResponse.json({
      success: true, builtAt: snap.builtAt,
      items: viewItems(items, readStates(), now, t).map((v) => localizeItem(v, t)),
      errors: scopedErrors.flatMap(e => (e.company === "ALL" ? companies : [e.company]).map(company => ({ company, source: e.source, error: t("overview.inboxQuality.source_error") }))),
      digest: snap.digest ? { sentAt: snap.digest.sentAt, sent: snap.digest.sent, notConfigured: snap.digest.notConfigured, keys: snap.digest.keys.filter(key => items.some(i => i.key === key)) } : null,
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
    const state = await setItemStatus(input, actorOf(u.value), company => canAccessCompany(u.value, company))
    return NextResponse.json({ success: true, state })
  } catch (e) {
    if (e instanceof InboxStatusError) {
      const t = await getT()
      const error = e.code === "revisionConflict" ? t("overview.today.revisionConflict")
        : e.code === "qualityReadOnly" ? t("overview.today.qualityReadOnly")
        : e.code === "noCompanyAccess" ? t("libcase.w.err.noCompanyAccess") : t("libcase.w.err.itemNotFound")
      return NextResponse.json({ success: false, error, code: e.code }, { status: e.status })
    }
    return fail(e)
  }
}
