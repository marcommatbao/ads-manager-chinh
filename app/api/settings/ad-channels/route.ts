// /api/settings/ad-channels — Đợt 27: sổ kênh quảng cáo dùng chung (KPI · P&L · Chi phí kênh khác).
//   GET                         danh sách kênh (mọi người đăng nhập — KPI/P&L cần nhãn kênh)
//   POST  { label }             thêm kênh (vd "ChatGPT Ads") — CHỈ Super Admin
//   PATCH { key, hidden }       ẩn / hiện kênh tự thêm — CHỈ Super Admin; kênh đang có số thì không ẩn được
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { writeAuditEntry } from "@/lib/settings/audit"
import { addChannel, adChannels, ChannelInputError, setChannelHidden } from "@/lib/settings/ad-channels"
import { channelHasKpiValues } from "@/lib/settings/kpi-store"
import { readManualSpend } from "@/lib/finance/manual-spend"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ success: true, channels: adChannels(), canManage: isSuperAdmin(user.role) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSuperAdmin(user.role)) return NextResponse.json({ success: false, error: "Chỉ Super Admin thêm được kênh" }, { status: 403 })
  const b = (await req.json().catch(() => ({}))) as { label?: unknown }
  try {
    const ch = await addChannel(String(b.label ?? ""), user.email ?? user.name ?? "?")
    await writeAuditEntry("kpi", user, "update", `Thêm kênh quảng cáo ${ch.key} (${ch.label})`, null, null, "ALL")
    return NextResponse.json({ success: true, channel: ch, channels: adChannels() })
  } catch (e) {
    if (e instanceof ChannelInputError) return NextResponse.json({ success: false, error: e.message }, { status: 400 })
    throw e
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSuperAdmin(user.role)) return NextResponse.json({ success: false, error: "Chỉ Super Admin ẩn/hiện được kênh" }, { status: 403 })
  const b = (await req.json().catch(() => ({}))) as { key?: unknown; hidden?: unknown }
  const manual = await readManualSpend()
  const inUse = (key: string) => channelHasKpiValues(key) || manual.some((e) => e.channel === key && e.amount > 0)
  try {
    const ch = await setChannelHidden(String(b.key ?? ""), b.hidden === true, inUse)
    await writeAuditEntry("kpi", user, "update", `${ch.hidden ? "Ẩn" : "Hiện"} kênh quảng cáo ${ch.key}`, null, null, "ALL")
    return NextResponse.json({ success: true, channel: ch, channels: adChannels() })
  } catch (e) {
    if (e instanceof ChannelInputError) return NextResponse.json({ success: false, error: e.message }, { status: 400 })
    throw e
  }
}
