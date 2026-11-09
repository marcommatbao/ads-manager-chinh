// GET /api/connect/google/accounts — tài khoản Google Ads mà tài khoản Google vừa kết nối vào được (để tích chọn).
import { NextResponse } from "next/server"
import { listGoogleAccounts } from "@/lib/connect/google-accounts"
import { readConnect } from "@/lib/connect/store"
import { connectError, connectGuard } from "@/lib/connect/route-kit"

export const dynamic = "force-dynamic"

export async function GET() {
  const g = await connectGuard()
  if ("res" in g) return g.res
  if (!readConnect().google?.connectionId) return NextResponse.json({ error: "Chưa kết nối Google Ads" }, { status: 409 })
  try {
    return NextResponse.json(await listGoogleAccounts())
  } catch (e) {
    return connectError(e)
  }
}
