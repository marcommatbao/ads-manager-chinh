// POST /api/connect/meta/select { adAccountId, companies: { <mã công ty>: { pixelId?, pageId? } } }
// Mọi mã phải nằm trong danh sách Meta trả về cho kết nối này (không nhận mã gõ tay) — kiểm lại với Meta lúc lưu.
import { NextResponse, type NextRequest } from "next/server"
import { companyIds } from "@/lib/companies"
import { listMetaAdAccounts, listMetaPages, listMetaPixels } from "@/lib/connect/meta-assets"
import { syncMetaRuntime } from "@/lib/connect/meta-runtime"
import { connectError, connectGuard } from "@/lib/connect/route-kit"
import { readConnect, writeConnect, type MetaCompanyPick } from "@/lib/connect/store"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const body = (await req.json().catch(() => ({}))) as { adAccountId?: unknown; companies?: unknown }
  const conn = readConnect()
  if (!conn.meta?.connectionId) return NextResponse.json({ error: "Chưa kết nối Facebook" }, { status: 400 })
  const adAccountId = String(body.adAccountId ?? "")
  try {
    const accounts = await listMetaAdAccounts()
    const acct = accounts.find((a) => a.id === adAccountId)
    if (!acct) return NextResponse.json({ error: "Tài khoản quảng cáo không nằm trong danh sách bạn đã chia sẻ cho Mắt Bão" }, { status: 400 })
    const [pages, pixels] = await Promise.all([listMetaPages(), listMetaPixels(acct.id)])
    const known = new Set(companyIds())
    const companies: Record<string, MetaCompanyPick> = {}
    const raw = body.companies && typeof body.companies === "object" ? (body.companies as Record<string, { pixelId?: unknown; pageId?: unknown }>) : {}
    for (const [co, v] of Object.entries(raw)) {
      if (!known.has(co)) return NextResponse.json({ error: `Công ty không tồn tại: ${co}` }, { status: 400 })
      const pick: MetaCompanyPick = {}
      if (v?.pixelId) {
        const px = pixels.find((p) => p.id === String(v.pixelId))
        if (!px) return NextResponse.json({ error: `Pixel ${String(v.pixelId)} không thuộc tài khoản ${acct.name}` }, { status: 400 })
        pick.pixelId = px.id; pick.pixelName = px.name
      }
      if (v?.pageId) {
        const pg = pages.find((p) => p.id === String(v.pageId))
        if (!pg) return NextResponse.json({ error: `Trang ${String(v.pageId)} không nằm trong danh sách bạn đã chia sẻ` }, { status: 400 })
        pick.pageId = pg.id; pick.pageName = pg.name
      }
      if (pick.pixelId || pick.pageId) companies[co] = pick
    }
    const latest = readConnect()
    if (latest.meta?.connectionId !== conn.meta.connectionId) return NextResponse.json({ error: "Kết nối Facebook vừa thay đổi — tải lại trang" }, { status: 409 })
    writeConnect({ ...latest, meta: { ...latest.meta, adAccount: { id: acct.id, name: acct.name, currency: acct.currency }, companies } })
    await syncMetaRuntime()
    await writeAuditEntry("credentials_meta", g.user, "update", "gateway_select_assets", null, null, "ALL")
    return NextResponse.json({ ok: true, adAccount: acct, companies })
  } catch (e) {
    return connectError(e)
  }
}
