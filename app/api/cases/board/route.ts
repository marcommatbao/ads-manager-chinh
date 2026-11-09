// GET /api/cases/board — mọi phiên của các công ty người dùng được xem (Đợt 4 · C).
import { NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { requireUser } from "@/lib/case/http"
import { caseBoard, remindersEnabled } from "@/lib/case/board"
import { canAccessCompany } from "@/lib/permissions"
import type { Company } from "@/lib/case/types"

export const dynamic = "force-dynamic"

export async function GET() {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const companies = (["MBI", "MBC"] as Company[]).filter((c) => canAccessCompany(u.value, c))
  return NextResponse.json({
    success: true, companies, rows: caseBoard(companies),
    reminders: { enabled: remindersEnabled(), channel: "Microsoft Teams", overdueDays: 3 },
  })
}
