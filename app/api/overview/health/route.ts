// GET /api/overview/health?company=MBI|MBC|ALL&force=1 — Tình trạng & cảnh báo (Đợt 5), CHỈ ĐỌC.
// Gộp các nguồn sẵn có; nguồn hỏng không làm hỏng cả trang.
import { NextRequest, NextResponse } from "next/server"
import { fail, requireUser } from "@/lib/case/http"
import { canAccessCompany } from "@/lib/permissions"
import { healthOverview } from "@/lib/overview/health"
import { getT } from "@/lib/i18n/server"
import type { Company } from "@/lib/case/types"

export const dynamic = "force-dynamic"
export const maxDuration = 180

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const want = sp.get("company") ?? "ALL"
  const allowed = (["MBI", "MBC"] as Company[]).filter((c) => canAccessCompany(u.value, c))
  const companies = want === "ALL" ? allowed : allowed.filter((c) => c === want)
  if (!companies.length) return NextResponse.json({ success: false, error: (await getT())("libcase.r.noCompanyAccess") }, { status: 403 })
  try {
    return NextResponse.json({ success: true, ...(await healthOverview(companies, { force: sp.get("force") === "1", t: await getT() })) })
  } catch (err) {
    return fail(err)
  }
}
