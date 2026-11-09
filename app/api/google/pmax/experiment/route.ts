// GET  /api/google/pmax/experiment?company=&source=&ga4Event= — Đợt 10c (C4): phương án thí nghiệm loại trừ vùng + danh sách
// POST /api/google/pmax/experiment {company, candidateId, campaignIds[], weeks, source?, ga4Event?, validateOnly, confirmText?}
// Phương án TÍNH LẠI ở máy chủ từ số tươi; ghi thật cần "XAC NHAN" + quyền can_edit.
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { designExperiment, launchExperiment, listExperiments, MAX_TEST_WEEKS, MIN_TEST_WEEKS, readCsvKpi, type KpiChoice } from "@/lib/pmax/geo-experiment"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { gtmServiceEmail } from "@/lib/measure/gtm-api"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120

const choiceOf = (source: unknown, ga4Event: unknown, ga4NewOnly?: unknown): KpiChoice => ({
  ga4NewOnly: ga4NewOnly === true || ga4NewOnly === "1",
  source: ["ga4", "csv", "google"].includes(String(source)) ? (String(source) as KpiChoice["source"]) : "auto",
  ga4Event: typeof ga4Event === "string" && /^[a-zA-Z0-9_]{1,60}$/.test(ga4Event) ? ga4Event : undefined,
})

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  try {
    const design = await designExperiment(co.value, choiceOf(sp.get("source"), sp.get("ga4Event"), sp.get("ga4NewOnly")), new Date(), t)
    const csv = readCsvKpi(co.value)
    return NextResponse.json({
      success: true, design, experiments: listExperiments(co.value).slice(0, 20),
      csv: csv ? { uploadedAt: csv.uploadedAt, rows: csv.rows.length, from: csv.rows.reduce((m, r) => (r.date < m ? r.date : m), "9999"), to: csv.rows.reduce((m, r) => (r.date > m ? r.date : m), "0000") } : null,
      serviceAccountEmail: gtmServiceEmail(), weeks: { min: MIN_TEST_WEEKS, max: MAX_TEST_WEEKS, default: 4 },
      canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT,
    })
  } catch (err) {
    if (err instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err, t)
  }
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; candidateId?: string; campaignIds?: unknown; weeks?: number; source?: string; ga4Event?: string; ga4NewOnly?: boolean; validateOnly?: boolean; confirmText?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  if (!["hn", "hcm", "tinh"].includes(String(b.candidateId))) return NextResponse.json({ success: false, error: t("libgoogle.rt.badCandidate") }, { status: 400 })
  const campaignIds = Array.isArray(b.campaignIds) ? b.campaignIds.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)).slice(0, 50) : []
  try {
    const experiment = await launchExperiment({ company: co.value, candidateId: b.candidateId as "hn" | "hcm" | "tinh", campaignIds, weeks: Number(b.weeks) || 4, kpi: choiceOf(b.source, b.ga4Event, b.ga4NewOnly), actor: actorOf(u.value), validateOnly: b.validateOnly !== false, confirmText: b.confirmText }, t)
    return NextResponse.json({ success: true, validated: b.validateOnly !== false, experiment })
  } catch (err) {
    if (err instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err, t)
  }
}
