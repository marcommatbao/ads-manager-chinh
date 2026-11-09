// Cron — thí nghiệm vùng PMax (Đợt 10c): đo lại hằng ngày; tới hạn thì TỰ kết thúc (trả tài khoản như cũ) + báo Teams.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runExperimentJob } from "@/lib/pmax/geo-experiment"
import { sendTeamsAlert } from "@/lib/teams-alert"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/pmax_experiments")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("pmax_experiments", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runExperimentJob()
    for (const x of r.filter((y) => y.action.startsWith("kết thúc") || y.action.startsWith("lỗi") || y.action.startsWith("cảnh báo"))) {
      await sendTeamsAlert({
        level: x.action.startsWith("lỗi") ? "danger" : x.action.startsWith("cảnh báo") ? "warning" : "good",
        title: `${x.action.startsWith("lỗi") ? "⚠ Thí nghiệm PMax lỗi" : x.action.startsWith("cảnh báo") ? "⚠ Thí nghiệm PMax: vùng tắt đang mất đơn" : "✓ Thí nghiệm PMax đã kết thúc"} · ${x.company}`,
        facts: [{ title: "Kết quả", value: x.action }],
        action: x.action.startsWith("lỗi") ? "Kiểm tra ngay: AdsCommand → PMax Insights → Thí nghiệm — loại trừ vùng có thể vẫn đang bật." : x.action.startsWith("cảnh báo") ? "Kết thúc sớm: AdsCommand → PMax Insights → Thí nghiệm → Kết thúc ngay (trả tài khoản như cũ trong vài giây)." : "Xem chi tiết: AdsCommand → PMax Insights → Thí nghiệm.",
      }).catch(() => null)
    }
    await guard.finish("success", r.length ? r.map((x) => `${x.company}: ${x.action}`).join(" · ") : "Không có thí nghiệm đang chạy")
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
