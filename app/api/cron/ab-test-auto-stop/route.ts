// GET /api/cron/ab-test-auto-stop
// (GET, not POST — docker-entrypoint.sh's crond calls plain `curl` with no
// -X flag, matching the alerts/digest route's convention)
// Daily — scans Facebook ad sets for genuine 2-active-ad A/B pairs, runs a
// real pooled two-proportion z-test on conversion rate (lib/ab-testing-engine.ts),
// and on a statistically significant loser either recommends (default) or
// auto-pauses it, depending on AB_TEST_AUTO_STOP_MODE.
//
// Defaults to "dry_run" — mirrors this app's existing nbaMode dry_run
// convention (lib/nba) rather than silently enabling autonomous ad pausing.
// Set AB_TEST_AUTO_STOP_MODE=auto_apply to let it actually pause the loser
// via the real Meta Graph API (metaPost from lib/automation-engine.ts).
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { scanForAbTests, type ABTestResult } from "@/lib/ab-testing-engine";
import { metaPost } from "@/lib/automation-engine";
import { sendSystemAlert } from "@/lib/system-alert";
import { recordCampaignMutation } from "@/lib/mutation-guard";
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại).

function formatMoney(vnd: number): string {
  return `${Math.round(vnd).toLocaleString("vi-VN")}đ`;
}

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request, "cron/ab_test_auto_stop");
  if (!cronAuth.ok) return cronAuth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";
  const jobGuard = await startJobRun("ab_test_auto_stop", triggeredBy);
  if (jobGuard.blocked) return jobGuard.response;

  const autoApply = process.env.AB_TEST_AUTO_STOP_MODE === "auto_apply";

  try {
    const perCompany = await Promise.all(
      companyIds().map(async (company) => ({ company, scan: await scanForAbTests(company) }))
    );

    const allResults: ABTestResult[] = perCompany.flatMap((c) => c.scan.results);
    const totalPairsEvaluated = perCompany.reduce((s, c) => s + c.scan.adSetPairsEvaluated, 0);
    const totalSkippedNotPair = perCompany.reduce((s, c) => s + c.scan.adSetsSkippedNotPair, 0);
    const totalSkippedInsufficientData = perCompany.reduce((s, c) => s + c.scan.adSetsSkippedInsufficientData, 0);

    const pausedIds: string[] = [];
    const pauseErrors: string[] = [];
    /** Lỗi gửi thông báo — KHÔNG phải lỗi của công việc chính. */
    let notifyWarning: string | null = null;

    if (autoApply) {
      for (const r of allResults) {
        try {
          await metaPost(r.loserId, { status: "PAUSED" });
          pausedIds.push(r.loserId);
          // Đợt 15b: trước đây tự dừng quảng cáo mà KHÔNG ghi dấu vết → không đo lại được.
          recordCampaignMutation({ source: { type: "cron_auto_apply", jobId: "ab_test_auto_stop" }, event: "ab.variant_paused", company: r.company, campaignId: r.campaignId, campaignName: r.campaignName, rationale: r.recommendation, notes: `Tạm dừng quảng cáo thua ${r.loserId} (nhóm ${r.adSetName})`, platform: "meta" });
        } catch (err) {
          pauseErrors.push(`${r.loserId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Đợt 15b: Telegram đã tắt (29/09) — trước đây kết quả (kể cả khi ĐÃ tự dừng quảng cáo) không tới ai. Nay báo Teams.
    if (allResults.length > 0) {
      const sent = await sendSystemAlert({
        level: autoApply && pausedIds.length ? "warning" : "good",
        title: `🧪 A/B test tự dừng — ${allResults.length} kết quả có ý nghĩa thống kê (${autoApply ? "ĐÃ TỰ ÁP" : "chỉ đề xuất"})`,
        facts: allResults.map((r) => {
          const loser = r.variants.find((v) => v.id === r.loserId)!, winner = r.variants.find((v) => v.id === r.winnerId)!
          const act = autoApply ? (pausedIds.includes(r.loserId) ? "✓ Đã tạm dừng quảng cáo thua" : "✕ Tạm dừng thất bại — làm tay") : "Đề xuất tạm dừng (AB_TEST_AUTO_STOP_MODE=dry_run)"
          return { title: `${r.company} · ${r.campaignName} › ${r.adSetName}`, value: `Thua "${loser.name}" (${formatMoney(loser.spend)}) · Thắng "${winner.name}" — ${act}` }
        }),
        action: "Kết quả đo lại 7/14 ngày của lần dừng này: AdsCommand → Đã làm & kết quả.",
      }).catch((e) => ({ sent: false, error: e instanceof Error ? e.message : String(e) }))
      if (!sent.sent) notifyWarning = ("error" in sent && sent.error) || "Không gửi được thông báo Teams"
    }

    const summary =
      `evaluated=${totalPairsEvaluated}, significant=${allResults.length}, ` +
      `skipped_not_pair=${totalSkippedNotPair}, skipped_insufficient=${totalSkippedInsufficientData}, ` +
      `mode=${autoApply ? "auto_apply" : "dry_run"}, paused=${pausedIds.length}` +
      (pauseErrors.length ? `, pause_errors=${pauseErrors.length}` : "");

    await jobGuard.finish(
      // Chỉ pause thất bại mới là failure. Không gửi được thông báo thì công
      // việc vẫn xong — nêu trong summary để người đọc biết mà không hiểu
      // nhầm là job đã không chạy.
      pauseErrors.length ? "failure" : "success",
      notifyWarning ? `${summary} | CẢNH BÁO: không gửi được thông báo (${notifyWarning})` : summary,
      pauseErrors.length ? new Error(pauseErrors.join("; ")) : undefined,
    );

    return NextResponse.json({
      success: true,
      mode: autoApply ? "auto_apply" : "dry_run",
      results: allResults,
      pausedIds,
      pauseErrors,
      adSetPairsEvaluated: totalPairsEvaluated,
      adSetsSkippedNotPair: totalSkippedNotPair,
      adSetsSkippedInsufficientData: totalSkippedInsufficientData,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await jobGuard.finish("failure", null, err);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
