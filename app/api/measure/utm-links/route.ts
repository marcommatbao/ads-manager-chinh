// GET /api/measure/utm-links — bảng link chuẩn utm (Facebook)
// PUT /api/measure/utm-links {links:[{label,url}]} — cần can_edit_thresholds
// Link nhập TAY theo quy ước của user; tool chỉ so + gợi ý, không tự đặt tên.
import { NextRequest, NextResponse } from "next/server"
import { actorOf, requireUser } from "@/lib/case/http"
import { readStandardLinks, validateStandardLinks, writeStandardLinks, REQUIRED_MEDIUM, REQUIRED_SOURCE, type StandardLink } from "@/lib/measure/utm-links"

export const dynamic = "force-dynamic"

export async function GET() {
  const u = await requireUser()
  if (!u.ok) return u.response
  return NextResponse.json({ success: true, ...readStandardLinks(), rules: { source: REQUIRED_SOURCE, medium: REQUIRED_MEDIUM } })
}

export async function PUT(request: NextRequest) {
  const u = await requireUser("can_edit_thresholds")
  if (!u.ok) return u.response
  const body = (await request.json().catch(() => ({}))) as { links?: unknown }
  const err = validateStandardLinks(body.links)
  if (err) return NextResponse.json({ success: false, error: err }, { status: 400 })
  writeStandardLinks(body.links as StandardLink[], actorOf(u.value))
  return NextResponse.json({ success: true, ...readStandardLinks() })
}
