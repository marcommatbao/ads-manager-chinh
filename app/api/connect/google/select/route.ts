// POST /api/connect/google/select { accounts: [{ customerId, company }] } — gán tài khoản đã chọn cho từng công ty.
// Chỉ nhận tài khoản có trong danh sách cổng trả về lúc này (không tin mã do trình duyệt gửi); mỗi công ty tối đa một tài khoản.
import { NextResponse, type NextRequest } from "next/server"
import { isCompany } from "@/lib/companies/registry"
import { listGoogleAccounts } from "@/lib/connect/google-accounts"
import { readConnect, writeConnect, type GoogleAccountPick } from "@/lib/connect/store"
import { connectError, connectGuard } from "@/lib/connect/route-kit"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const conn = readConnect()
  if (!conn.google?.connectionId) return NextResponse.json({ error: "Chưa kết nối Google Ads" }, { status: 409 })
  let picks: { customerId?: unknown; company?: unknown }[]
  try {
    const body = (await req.json()) as { accounts?: unknown }
    picks = Array.isArray(body.accounts) ? body.accounts as typeof picks : []
  } catch {
    return NextResponse.json({ error: "Thân yêu cầu không hợp lệ" }, { status: 400 })
  }
  const seenCompany = new Set<string>()
  for (const p of picks) {
    const company = String(p.company ?? "")
    if (!isCompany(company)) return NextResponse.json({ error: `Công ty không hợp lệ: ${company}` }, { status: 400 })
    if (seenCompany.has(company)) return NextResponse.json({ error: `Mỗi công ty chỉ gán một tài khoản Google Ads (${company})` }, { status: 400 })
    seenCompany.add(company)
  }
  try {
    const { accounts } = await listGoogleAccounts()
    const byId = new Map(accounts.map((a) => [a.customerId, a]))
    const chosen: GoogleAccountPick[] = []
    for (const p of picks) {
      const id = String(p.customerId ?? "").replace(/-/g, "")
      const a = byId.get(id)
      if (!a) return NextResponse.json({ error: `Tài khoản ${id} không nằm trong danh sách tài khoản Google bạn vừa kết nối` }, { status: 400 })
      chosen.push({ customerId: id, loginCustomerId: a.loginCustomerId, name: a.name, company: String(p.company) })
    }
    writeConnect({ ...conn, google: { ...conn.google, accounts: chosen } })
    await writeAuditEntry("credentials_google", g.user, "update", "gateway_accounts", null, chosen.map((c) => `${c.company}:${c.customerId}`).join(", "), "ALL")
    return NextResponse.json({ ok: true, accounts: chosen })
  } catch (e) {
    return connectError(e)
  }
}
