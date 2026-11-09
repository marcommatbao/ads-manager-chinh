// GET  /api/settings/connections-extra — trạng thái kết nối GTM + Trang Facebook (KHÔNG trả khoá/token)
// POST /api/settings/connections-extra — {action}:
//   gtm_test {json?}   kiểm khoá (dán mới hoặc đang dùng) — CHỈ ĐỌC, không lưu
//   gtm_save {json}    kiểm rồi lưu (mã hoá)          · gtm_remove
//   pages_add {token}  token Trang HOẶC token người dùng dài hạn của người quản trị Trang → lưu token TỪNG Trang
//                      (token người dùng không bao giờ được lưu)
//   page_remove {pageId} · pages_test  thử đọc 1 bài mỗi Trang
// User chốt 28/09: nhập trong Cài đặt thay vì biến môi trường máy chủ. Biến môi trường vẫn thắng nếu có.
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { guardEditCredentials, guardViewCredentials } from "@/lib/settings/guards"
import { writeAuditEntry } from "@/lib/settings/audit"
import { configuredPageTokens, gtmServiceAccountSource, readExtraConnections, updateExtraConnections } from "@/lib/connections/extra-connections"
import { parseServiceAccount, resetGtmCaches, testGtmKey } from "@/lib/measure/gtm-api"
import { pageTokenMap, resetPageTokenCache, resolvePastedToken } from "@/lib/meta/page-posts"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"

export const dynamic = "force-dynamic"
export const maxDuration = 60

async function status() {
  const x = readExtraConnections()
  const gtm = gtmServiceAccountSource()
  const sa = gtm.json ? parseServiceAccount(gtm.json) : null
  const tokens = await pageTokenMap().catch(() => new Map())
  const configured = configuredPageTokens()
  return {
    gtm: { connected: !!sa, source: gtm.source, email: sa?.client_email ?? null, savedAt: x.gtmSavedAt ?? null, savedBy: x.gtmSavedBy ?? null },
    pages: [...tokens.entries()].map(([pageId, p]) => ({
      pageId, name: p.name, source: p.source as "env" | "settings" | "system_user",
      addedAt: x.pages?.[pageId]?.addedAt ?? null, addedBy: x.pages?.[pageId]?.addedBy ?? null,
      removable: configured.some((c) => c.pageId === pageId && c.source === "settings"),
    })),
    guide: { gtm: "/guide/ket-noi#gtm", pages: "/guide/ket-noi#meta-page" },
  }
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const g = guardViewCredentials(user)
  if (g) return g
  return NextResponse.json({ ok: true, ...(await status()) })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const g = guardEditCredentials(user)
  if (g) return g
  const b = (await request.json().catch(() => ({}))) as { action?: string; json?: string; token?: string; pageId?: string }
  const actor = user.email ?? user.name ?? "?"
  const now = new Date().toISOString()

  switch (b.action) {
    case "gtm_test": {
      const r = await testGtmKey(typeof b.json === "string" && b.json.trim() ? b.json.trim() : undefined)
      return NextResponse.json({ ok: true, test: r })
    }
    case "gtm_save": {
      const json = typeof b.json === "string" ? b.json.trim() : ""
      if (!parseServiceAccount(json)) return NextResponse.json({ ok: false, error: "Không phải tệp JSON khoá tài khoản dịch vụ Google (thiếu client_email / private_key). Mở tệp .json vừa tải và dán TOÀN BỘ nội dung." }, { status: 400 })
      const test = await testGtmKey(json)
      if (!test.ok) return NextResponse.json({ ok: false, error: test.error ?? "Khoá không dùng được", test }, { status: 400 })
      await updateExtraConnections((c) => ({ ...c, gtmServiceAccountJson: json, gtmSavedAt: now, gtmSavedBy: actor }))
      resetGtmCaches()
      await writeAuditEntry("credentials_gtm", user, "update", "gtmServiceAccountJson", null, test.email, "ALL")
      const envWins = gtmServiceAccountSource().source === "env"
      return NextResponse.json({ ok: true, test, message: envWins ? "Đã lưu, nhưng biến môi trường GTM_SERVICE_ACCOUNT_JSON trên máy chủ đang ưu tiên hơn." : `Đã kết nối — thấy ${test.containers.length} container.`, ...(await status()) })
    }
    case "gtm_remove": {
      await updateExtraConnections((c) => ({ ...c, gtmServiceAccountJson: undefined, gtmSavedAt: undefined, gtmSavedBy: undefined }))
      resetGtmCaches()
      await writeAuditEntry("credentials_gtm", user, "delete", "gtmServiceAccountJson", null, null, "ALL")
      return NextResponse.json({ ok: true, ...(await status()) })
    }
    case "pages_add": {
      const r = await resolvePastedToken(typeof b.token === "string" ? b.token : "")
      if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
      const usable = r.pages.filter((p) => p.canRead)
      if (usable.length) {
        await updateExtraConnections((c) => ({ ...c, pages: { ...(c.pages ?? {}), ...Object.fromEntries(usable.map((p) => [p.pageId, { token: p.token, name: p.name, addedAt: now, addedBy: actor }])) } }))
        resetPageTokenCache()
        await writeAuditEntry("credentials_meta_pages", user, "update", "pages", null, usable.map((p) => `${p.name} (${p.pageId})`).join(", "), "ALL")
      }
      return NextResponse.json({
        ok: usable.length > 0, kind: r.kind,
        added: usable.map((p) => ({ pageId: p.pageId, name: p.name, neverExpires: p.neverExpires })),
        skipped: r.pages.filter((p) => !p.canRead).map((p) => ({ pageId: p.pageId, name: p.name, reason: "Token không đọc được bài của Trang này (thiếu pages_read_engagement?)" })),
        warning: usable.some((p) => !p.neverExpires) ? "Có token SẼ HẾT HẠN — làm theo bước “đổi sang token dài hạn” trong hướng dẫn để không phải dán lại." : undefined,
        ...(usable.length ? {} : { error: "Không Trang nào đọc được bằng token này" }),
        ...(await status()),
      })
    }
    case "page_remove": {
      if (!b.pageId || !/^\d+$/.test(b.pageId)) return NextResponse.json({ ok: false, error: "Thiếu mã Trang" }, { status: 400 })
      await updateExtraConnections((c) => { const pages = { ...(c.pages ?? {}) }; delete pages[b.pageId!]; return { ...c, pages } })
      resetPageTokenCache()
      await writeAuditEntry("credentials_meta_pages", user, "delete", `page ${b.pageId}`, null, null, "ALL")
      return NextResponse.json({ ok: true, ...(await status()) })
    }
    case "pages_test": {
      const results: { pageId: string; name: string | null; ok: boolean; error?: string }[] = []
      for (const [pageId, p] of await pageTokenMap()) {
        try {
          const res = await fetch(`${META_GRAPH_BASE}/${pageId}/posts?limit=1&fields=id`, { headers: { Authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(20_000) })
          const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          results.push({ pageId, name: p.name, ok: res.ok && !j.error, ...(res.ok && !j.error ? {} : { error: j.error?.message ?? `HTTP ${res.status}` }) })
        } catch (e) { results.push({ pageId, name: p.name, ok: false, error: e instanceof Error ? e.message : String(e) }) }
      }
      return NextResponse.json({ ok: true, results })
    }
    default:
      return NextResponse.json({ ok: false, error: "Hành động không hợp lệ" }, { status: 400 })
  }
}
