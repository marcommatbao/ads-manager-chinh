// ============================================================
// Cron — Báo cáo KPI marketing cuối ngày → Telegram (baocaokpimkt_bot)
// GET /api/cron/kpi-report  (1 lần/ngày, mặc định 21:00 giờ VN via dcron)
//
// Lấy Company P&L tháng hiện tại (tích lũy tới hôm nay) + mục tiêu KPI tháng,
// định dạng giống dashboard "Hiệu quả chi phí theo công ty" (MBC + MBI),
// gửi tới chat cấu hình qua bot KPI riêng.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { getCompanyPnl } from "@/lib/finance/company-pnl";
import { getEffectiveMonthKpi } from "@/lib/settings/kpi-store";
import { buildKpiReportMessage } from "@/lib/finance/kpi-report";
import { sendTelegramVia } from "@/lib/telegram";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/kpi_report");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("kpi_report", triggeredBy);
  if (guard.blocked) return guard.response;

  const startMs = Date.now();

  try {
    const botToken = process.env.TELEGRAM_KPI_BOT_TOKEN; // preflight đã bảo đảm có
    // Chat riêng cho báo cáo KPI; fallback chat mặc định nếu chưa cấu hình riêng.
    const chatId = process.env.TELEGRAM_KPI_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error("TELEGRAM_KPI_CHAT_ID / TELEGRAM_CHAT_ID chưa cấu hình");

    // Tháng hiện tại, tích lũy tới hôm nay (giống dashboard).
    const pnl = await getCompanyPnl("");
    const [year, month] = pnl.month.split("-").map(Number);
    const kpi = getEffectiveMonthKpi(year, month); // 12/10: trần gồm khoản chi bổ sung

    const message = buildKpiReportMessage(pnl, kpi, new Date());
    const sent = await sendTelegramVia(botToken!, chatId, message, "HTML");
    if (!sent.ok) throw new Error(sent.error ?? "Telegram send failed");

    const summary = `KPI ${pnl.month} sent (msg ${sent.messageId})`;
    await guard.finish("success", summary);
    return NextResponse.json({
      success: true,
      month: pnl.month,
      messageId: sent.messageId,
      duration: Date.now() - startMs,
    });
  } catch (err) {
    await guard.finish("failure", null, err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
