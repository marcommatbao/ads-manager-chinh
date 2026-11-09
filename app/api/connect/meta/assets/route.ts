// GET /api/connect/meta/assets[?adAccountId=…] — tài khoản quảng cáo + Trang khách đã chia sẻ; kèm Pixel của tài khoản được hỏi.
// GET ?preview=1 — chi tiêu 7 ngày của tài khoản đã lưu.
import { NextResponse, type NextRequest } from "next/server"
import { listMetaAdAccounts, listMetaPages, listMetaPixels, previewMetaAccount } from "@/lib/connect/meta-assets"
import { connectError, connectGuard } from "@/lib/connect/route-kit"
import { readConnect } from "@/lib/connect/store"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const q = req.nextUrl.searchParams
  try {
    if (q.get("preview") === "1") {
      const acct = readConnect().meta?.adAccount
      if (!acct) return NextResponse.json({ error: "Chưa chọn tài khoản quảng cáo" }, { status: 400 })
      try {
        return NextResponse.json({ ...acct, ...(await previewMetaAccount(acct.id)) })
      } catch (e) {
        return NextResponse.json({ ...acct, error: e instanceof Error ? e.message : String(e) })
      }
    }
    const adAccountId = q.get("adAccountId")
    if (adAccountId) return NextResponse.json({ pixels: await listMetaPixels(adAccountId) })
    const [adAccounts, pages] = await Promise.all([listMetaAdAccounts(), listMetaPages()])
    return NextResponse.json({ adAccounts, pages })
  } catch (e) {
    return connectError(e)
  }
}
