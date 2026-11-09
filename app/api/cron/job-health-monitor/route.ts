// ============================================================
// Cron — Canh leads_notify + orders_notify, báo Teams khi im/lỗi
// GET /api/cron/job-health-monitor  (every 10 minutes via dcron)
//
// leads_notify và orders_notify là đường báo THỜI GIAN THỰC cho sale biết có
// lead/đơn hàng mới (mỗi 5 phút một lần). Ngày 17/09/2026 cả hai đã im lặng
// 16 tiếng (đĩa server đầy) mà không ai biết — /settings/jobs lúc đó không
// có cách nào tự nói ra điều đó, phải có người mở trang mới thấy. Job này là
// lớp canh chủ động: tự đọc lại đúng lịch sử đã ghi (lib/jobs/store.ts, dùng
// chung với /settings/jobs) rồi báo Teams thay vì chờ người phát hiện.
//
// CHỦ Ý chỉ canh đúng 2 job này, không phải mọi job trong registry — đây là
// hai job duy nhất người dùng yêu cầu, và là hai job người vận hành cần biết
// NGAY nếu hỏng (chăm sóc lead/đơn hàng chờ không được).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_JOBS as JOB_REGISTRY } from "@/lib/jobs/registry";
import { missedRun } from "@/lib/jobs/tick";
import { checkCronAuth } from "@/lib/cron-auth";
// Đổi sang sendSystemAlert (24/09): sendTeamsAlert im lặng trả notConfigured
// vì TEAMS_WEBHOOK_OPS_ALERTS chưa hề được đặt trên prod, trong khi Telegram
// thì đang chạy. Xem lib/system-alert.ts.
import { sendSystemAlert, isSystemAlertConfigured, SYSTEM_ALERT_SETUP_HINT } from "@/lib/system-alert";
import { snapshotAllConnectors } from "@/lib/connectors/engine";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { buildJobState } from "@/lib/jobs/state";
import { getJobDescriptor } from "@/lib/jobs/registry";
import { decideAlert, decideConnectorAlert } from "@/lib/job-health-alerts";
import type { JobId, JobState } from "@/lib/jobs/types";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Canh nhiều job hơn. Trước bản này chỉ canh 2 trong số 14 job — nên cả
// google_monitor, nba_engine, kpi_report hỏng cũng không ai biết.
// 29/09 (Đợt 14a): canh MỌI job "auto" — danh sách cứng 7 job + bỏ qua job chưa từng chạy đã giấu 9 job không bao giờ chạy
// (gồm canh đường lead). Thêm "lỡ lịch": lẽ ra chạy (theo cronExpr, sau khi server khởi động) mà không có lần chạy nào.
const WATCHED_JOB_IDS: JobId[] = JOB_REGISTRY.filter((j) => j.schedulingStatus === "auto").map((j) => j.id);
const BOOT_AT = new Date(Date.now() - process.uptime() * 1000);

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "không rõ";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} phút`;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

function relTime(iso: string | null): string {
  if (!iso) return "chưa từng chạy";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (d < 60) return `${d}s trước`;
  if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
  if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
  return `${Math.floor(d / 86400)} ngày trước`;
}

/** Lý do xấu — ưu tiên "im lặng" vì đó là dấu hiệu nặng hơn (job không chạy
 *  được gì cả), so với "lần chạy gần nhất lỗi" (job có chạy, chỉ hỏng bước
 *  nào đó bên trong). */
function badReason(state: JobState): string | null {
  const desc = getJobDescriptor(state.jobId);
  const missed = desc.cronExpr ? missedRun({ cronExpr: desc.cronExpr, maxDurationSec: desc.maxDurationSec, lastRunAt: state.lastRunAt, now: new Date(), bootAt: BOOT_AT }) : null;
  if (missed) {
    return `Lẽ ra chạy lúc ${missed.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} mà ${state.lastRunAt ? "không chạy (lần cuối " + relTime(state.lastRunAt) + ")" : "CHƯA TỪNG chạy"} — lịch không gọi được job.`;
  }
  if (state.isStale) {
    return `Đã im ${fmtDuration(state.staleForMs)} — đáng lẽ chạy mỗi 5 phút.`;
  }
  if (state.lastRun?.status === "failure") {
    return `Lần chạy gần nhất LỖI (${relTime(state.lastRun.startedAt)}): ${state.lastRun.errorSummary ?? "không rõ lý do"}.`;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/job_health_monitor");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("job_health_monitor", triggeredBy);
  if (guard.blocked) return guard.response;

  const startMs = Date.now();

  try {
    const results: Array<{ jobId: JobId; bad: boolean; alerted: boolean; recovery: boolean; reason: string | null }> = [];
    const errors: string[] = [];

    for (const jobId of WATCHED_JOB_IDS) {
      const state = buildJobState(jobId);
      if (!state) continue; // job chưa từng chạy lần nào — không có gì để đánh giá
      // Job đã TẠM DỪNG / tắt bằng cấu hình: không chạy nữa nên lần lỗi cuối không còn là "sự cố" (user 29/09: tắt 2 báo cáo
      // Telegram mà vẫn bị báo lỗi thì tắt vô nghĩa).
      if (!state.enabled) { results.push({ jobId, bad: false, alerted: false, recovery: false, reason: null }); continue }

      const reason = badReason(state);
      const isBadNow = reason !== null;
      const { shouldSend, isRecovery } = decideAlert(jobId, isBadNow);

      let alerted = false;
      if (shouldSend) {
        try {
          const desc = getJobDescriptor(jobId);
          const r = await sendSystemAlert({
            title: isRecovery ? `✅ ${desc.displayName} đã ổn lại` : `🚨 ${desc.displayName} gặp sự cố`,
            level: isRecovery ? "good" : "danger",
            facts: isRecovery
              ? [
                  { title: "Job:", value: jobId },
                  { title: "Lần chạy gần nhất:", value: `${relTime(state.lastRun?.startedAt ?? null)} — ${state.lastRun?.status ?? "?"}` },
                ]
              : [
                  { title: "Job:", value: jobId },
                  { title: "Vấn đề:", value: reason ?? "không rõ" },
                  { title: "Lần chạy thành công gần nhất:", value: relTime(state.lastSuccess?.startedAt ?? null) },
                ],
            action: isRecovery ? undefined : "Mở Settings → Jobs để xem chi tiết.",
          });
          if (!r.sent) throw new Error(r.error ?? "không gửi được");
          alerted = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[job-health-monitor] gửi thẻ Teams cho ${jobId} thất bại: ${msg}`);
          errors.push(`${jobId}: ${msg}`);
        }
      }

      results.push({ jobId, bad: isBadNow, alerted, recovery: isRecovery, reason });
    }

    // ── Kết nối ngoài (Google Ads / Meta / Odoo / GA4…) ──
    //
    // Bản trước chỉ canh job. Nhưng token Google hết hạn hay Odoo đổi mật khẩu
    // thì job vẫn "chạy xong", chỉ là trả về rỗng — không job nào đỏ, không ai
    // được báo, và người dùng phát hiện bằng cách nhìn thấy số 0 trên màn hình.
    const downConnectors: string[] = [];
    const unconfigured: string[] = [];
    try {
      for (const [id, rec] of Object.entries(snapshotAllConnectors())) {
        if (!rec) continue;
        // Tên trạng thái TRA TỪ lib/connectors/types.ts, không đoán. Bản đầu
        // tôi viết "down"/"error" — cả hai đều KHÔNG tồn tại, tsc bắt được.
        // "disabled" là chủ ý tắt, KHÔNG phải hỏng → không báo.

        // "missing_config" CŨNG không phải hỏng: kết nối chưa từng được cấu
        // hình là VIỆC CẦN LÀM MỘT LẦN, không phải sự cố. Trước đây nó bị gộp
        // chung với auth_error nên Slack và SerpApi — hai thứ dự án này không
        // dùng — bị báo lại mỗi 10 phút, vĩnh viễn, vì thiếu env thì không bao
        // giờ tự hết. Vẫn hiện đầy đủ ở Settings → Connectors, chỉ không đẩy
        // thẻ Teams. Muốn tắt hẳn khỏi màn hình thì đặt
        // CONNECTOR_<ID>_DISABLED=1.
        if (rec.status === "missing_config") {
          unconfigured.push(id);
          continue;
        }
        if (rec.status === "auth_error" || rec.status === "service_error") {
          const why = rec.failureReason ? ` (${String(rec.failureReason).slice(0, 80)})` : "";
          downConnectors.push(`${id} — ${rec.status}${why}`);
        }
      }
    } catch (e) {
      errors.push(`đọc sức khoẻ kết nối hỏng: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Chống lặp giống hệt phần canh job: báo khi VỪA hỏng, khi danh sách hỏng
    // ĐỔI, nhắc lại mỗi 2 tiếng, và báo một lần khi hết hỏng. Trước đây phần
    // này gửi thẻ ở MỌI lượt chạy — cron 10 phút/lần nên ~144 thẻ mỗi ngày
    // cho cùng một nội dung, đủ để người nhận tắt chuông và bỏ lỡ lần thật.
    const signature = [...downConnectors].sort().join("|");
    const decision = decideConnectorAlert(signature, downConnectors.length > 0);
    if (decision.shouldSend) {
      const r = decision.isRecovery
        ? await sendSystemAlert({
            title: "🔌 Các kết nối đã ổn lại",
            level: "good",
            facts: [{ title: "Trạng thái:", value: "Không còn kết nối nào ở trạng thái auth_error/service_error." }],
          })
        : await sendSystemAlert({
            title: `🔌 ${downConnectors.length} kết nối đang hỏng`,
            level: "danger",
            facts: downConnectors.slice(0, 6).map((c, i) => ({ title: `#${i + 1}`, value: c })),
            action: "Mở Settings → kiểm tra lại thông tin đăng nhập của các kết nối trên.",
          });
      if (!r.sent && !r.notConfigured) errors.push(`gửi cảnh báo kết nối hỏng: ${r.error}`);
    }

    const summary = results
      .map(r => `${r.jobId}: ${r.bad ? "XẤU" : "ok"}${r.alerted ? (r.recovery ? " (đã báo hồi phục)" : " (đã báo)") : ""}`)
      .join("; ");
    // Log MỌI lượt chạy, không chỉ lượt lỗi — trước đây chỉ console.warn khi
    // gửi Teams thất bại, nên lượt "cả hai job đều ổn, không gửi gì" (kết quả
    // ĐÚNG THIẾT KẾ) không để lại dấu vết nào trong log Coolify để đối chiếu
    // khi người dùng thắc mắc "sao bấm Run mà không thấy thẻ Teams".
    console.log(`[job-health-monitor] ${summary || "(không có job nào để kiểm)"}`);
    await guard.finish(errors.length > 0 ? "failure" : "success", summary, errors[0]);

    // Thiếu webhook KHÔNG phải lỗi lúc chạy — là việc phải làm một lần. Trả
    // hẳn ra ngoài để màn hình Jobs hiện được, thay vì chôn trong console.
    const alertingConfigured = isSystemAlertConfigured();
    if (!alertingConfigured) console.warn(`[job-health-monitor] ${SYSTEM_ALERT_SETUP_HINT}`);

    return NextResponse.json({
      success: true,
      alertingConfigured,
      alertingHint: alertingConfigured ? undefined : SYSTEM_ALERT_SETUP_HINT,
      connectorsDown: downConnectors,
      // Chưa cấu hình — liệt kê ra để màn hình Jobs vẫn thấy được, nhưng
      // KHÔNG đẩy thẻ Teams.
      connectorsUnconfigured: unconfigured,
      connectorAlertSent: decision.shouldSend,
      results,
      errors: errors.length ? errors : undefined,
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
