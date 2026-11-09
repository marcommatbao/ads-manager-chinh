// Đợt 21 A3b — GET /api/creative/brand?company=… : danh mục sản phẩm + thương hiệu cho trang Creative AI (theo hồ sơ của
// công ty; công ty gói Mắt Bão trả `legacy: true` → trang dùng danh sách cũ). Không có khoá / bí mật nào.
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { creativeBrandFor } from "@/lib/brand/creative"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const c = requireCompany(u.value, req.nextUrl.searchParams.get("company"))
  if (!c.ok) return c.response
  return NextResponse.json({ success: true, data: creativeBrandFor(c.value) })
}
