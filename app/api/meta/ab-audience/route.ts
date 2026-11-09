// /api/meta/ab-audience — A/B test tệp đối tượng Meta (lib/meta/ab-audience*.ts).
//   GET  ?company=&force=1                    danh sách thử nghiệm + số đo từ ngày bắt đầu (chỉ đọc Meta, đệm 10 phút)
//   POST { action:"plan",   company, sourceAdsetId, variant }   xem trước + Meta Kiểm trước (không tạo gì)
//   POST { action:"create", company, sourceAdsetId, variant }   tạo nhóm B + quảng cáo, TẠM DỪNG
//   POST { action:"start" | "discard", id }                      bật B / huỷ (B chưa phân phối → xoá)
//   POST { action:"end", id, pause: "a"|"b"|null }               chụp kết luận, tuỳ chọn tạm dừng một bên
// Mọi POST cần quyền sửa; thử nghiệm của công ty khác → 403.
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission, canAccessCompany } from "@/lib/permissions"
import { allowForce } from "@/lib/cost-guard"
import { friendlyError } from "@/lib/not-configured"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { abReading, getAbTest, listAbTests, type AbVariant } from "@/lib/meta/ab-audience"
import { AbRefused, createAbTest, discardAbTest, endAbTest, measureAbTest, planAbTest, startAbTest } from "@/lib/meta/ab-audience-exec"

export const dynamic = "force-dynamic"
export const maxDuration = 60

function metaErr(e: unknown, t: TFunction) {
  if (e instanceof AbRefused) return NextResponse.json({ success: false, error: e.message }, { status: 409 })
  const msg = e instanceof Error ? e.message : String(e)
  if (/Application request limit|User request limit|#17|#4\b/.test(msg)) return NextResponse.json({ success: false, error: t("libmeta.api.metaRateLimit") }, { status: 429 })
  return fail(e instanceof Error ? new Error(friendlyError(msg)) : e)
}

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const q = request.nextUrl.searchParams
  const co = requireCompany(u.value, q.get("company"))
  if (!co.ok) return co.response
  const tr = await getT()
  const force = q.get("force") === "1" && allowForce(`ab|${co.value}`, hasPermission(u.value.role, "can_edit"))
  const tests = listAbTests(co.value).slice(0, 30)
  const out = []
  for (const t of tests) {
    if (t.status !== "running" && t.status !== "ended") { out.push({ test: t, measure: null, reading: null, error: null }); continue }
    try {
      const m = await measureAbTest(t, { force })
      out.push({ test: t, measure: m, reading: abReading(t, m.group, m.days, tr), error: null })
    } catch (e) {
      out.push({ test: t, measure: null, reading: null, error: friendlyError(e instanceof Error ? e.message : String(e)) })
    }
  }
  return NextResponse.json({ success: true, company: co.value, tests: out, canEdit: hasPermission(u.value.role, "can_edit") })
}

const inFlight = new Set<string>()

function parseVariant(v: unknown): AbVariant | null {
  const x = (v ?? {}) as Record<string, unknown>
  if (x.kind === "winning" && typeof x.winningId === "string") return { kind: "winning", winningId: x.winningId, name: String(x.name ?? "") }
  if (x.kind === "edit") return { kind: "edit", ageMin: Number(x.ageMin), ageMax: Number(x.ageMax), genders: Array.isArray(x.genders) ? x.genders.map(Number) : [] }
  return null
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(b.action ?? "")
  const actor = actorOf(u.value)
  const tr = await getT()

  if (action === "plan" || action === "create") {
    const co = requireCompany(u.value, b.company)
    if (!co.ok) return co.response
    const variant = parseVariant(b.variant)
    if (!variant) return NextResponse.json({ success: false, error: "Chọn tệp cho nhóm B (tệp thắng đã lưu, hoặc đổi tuổi/giới tính)" }, { status: 400 })
    const src = String(b.sourceAdsetId ?? "")
    const key = `create|${src}`
    if (action === "create" && inFlight.has(key)) return NextResponse.json({ success: false, error: "Đang tạo — chờ lần bấm trước xong" }, { status: 409 })
    inFlight.add(key)
    try {
      if (action === "plan") return NextResponse.json({ success: true, plan: await planAbTest(co.value, src, variant, tr) })
      return NextResponse.json({ success: true, test: await createAbTest(co.value, src, variant, actor) })
    } catch (e) { return metaErr(e, tr) }
    finally { inFlight.delete(key) }
  }

  if (action === "start" || action === "end" || action === "discard") {
    const t = getAbTest(String(b.id ?? ""))
    if (!t) return NextResponse.json({ success: false, error: "Không thấy thử nghiệm này" }, { status: 404 })
    if (!canAccessCompany(u.value, t.company)) return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 })
    if (inFlight.has(t.id)) return NextResponse.json({ success: false, error: "Đang xử lý thử nghiệm này — chờ lần bấm trước xong" }, { status: 409 })
    inFlight.add(t.id)
    try {
      if (action === "start") return NextResponse.json({ success: true, test: await startAbTest(t, actor) })
      if (action === "discard") return NextResponse.json({ success: true, ...(await discardAbTest(t, actor)) })
      const side = b.pause === "a" || b.pause === "b" ? b.pause : null
      return NextResponse.json({ success: true, test: await endAbTest(t, side, actor) })
    } catch (e) { return metaErr(e, tr) }
    finally { inFlight.delete(t.id) }
  }
  return NextResponse.json({ success: false, error: "Hành động không hợp lệ" }, { status: 400 })
}
