#!/bin/sh
# Generate the crontab at runtime so the internal cron can authenticate with
# CRON_SECRET via the Authorization header (header-only auth is enforced in
# production by lib/cron-auth.ts — query-string/no-auth is rejected).
#
# crond runs as the non-root `nextjs` user, so it reads its crontab from a
# user-writable spool dir (CRON_SPOOL_DIR) via `crond -c`, not the root-owned
# /etc/crontabs.
#
# NOTE: deliberately NO `set -e` — crontab/crond setup must never prevent the
# Next.js server from starting. Cron is best-effort; the web server is critical.

CRON_URL="http://localhost:${PORT:-3000}/api/cron"
LEADS_URL="http://localhost:${PORT:-3000}/api/cron/leads-notify"
ORDERS_URL="http://localhost:${PORT:-3000}/api/cron/orders-notify"
KPI_URL="http://localhost:${PORT:-3000}/api/cron/kpi-report"
DIGEST_URL="http://localhost:${PORT:-3000}/api/alerts/digest"
AB_TEST_URL="http://localhost:${PORT:-3000}/api/cron/ab-test-auto-stop"
IMPROVEMENTS_URL="http://localhost:${PORT:-3000}/api/cron/improvements-auto-apply"
DECISION_MEMORY_URL="http://localhost:${PORT:-3000}/api/cron/decision-memory-eval"
ALERT_SCAN_URL="http://localhost:${PORT:-3000}/api/cron/alert-scan"
POLICY_RADAR_SCAN_URL="http://localhost:${PORT:-3000}/api/cron/policy-radar-scan"
JOB_HEALTH_MONITOR_URL="http://localhost:${PORT:-3000}/api/cron/job-health-monitor"
CASE_REMEASURE_URL="http://localhost:${PORT:-3000}/api/cron/case-remeasure"
# 29/09: nhịp điều phối — gọi mọi job "auto" trong lib/jobs/registry.ts chưa có dòng riêng ở đây (lib/jobs/tick.ts).
TICK_URL="http://localhost:${PORT:-3000}/api/cron/tick"
QS_MBC_URL="http://localhost:${PORT:-3000}/api/google/toolkit/quality-score?company=MBC"
QS_MBI_URL="http://localhost:${PORT:-3000}/api/google/toolkit/quality-score?company=MBI"
SPOOL="${CRON_SPOOL_DIR:-/app/crontabs}"

# Báo cáo KPI cuối ngày. Container chạy giờ UTC → "55 16 * * *" = 23:55 giờ VN.
# Đổi giờ gửi bằng env KPI_REPORT_CRON (UTC), vd "0 15 * * *" = 22:00 VN.
KPI_SCHEDULE="${KPI_REPORT_CRON:-55 16 * * *}"

# Bản tin sức khỏe tài khoản buổi sáng, trước khi mở dashboard. Container
# chạy giờ UTC → "0 1 * * *" = 08:00 giờ VN (khớp lib/jobs/registry.ts).
# Đổi giờ gửi bằng env ALERTS_DIGEST_CRON (UTC).
DIGEST_SCHEDULE="${ALERTS_DIGEST_CRON:-0 1 * * *}"

# A/B Test Auto-Stop — sau digest 30 phút. Container chạy giờ UTC →
# "30 1 * * *" = 08:30 giờ VN (khớp lib/jobs/registry.ts). Mặc định
# dry_run (chỉ đề xuất qua Telegram) — set AB_TEST_AUTO_STOP_MODE=auto_apply
# để tự động pause ad thua thật.
AB_TEST_SCHEDULE="${AB_TEST_AUTO_STOP_CRON:-30 1 * * *}"

# Improvements Auto-Apply — sau A/B Test Auto-Stop 30 phút. Container chạy
# giờ UTC → "0 2 * * *" = 09:00 giờ VN (khớp lib/jobs/registry.ts). Mặc định
# dry_run (chỉ đề xuất qua Telegram) — set IMPROVEMENTS_AUTO_APPLY_MODE=auto_apply
# để tự động áp dụng các Improvement đã đánh dấu canAutoApply.
IMPROVEMENTS_SCHEDULE="${IMPROVEMENTS_AUTO_APPLY_CRON:-0 2 * * *}"

# Decision Memory Evaluator — closes NBA's confidence-learning feedback
# loop (rolls up decision outcomes, prunes expired signals). Was registered
# in lib/jobs/registry.ts with a real route but never actually scheduled —
# wired in 2026-07-13. Container chạy giờ UTC → "0 3 * * *" = 10:00 giờ VN.
DECISION_MEMORY_SCHEDULE="${DECISION_MEMORY_EVAL_CRON:-0 3 * * *}"

