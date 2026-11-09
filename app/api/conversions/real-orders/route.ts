// Đợt 16 — Đơn thật → Google & Meta.
// GET  ?company=                                                        — cài đặt, hàng đợi Meta, hàng Google (Đợt 10c)
// GET  ?company=&view=google                                           — 19b: sẵn sàng + so sánh đơn Google ↔ đơn thật 30 ngày
// GET  ?company=&view=meta                                             — 19c: sẵn sàng Meta + so sánh mua hàng Meta ↔ đơn thật 30 ngày
// POST {company, op: "meta_cc", validateOnly, confirmText?}             — 19c: tạo chuyển đổi tuỳ chỉnh từ sự kiện đơn thật
// POST {company, op: "preview"}                                         — CHỈ ĐỌC Odoo: bao nhiêu đơn, bao nhiêu có email/SĐT
// POST {company, op: "toggle", platform, enabled, confirmText?, testEventCode?} — bật (cần XAC NHAN) / tắt
// POST {company, op: "run"}                                             — chạy một lượt ngay (chỉ nền tảng đã bật)
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { PmaxControlError } from "@/lib/pmax/controls"
import { leadQualityStats, readActions } from "@/lib/leads/quality"
import { realOrderStatus, runRealOrderSync, setRealOrderToggle } from "@/lib/conversions/sync"
import { META_EVENT_NAME } from "@/lib/conversions/meta-capi"
import { addDays, vnDate } from "@/lib/case/dates"
import { friendlyError } from "@/lib/not-configured";
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e))

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  const t = await getT()
  try {
    if (request.nextUrl.searchParams.get("view") === "google") {
      const { googleCompare, googleReadiness } = await import("@/lib/conversions/google-compare")
      const st = realOrderStatus(co.value)
      const on = !!st.settings.google?.enabled
      const readiness = await googleReadiness(co.value, on, t)
      const to = addDays(vnDate(new Date()), -1), from = addDays(to, -29)
      const daysOn = on && st.settings.google?.at ? Math.floor((Date.now() - Date.parse(st.settings.google.at)) / 864e5) : null
      const uploaded = leadQualityStats(co.value).byStatus.uploaded
      const campaigns = readiness.action.resourceName || !on ? await googleCompare(co.value, { from, to }, { daysOn, uploaded, action: readiness.action.resourceName }, t) : []
      return NextResponse.json({ success: true, range: { from, to }, daysOn, readiness, campaigns })
    }
    if (request.nextUrl.searchParams.get("view") === "meta") {
      const { metaCompare, metaReadiness } = await import("@/lib/conversions/meta-compare")
      const to = addDays(vnDate(new Date()), -1), from = addDays(to, -29)
      const [readiness, campaigns] = await Promise.all([metaReadiness(co.value, t), metaCompare(co.value, { from, to }, t).catch((e: unknown) => ({ error: e instanceof Error ? e.message.slice(0, 200) : String(e) }))])
      return NextResponse.json({ success: true, range: { from, to }, readiness, campaigns: Array.isArray(campaigns) ? campaigns : [], compareError: Array.isArray(campaigns) ? null : campaigns.error })
    }
    const st = realOrderStatus(co.value)
    const actions = st.unsupported ? [] : await readActions(co.value).catch(() => [])
    return NextResponse.json({ success: true, ...st, metaEventName: META_EVENT_NAME, google: { actions, stats: leadQualityStats(co.value) }, canEdit: hasPermission(u.value.role, "can_edit") })
  } catch (e) { return err(e) }
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; platform?: string; enabled?: boolean; confirmText?: string; testEventCode?: string | null }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const t = await getT()
  try {
    if (b.op === "preview") return NextResponse.json({ success: true, result: await runRealOrderSync(co.value, { preview: true }, t) })
    if (b.op === "toggle") {
      if (b.platform !== "google" && b.platform !== "meta") return NextResponse.json({ success: false, error: t("libmeta.api.badPlatform") }, { status: 400 })
      const s = await setRealOrderToggle(co.value, { platform: b.platform, enabled: !!b.enabled, confirmText: b.confirmText, testEventCode: b.testEventCode, actor: actorOf(u.value) }, undefined, t)
      return NextResponse.json({ success: true, settings: s })
    }
    if (b.op === "meta_cc") {
      const { createRealOrderConversion } = await import("@/lib/conversions/meta-compare")
      const x = b as { validateOnly?: boolean }
      return NextResponse.json({ success: true, ...(await createRealOrderConversion(co.value, { validateOnly: x.validateOnly !== false, confirmText: b.confirmText }, t)) })
    }
    if (b.op === "run") return NextResponse.json({ success: true, result: await runRealOrderSync(co.value, {}, t) })
    return NextResponse.json({ success: false, error: t("libmeta.api.badOp") }, { status: 400 })
  } catch (e) { return err(e) }
}
