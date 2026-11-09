// Đợt 21 A6 — POST /api/setup/complete: hoàn tất thiết lập → bỏ chuyển hướng /setup, job tự động chạy lại.
// Điều kiện CỨNG: đã lưu công ty (data/companies.json hợp lệ). Khoá / tự kiểm chưa đạt chỉ là cảnh báo ở giao diện.
import { NextResponse } from "next/server"
import { requireSetupAdmin } from "@/lib/setup/guard"
import { markSetupComplete } from "@/lib/setup/state"
import { companiesConfigError } from "@/lib/companies"
import { companiesFileExists } from "@/lib/companies/write"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function POST() {
  const g = await requireSetupAdmin()
  if (!g.ok) return g.response
  if (!companiesFileExists() || companiesConfigError()) {
    return NextResponse.json({ success: false, error: "Chưa lưu công ty hợp lệ (bước 1)" }, { status: 422 })
  }
  const state = markSetupComplete(g.user.email)
  await writeAuditEntry("companies", g.user, "update", "setup-complete", null, state, "ALL")
  return NextResponse.json({ success: true, ...state })
}
