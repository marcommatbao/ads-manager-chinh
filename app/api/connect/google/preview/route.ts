// GET /api/connect/google/preview?company=X — chi tiêu 7 ngày của tài khoản đã gán cho công ty (số thật, hoặc lỗi thật).
import { NextResponse, type NextRequest } from "next/server"
import { previewGoogleAccount } from "@/lib/connect/google-accounts"
import { readConnect } from "@/lib/connect/store"
import { connectGuard } from "@/lib/connect/route-kit"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const company = req.nextUrl.searchParams.get("company") ?? ""
  const pick = readConnect().google?.accounts.find((a) => a.company === company)
  if (!pick) return NextResponse.json({ error: `Chưa gán tài khoản Google Ads cho ${company}` }, { status: 404 })
  try {
    return NextResponse.json({ company, customerId: pick.customerId, ...(await previewGoogleAccount(pick.customerId, pick.loginCustomerId)) })
  } catch (e) {
    return NextResponse.json({ company, customerId: pick.customerId, error: googleAdsErrorMessage(e) }, { status: 502 })
  }
}
