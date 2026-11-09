// GET /api/playbook/suggest?company=MBI|MBC&platform=facebook|google&product=<mã wizard>
// Đợt 7b — gợi ý từ Sổ kinh nghiệm cho màn tạo chiến dịch. CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { suggestFor } from "@/lib/playbook/suggest"
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  const platform = sp.get("platform") === "google" ? "google" : "facebook"
  const product = (sp.get("product") ?? "").slice(0, 60)
  return NextResponse.json({ success: true, ...suggestFor(co.value, platform, product, await getT()) })
}
