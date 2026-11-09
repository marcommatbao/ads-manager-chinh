// ============================================================
// Đợt 21 A2 — Trang / API / job nào thuộc mô-đun nào (dùng được cả máy chủ lẫn trình duyệt).
// ============================================================
// Không có trong bảng = "marketing" (lõi, luôn bật). Chỉ ghi ở đây những thứ THUẦN một mô-đun.
// API DÙNG CHUNG (vd dashboard/unified, analytics/cross-platform, improvements, meta/campaigns, campaigns/[id]/analysis) KHÔNG
// được ghi vào bảng — chúng phục vụ lõi Marketing và tự bỏ phần Odoo khi không có; chặn là hỏng tính năng lõi.
// Khớp theo tiền tố, dòng DÀI NHẤT thắng.

import type { ModuleId } from "./defaults"
import type { JobId } from "@/lib/jobs/types"

export const PAGE_MODULE: [string, ModuleId][] = [
  ["/creative-don-that", "orders"],
  ["/revenue-attribution", "matbao"],
  // Creative Brief gắn danh sách sản phẩm Mắt Bão (enum sản phẩm MBC/MBI) — tạm thuộc gói Mắt Bão tới khi làm lại theo hồ sơ.
  ["/creative/brief", "matbao"],
  // Đợt 21 B: KPI / ngưỡng CPL / ngân sách / doanh thu mục tiêu đang dựng theo cặp MBC–MBI (ô cố định "Doanh thu MBC",
  // "Đơn MBI"…) → thuộc gói Mắt Bão. Bản cài khách chỉ chạy quảng cáo Google + Meta (user 02/10).
  ["/cpl", "matbao"],
  ["/settings/kpi", "matbao"],
  ["/settings/budget", "matbao"],
  ["/settings/revenue", "matbao"],
  ["/settings/cpl-thresholds", "matbao"],
  ["/settings/manual-spend", "matbao"],
]

export const API_MODULE: [string, ModuleId][] = [
  ["/api/orders/", "orders"],
  ["/api/conversions/real-orders", "orders"],
  ["/api/leads/quality", "orders"],
  ["/api/meta/creative-truth", "orders"],
  ["/api/cron/real-orders-sync", "orders"],
  ["/api/cron/lead-quality-upload", "orders"],
  ["/api/creative/brief", "matbao"],
  ["/api/odoo/", "matbao"],
  ["/api/finance/company-pnl", "matbao"],
  ["/api/audiences/offline-customers", "matbao"],
  ["/api/audience/campaign-revenue", "matbao"],
  ["/api/dashboard/kpi-actuals", "matbao"],
  ["/api/dashboard/kpi-analysis", "matbao"],
  ["/api/cpl", "matbao"],
  ["/api/settings/kpi", "matbao"],
  ["/api/settings/budget", "matbao"],
  ["/api/settings/revenue", "matbao"],
  ["/api/settings/manual-spend", "matbao"],
  ["/api/cron/kpi-report", "matbao"],
  ["/api/cron/leads-notify", "matbao"],
  ["/api/cron/orders-notify", "matbao"],
]

export const JOB_MODULE: Partial<Record<JobId, ModuleId>> = {
  real_orders_sync: "orders",
  lead_quality_upload: "orders",
  leads_notify: "matbao",
  orders_notify: "matbao",
  kpi_report: "matbao",
  lead_flow_morning: "matbao",
  lead_flow_watch: "matbao",
}

function longest(table: [string, ModuleId][], path: string): ModuleId | null {
  let best: [string, ModuleId] | null = null
  for (const row of table) if ((path === row[0] || path.startsWith(row[0].endsWith("/") ? row[0] : `${row[0]}`)) && (!best || row[0].length > best[0].length)) best = row
  return best ? best[1] : null
}
/** null = lõi Marketing. */
export const moduleOfPage = (path: string): ModuleId | null => longest(PAGE_MODULE, path)
export const moduleOfApi = (path: string): ModuleId | null => longest(API_MODULE, path)
export const moduleOfJob = (id: string): ModuleId | null => JOB_MODULE[id as JobId] ?? null
/** Đợt 25: job gắn cứng MỘT công ty (gọi endpoint với ?company=…) — bản cài không có công ty đó thì job không thuộc bản cài. */
export const JOB_COMPANY: Partial<Record<JobId, string>> = { quality_score_mbc: "MBC", quality_score_mbi: "MBI" }
export const companyOfJob = (id: string): string | null => JOB_COMPANY[id as JobId] ?? null
