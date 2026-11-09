// GET /api/connect/status — trạng thái kết nối qua cổng cho giao diện (không có token).
import { NextResponse } from "next/server"
import { gatewayEnabled } from "@/lib/connect/gateway"
import { readConnect } from "@/lib/connect/store"
import { getCurrentUser } from "@/lib/auth"
import { guardViewCredentials } from "@/lib/settings/guards"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const guard = guardViewCredentials(user)
  if (guard) return guard
  if (!gatewayEnabled()) return NextResponse.json({ gateway: false })
  const c = readConnect()
  return NextResponse.json({
    gateway: true,
    google: c.google ? { connected: true, createdAt: c.google.createdAt, createdBy: c.google.createdBy, accounts: c.google.accounts } : { connected: false },
    meta: c.meta ? { connected: true, createdAt: c.meta.createdAt, createdBy: c.meta.createdBy, adAccount: c.meta.adAccount ?? null, companies: c.meta.companies ?? {} } : { connected: false },
  })
}
