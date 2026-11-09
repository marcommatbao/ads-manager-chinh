// Đợt 21 A6 — POST /api/setup/smoke: tự kiểm ngay (chạy thử các hàm ĐỌC thật trên Google Ads / Meta — không ghi gì lên tài khoản).
// Gọi thẳng runSmoke() (không đi vòng qua /api/jobs/…/trigger — cách đó cần NEXTAUTH_URL đúng, bản cài mới thường chưa có).
import { NextResponse } from "next/server"
import { requireSetupAdmin } from "@/lib/setup/guard"
import { runSmoke } from "@/lib/smoke/run"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST() {
  const g = await requireSetupAdmin()
  if (!g.ok) return g.response
  try {
    const r = await runSmoke()
    return NextResponse.json({ success: true, run: r.run })
  } catch (err) {
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Tự kiểm lỗi") }, { status: 500 })
  }
}