# Alert Engine Scan — CPL/spend-spike/zero-conversion/fatigue, + root-cause
# diagnosis for new CPL alerts (lib/root-cause.ts). Was registered in
# lib/jobs/registry.ts with a real route but schedulingStatus: manual_only —
# moved to auto 2026-07-27 by explicit request. Matches registry's
# documented cadence of every 30 min.
ALERT_SCAN_SCHEDULE="${ALERT_SCAN_CRON:-*/30 * * * *}"

# Policy Radar Scan — fetches the 2 auto-fetchable sources (Google Ads
# Policy Help + Dev Blog), diffs vs last snapshot, drafts + files an item
# via Gemini on change, Telegram alert. Requested cadence: Mon + Thu.
# Container chạy giờ UTC → "0 1 * * 1,4" = 08:00 giờ VN.
POLICY_RADAR_SCAN_SCHEDULE="${POLICY_RADAR_SCAN_CRON:-0 1 * * 1,4}"

# Job Health Monitor — canh leads_notify + orders_notify (thẻ Teams lead/đơn
# hàng thời gian thực); báo Teams kênh IT (TEAMS_WEBHOOK_OPS_ALERTS) nếu im
# lặng quá hạn hoặc lần chạy gần nhất lỗi. Dựng sau sự cố hai job đó im 16
# tiếng ngày 17/09/2026 mà không ai biết — xem lib/job-health-alerts.ts.
JOB_HEALTH_MONITOR_SCHEDULE="${JOB_HEALTH_MONITOR_CRON:-*/10 * * * *}"

# Quality Score snapshot — ghi mốc QS mỗi ngày để cột "xu hướng" và cảnh báo
# "QS tụt" trong digest có cái để so. Trước đây 2 job này là manual_only và
# không có dòng cron nào, nên lịch sử chỉ được ghi vào những ngày có người mở
# trang Toolkit. Chạy 07:30 giờ VN = "30 0 * * *" UTC — TRƯỚC digest 08:00 để
# digest so với mốc hôm qua chứ không phải mốc vừa ghi.
QS_SNAPSHOT_SCHEDULE="${QS_SNAPSHOT_CRON:-30 0 * * *}"

# Xử lý chiến dịch — đo lại các phiên tới mốc 7/14 ngày sau khi thực hiện. CHỈ
# ĐỌC Google Ads, ghi kết quả vào data/cases/. 08:00 giờ VN = "0 1 * * *" UTC.
CASE_REMEASURE_SCHEDULE="${CASE_REMEASURE_CRON:-0 1 * * *}"

if [ -n "$CRON_SECRET" ]; then
  CRON_LINE="0 */6 * * * curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${CRON_URL} >> /tmp/cron.log 2>&1"
  LEADS_LINE="*/5 * * * * curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${LEADS_URL} >> /tmp/cron-leads.log 2>&1"
  ORDERS_LINE="*/5 * * * * curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${ORDERS_URL} >> /tmp/cron-orders.log 2>&1"
  KPI_LINE="${KPI_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${KPI_URL} >> /tmp/cron-kpi.log 2>&1"
  DIGEST_LINE="${DIGEST_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${DIGEST_URL} >> /tmp/cron-digest.log 2>&1"
  AB_TEST_LINE="${AB_TEST_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${AB_TEST_URL} >> /tmp/cron-ab-test.log 2>&1"
  IMPROVEMENTS_LINE="${IMPROVEMENTS_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${IMPROVEMENTS_URL} >> /tmp/cron-improvements.log 2>&1"
  DECISION_MEMORY_LINE="${DECISION_MEMORY_SCHEDULE} curl -s -X POST -H \"Authorization: Bearer ${CRON_SECRET}\" ${DECISION_MEMORY_URL} >> /tmp/cron-decision-memory.log 2>&1"
  ALERT_SCAN_LINE="${ALERT_SCAN_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${ALERT_SCAN_URL} >> /tmp/cron-alert-scan.log 2>&1"
  POLICY_RADAR_SCAN_LINE="${POLICY_RADAR_SCAN_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${POLICY_RADAR_SCAN_URL} >> /tmp/cron-policy-radar-scan.log 2>&1"
  QS_MBC_LINE="${QS_SNAPSHOT_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" \"${QS_MBC_URL}\" >> /tmp/cron-qs-snapshot.log 2>&1"
  QS_MBI_LINE="${QS_SNAPSHOT_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" \"${QS_MBI_URL}\" >> /tmp/cron-qs-snapshot.log 2>&1"
  JOB_HEALTH_MONITOR_LINE="${JOB_HEALTH_MONITOR_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${JOB_HEALTH_MONITOR_URL} >> /tmp/cron-job-health-monitor.log 2>&1"
  CASE_REMEASURE_LINE="${CASE_REMEASURE_SCHEDULE} curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${CASE_REMEASURE_URL} >> /tmp/cron-case-remeasure.log 2>&1"
  TICK_LINE="* * * * * curl -s -H \"Authorization: Bearer ${CRON_SECRET}\" ${TICK_URL} >> /tmp/cron-tick.log 2>&1"
