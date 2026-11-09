// POST /api/writes/undo { id: "dm:<id>" } — Đợt 23 (3c): hoàn tác một lần bật/tắt / đổi ngân sách từ trang "Đã làm & kết quả".
// Đọc giá trị HIỆN TẠI trên nền tảng; khác giá trị đã áp → 409 (không đè thay đổi mới). Ghi lại bằng chính route cũ.
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getT } from "@/lib/i18n/server"
import { hasPermission, canAccessCompany } from "@/lib/permissions"
import { getById, updateEntry } from "@/lib/decision-memory/store"
import { planUndo, undoableReason, googleStatusName } from "@/lib/writes/undo"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { friendlyError } from "@/lib/not-configured"
import { POST as metaStatus } from "@/app/api/meta/campaigns/[id]/status/route"
import { PATCH as metaBudget } from "@/app/api/meta/campaigns/[id]/budget/route"
import { POST as googleStatus } from "@/app/api/google/campaigns/[id]/status/route"
import { PATCH as googleBudget } from "@/app/api/google/campaigns/[id]/budget/route"

export const dynamic = "force-dynamic"

async function readCurrent(platform: "meta" | "google_ads", field: string, id: string, company: string): Promise<string | number | null> {
  if (platform === "meta") {
    const token = process.env.META_ACCESS_TOKEN
    if (!token) throw new Error("META_ACCESS_TOKEN not configured")
    if (!/^\d{5,25}$/.test(id)) return null
    const r = await fetch(`${META_GRAPH_BASE}/${id}?fields=status,daily_budget&access_token=${encodeURIComponent(token)}`)
    const d = (await r.json()) as { status?: string; daily_budget?: string; error?: { message?: string } }
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `Meta API error ${r.status}`)
    return field === "status" ? d.status ?? null : d.daily_budget != null ? Number(d.daily_budget) : null
  }
  const cid = parseInt(id, 10)
  if (!cid) return null
  const rows = await getGoogleAdsCustomer(company).query(`SELECT campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${cid}`)
  if (!rows[0]) return null
  return field === "status" ? googleStatusName(rows[0].campaign?.status) : Math.round(Number(rows[0].campaign_budget?.amount_micros ?? 0) / 1_000_000)
}

/** Soát 07/10: hai lần bấm cùng lúc cùng một thay đổi → lần sau bị chặn (tránh ghi đôi nhật ký + đo lại đôi). */
const inFlight = new Set<string>()

export async function POST(request: NextRequest) {
  const t = await getT()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasPermission(user.role, "can_edit")) return NextResponse.json({ success: false, error: t("libcase.w.undo.noPerm") }, { status: 403 })
  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  const m = /^dm:(.+)$/.exec(String(id ?? ""))
  if (!m) return NextResponse.json({ success: false, error: t("libcase.w.undo.notHere") }, { status: 400 })
  const entry = getById(m[1])
  if (!entry) return NextResponse.json({ success: false, error: t("libcase.w.undo.notFound") }, { status: 404 })
  if (!canAccessCompany(user, entry.target.company)) return NextResponse.json({ success: false, error: t("libcase.w.undo.noCompany") }, { status: 403 })
  const why = undoableReason(entry, t)
  if (why) return NextResponse.json({ success: false, error: why }, { status: 409 })

  const platform = entry.target.platform as "meta" | "google_ads"
  if (inFlight.has(entry.id)) return NextResponse.json({ success: false, error: t("libcase.w.undo.busy") }, { status: 409 })
  inFlight.add(entry.id)
  try {
    const plan = planUndo(entry, await readCurrent(platform, String(entry.action.field), entry.target.entityId, entry.target.company), t)
    if (!plan.ok) return NextResponse.json({ success: false, error: plan.reason }, { status: 409 })

    // Gọi thẳng route cũ (cùng cookie phiên) → cùng chốt quyền, cùng ghi nhật ký + đo lại.
    const ctx = { params: Promise.resolve({ id: plan.entityId }) }
    const req = (method: string, body: unknown) => new NextRequest(new URL(`/api/_undo/${plan.entityId}`, request.url), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    let res: Response
    if (plan.field === "status") {
      const pause = plan.restore === "PAUSED"
      res = platform === "meta"
        ? await metaStatus(req("POST", { action: pause ? "PAUSE" : "ACTIVATE", ...(entry.target.entityType === "adset" ? { level: "adset" } : {}) }), ctx)
        : await googleStatus(req("POST", { action: pause ? "PAUSE" : "ACTIVE", company: plan.company }), ctx)
    } else {
      res = platform === "meta"
        ? await metaBudget(req("PATCH", { dailyBudget: plan.restore }), ctx)
        : await googleBudget(req("PATCH", { dailyBudget: plan.restore, company: plan.company }), ctx)
    }
    const out = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string }
    if (!res.ok || !out.success) return NextResponse.json({ success: false, error: out.error ?? t("libcase.w.undo.failed") }, { status: res.status >= 400 ? res.status : 500 })

    await updateEntry(entry.id, { undoneAt: new Date().toISOString(), undoneBy: user.email || user.name || user.id })
    return NextResponse.json({ success: true, restored: plan.restore })
  } catch (e) {
    const msg = platform === "google_ads" ? googleAdsErrorMessage(e) : e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 })
  } finally {
    inFlight.delete(entry.id)
  }
}
