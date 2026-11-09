// GET /api/measure/utm-links/suggest?company=MBC&platform=facebook|google — Đợt 9 · 3
// Gợi ý dòng cho bảng link chuẩn từ link quảng cáo đang chạy (CHỈ ĐỌC; người duyệt rồi lưu qua PUT /api/measure/utm-links).
import { NextRequest, NextResponse } from "next/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { metaHealth } from "@/lib/measure/meta-health"
import { googleHealth } from "@/lib/measure/google-health"
import { readStandardLinks } from "@/lib/measure/utm-links"
import { suggestStandardLinks, type ObservedLink } from "@/lib/measure/utm-suggest"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  const platform = sp.get("platform") === "google" ? "google" : "facebook"
  try {
    let observed: ObservedLink[]
    if (platform === "facebook") observed = (await metaHealth(co.value)).links.observedLinks ?? []
    else observed = (await googleHealth(co.value)).utm.campaigns.flatMap((c) => (c.urls ?? []).map((url) => ({ url, cost: c.cost / Math.max(1, c.urls.length), campaignName: c.name })))
    const suggestions = suggestStandardLinks(co.value, platform, observed, readStandardLinks().links)
    return NextResponse.json({ success: true, company: co.value, platform, observed: observed.length, suggestions })
  } catch (err) {
    return fail(err)
  }
}
