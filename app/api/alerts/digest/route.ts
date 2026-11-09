// GET /api/alerts/digest — daily account-health digest → Telegram
// (1 lần/ngày, 08:00 giờ VN via dcron — see docker-entrypoint.sh)
//
// This endpoint was already declared in lib/jobs/registry.ts (id
// "alerts_digest", cron "0 1 * * *" UTC = 08:00 VN) but the route never
// existed. Packages real, already-computed data — getAlerts() (CPA/CPL
// spikes, budget caps, campaign rejections, fatigue) plus a live Quality
// Score drop check — into one Telegram message before the team opens the
// dashboard. No new data pipeline, just a formatter over real sources.
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { getAlerts } from "@/lib/alert-engine";
import { getQualityScoreDropSummary } from "@/lib/quality-score-digest";
import { buildDigestMessage } from "@/lib/alerts-digest-message";
import { sendTelegram } from "@/lib/telegram";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/alerts_digest");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("alerts_digest", triggeredBy);
  if (guard.blocked) return guard.response;

  try {
    const chatId = process.env.TELEGRAM_DIGEST_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error("TELEGRAM_DIGEST_CHAT_ID / TELEGRAM_CHAT_ID chưa cấu hình");

    const [alerts, qsMbc, qsMbi] = await Promise.all([
      getAlerts({ is_resolved: false }),
      getQualityScoreDropSummary("MBC").catch(() => ({ poor: 0, declining: 0, total: 0 })),
      getQualityScoreDropSummary("MBI").catch(() => ({ poor: 0, declining: 0, total: 0 })),
    ]);

    const message = buildDigestMessage(alerts, { MBC: qsMbc, MBI: qsMbi }, new Date());
    const sent = await sendTelegram(chatId, message, "HTML");
    if (!sent.ok) throw new Error(sent.error ?? "Telegram send failed");

    const summary = `Digest sent — ${alerts.length} alerts, QS declining MBC:${qsMbc.declining} MBI:${qsMbi.declining} (msg ${sent.messageId})`;
    await guard.finish("success", summary);
    return NextResponse.json({
      success: true,
      alertsCount: alerts.length,
      qs: { MBC: qsMbc, MBI: qsMbi },
      messageId: sent.messageId,
    });
  } catch (err) {
    await guard.finish("failure", null, err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
