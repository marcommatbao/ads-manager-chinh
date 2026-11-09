// Đợt 10c (C3) — chất lượng lead về Google.
// GET  ?company=                                  — hành động chuyển đổi, thống kê, trạng thái webhook
// POST {company, op: "create_actions", validateOnly, confirmText?, values?}  — tạo 2 hành động tải lên (PHỤ)
// POST {company, op: "rotate_secret"}                                        — tạo khoá webhook mới (hiện ĐÚNG MỘT LẦN)
// POST {company, op: "csv", csv}                                             — nhận CSV rồi gửi luôn
// POST {company, op: "upload", validateOnly}                                 — gửi các sự kiện đang chờ
import { NextRequest, NextResponse } from "next/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { companySettings, ensureActions, ingestEvents, leadQualityStats, parseLeadCsv, readActions, rotateWebhookSecret, STAGE_LABEL, uploadPending } from "@/lib/leads/quality"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e))

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  try {
    const s = companySettings(co.value)
    return NextResponse.json({
      success: true, actions: await readActions(co.value), stats: leadQualityStats(co.value), stageLabels: STAGE_LABEL, defaultValue: s.defaultValue ?? {},
      webhook: { configured: !!s.webhookSecretHash, createdAt: s.webhookSecretCreatedAt ?? null, path: `/api/leads/quality/webhook?company=${co.value}` },
      canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT,
    })
  } catch (e) { return err(e) }
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; validateOnly?: boolean; confirmText?: string; values?: Record<string, unknown>; csv?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  try {
    if (b.op === "create_actions") {
      const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined)
      const r = await ensureActions(co.value, { validateOnly: b.validateOnly !== false, confirmText: b.confirmText, values: { qualified: num(b.values?.qualified), won: num(b.values?.won) } })
      return NextResponse.json({ success: true, validated: b.validateOnly !== false, ...r })
    }
    if (b.op === "rotate_secret") return NextResponse.json({ success: true, secret: await rotateWebhookSecret(co.value), note: "Chỉ hiện một lần — dán vào CRM ngay; khoá cũ hết hiệu lực." })
    if (b.op === "csv") {
      if (typeof b.csv !== "string" || b.csv.length > 3_000_000) return NextResponse.json({ success: false, error: "CSV rỗng hoặc quá lớn" }, { status: 400 })
      const p = parseLeadCsv(b.csv)
      if (p.errors.length) return NextResponse.json({ success: false, error: p.errors.join(" · ") }, { status: 400 })
      const ing = { accepted: 0, duplicates: 0, errors: [] as string[] }
      for (let i = 0; i < p.rows.length; i += 500) { const r = await ingestEvents(co.value, p.rows.slice(i, i + 500), "csv"); ing.accepted += r.accepted; ing.duplicates += r.duplicates; ing.errors.push(...r.errors.map((x) => x.replace(/^#(\d+)/, (_, n) => `dòng ${Number(n) + i + 1}`))) }
      const up = await uploadPending(co.value)
      return NextResponse.json({ success: true, ingest: { ...ing, errors: ing.errors.slice(0, 20) }, upload: up })
    }
    if (b.op === "upload") return NextResponse.json({ success: true, validated: !!b.validateOnly, upload: await uploadPending(co.value, { validateOnly: !!b.validateOnly }) })
    return NextResponse.json({ success: false, error: "op không hợp lệ" }, { status: 400 })
  } catch (e) { return err(e) }
}
