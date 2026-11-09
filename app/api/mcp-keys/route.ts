// Khoá MCP cho Claude (task #7142): người dùng tự tạo / xem / thu hồi khoá của mình; Super Admin xem + thu hồi mọi khoá
// và chỉnh cài đặt ghi. Khoá thô chỉ trả ĐÚNG MỘT LẦN lúc tạo.
import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/case/http"
import { hasPermission, isSuperAdmin } from "@/lib/permissions"
import { createKey, listKeys, readSettings, revokeKey, writeSettings, writesToday, type McpMode } from "@/lib/mcp/store"
import { publicAppUrl } from "@/lib/app-url"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  const admin = isSuperAdmin(u.value.role)
  const { getAllMembers } = await import("@/lib/team")
  const emails = new Map((await getAllMembers()).map((m) => [m.id, m.email]))
  const keys = listKeys()
    .filter((k) => admin || k.userId === u.value.id)
    .map(({ hash: _h, ...k }) => ({ ...k, userEmail: emails.get(k.userId) ?? k.userId, mine: k.userId === u.value.id, writesToday: writesToday(k.id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return NextResponse.json({
    success: true, keys, settings: readSettings(), isSuperAdmin: admin,
    canWrite: hasPermission(u.value.role, "can_edit"),
    endpoint: `${publicAppUrl() || ""}/api/mcp`,
  })
}

export async function POST(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; mode?: unknown; settings?: unknown }
  if (body.settings !== undefined) {
    if (!isSuperAdmin(u.value.role)) return NextResponse.json({ success: false, error: "Chỉ Super Admin chỉnh được" }, { status: 403 })
    const s = body.settings as Record<string, unknown>, cur = readSettings()
    const next = {
      writesEnabled: typeof s.writesEnabled === "boolean" ? s.writesEnabled : cur.writesEnabled,
      maxWritesPerDay: Number.isInteger(s.maxWritesPerDay) && (s.maxWritesPerDay as number) >= 0 && (s.maxWritesPerDay as number) <= 200 ? (s.maxWritesPerDay as number) : cur.maxWritesPerDay,
      newCampaignMaxDailyBudget: Number.isFinite(s.newCampaignMaxDailyBudget) && (s.newCampaignMaxDailyBudget as number) > 0 ? (s.newCampaignMaxDailyBudget as number) : cur.newCampaignMaxDailyBudget,
    }
    await writeSettings(next)
    return NextResponse.json({ success: true, settings: next })
  }
  const mode: McpMode = body.mode === "write" ? "write" : "read"
  if (mode === "write" && !hasPermission(u.value.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Vai trò của bạn không có quyền sửa nên chỉ tạo được khoá Chỉ đọc" }, { status: 403 })
  }
  const { key, secret } = await createKey({ userId: u.value.id, name: String(body.name ?? ""), mode })
  const { hash: _h, ...pub } = key
  return NextResponse.json({ success: true, key: pub, secret })
}

export async function DELETE(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const id = request.nextUrl.searchParams.get("id") ?? ""
  const ok = await revokeKey(id, u.value.id, isSuperAdmin(u.value.role))
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: "Không tìm thấy khoá" }, { status: 404 })
}
