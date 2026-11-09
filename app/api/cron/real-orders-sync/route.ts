// Cron — đơn thật đã thu tiền (Odoo) → Google & Meta (Đợt 16). Nền tảng nào chưa bật thì chỉ đếm, không gửi.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { orderSourceReason } from "@/lib/orders/sources"
import type { Company } from "@/lib/case/types"
import { runRealOrderSync, summarize } from "@/lib/conversions/sync"
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/real_orders_sync")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("real_orders_sync", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const out: string[] = []
    let failed = false
    // Đợt 19-0: mọi công ty đã có nguồn đơn (Odoo / webhook / CSV) — không còn ghim MBI.
    for (const co of companyIds().filter((c) => !orderSourceReason(c))) {
      const r = await runRealOrderSync(co)
      out.push(summarize(r))
      if (r.meta.error || (r.meta.send?.failed ?? 0) > 0) failed = true
    }
    await guard.finish(failed ? "failure" : "success", out.join(" · "), failed ? new Error(out.join(" · ")) : undefined)
    return NextResponse.json({ success: !failed, result: out })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