else
  CRON_LINE="0 */6 * * * curl -s ${CRON_URL} >> /tmp/cron.log 2>&1"
  LEADS_LINE="*/5 * * * * curl -s ${LEADS_URL} >> /tmp/cron-leads.log 2>&1"
  ORDERS_LINE="*/5 * * * * curl -s ${ORDERS_URL} >> /tmp/cron-orders.log 2>&1"
  KPI_LINE="${KPI_SCHEDULE} curl -s ${KPI_URL} >> /tmp/cron-kpi.log 2>&1"
  DIGEST_LINE="${DIGEST_SCHEDULE} curl -s ${DIGEST_URL} >> /tmp/cron-digest.log 2>&1"
  AB_TEST_LINE="${AB_TEST_SCHEDULE} curl -s ${AB_TEST_URL} >> /tmp/cron-ab-test.log 2>&1"
  IMPROVEMENTS_LINE="${IMPROVEMENTS_SCHEDULE} curl -s ${IMPROVEMENTS_URL} >> /tmp/cron-improvements.log 2>&1"
  DECISION_MEMORY_LINE="${DECISION_MEMORY_SCHEDULE} curl -s -X POST ${DECISION_MEMORY_URL} >> /tmp/cron-decision-memory.log 2>&1"
  ALERT_SCAN_LINE="${ALERT_SCAN_SCHEDULE} curl -s ${ALERT_SCAN_URL} >> /tmp/cron-alert-scan.log 2>&1"
  POLICY_RADAR_SCAN_LINE="${POLICY_RADAR_SCAN_SCHEDULE} curl -s ${POLICY_RADAR_SCAN_URL} >> /tmp/cron-policy-radar-scan.log 2>&1"
  # Không có CRON_SECRET thì snapshot QS không chạy được: route đó xác thực
  # bằng session cookie khi không có Authorization header, mà curl thì không
  # có cookie. Để trống còn hơn tạo dòng cron chắc chắn 401 mỗi ngày.
  QS_MBC_LINE=""
  QS_MBI_LINE=""
  JOB_HEALTH_MONITOR_LINE="${JOB_HEALTH_MONITOR_SCHEDULE} curl -s ${JOB_HEALTH_MONITOR_URL} >> /tmp/cron-job-health-monitor.log 2>&1"
  # Route đo lại bắt buộc checkCronAuth — không có CRON_SECRET thì chắc chắn 401.
  CASE_REMEASURE_LINE=""
  TICK_LINE=""
fi

# 29/09: KPI Report + Alerts Digest gửi qua Telegram — đã NGỪNG (user không dùng Telegram; job retired trong registry).
KPI_LINE=""
DIGEST_LINE=""

# Every 6 hours (0:00, 6:00, 12:00, 18:00). crontab filename must match the
# user crond runs as (busybox crond reads $SPOOL/<username>).
mkdir -p "$SPOOL" 2>/dev/null
# Crontab filename must be "nextjs" so dcron runs the jobs as that user.
if printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$CRON_LINE" "$LEADS_LINE" "$ORDERS_LINE" "$KPI_LINE" "$DIGEST_LINE" "$AB_TEST_LINE" "$IMPROVEMENTS_LINE" "$DECISION_MEMORY_LINE" "$ALERT_SCAN_LINE" "$POLICY_RADAR_SCAN_LINE" "$QS_MBC_LINE" "$QS_MBI_LINE" "$JOB_HEALTH_MONITOR_LINE" "$CASE_REMEASURE_LINE" "$TICK_LINE" | grep -v '^$' > "$SPOOL/nextjs" 2>/dev/null; then
  # crond must run as root — entrypoint starts as root, then drops for node.
  crond -b -l 8 -c "$SPOOL" || \
    echo "[entrypoint] warning: crond failed to start — continuing without cron"
else
  echo "[entrypoint] warning: could not write crontab to $SPOOL — cron disabled"
fi

# Ensure data dir and persistent files are writable by nextjs user.
# Runs as root before su-exec drop — needed when Coolify bind-mounts files
# that are owned by root on the host.
mkdir -p /app/data && chown -R nextjs:nodejs /app/data 2>/dev/null || true

# Force IPv4 DNS resolution — Google's OAuth endpoint (oauth2.googleapis.com)
# fails with "Premature close" over IPv6 in Coolify's container network.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"

# Drop privileges and start Next.js as nextjs user.
exec su-exec nextjs node server.js
