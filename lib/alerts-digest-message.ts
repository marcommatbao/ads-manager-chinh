// ============================================================
// Daily alerts digest — Telegram message formatter.
// Pure function (no I/O) → easy to test, mirrors the style already
// established by lib/finance/kpi-report.ts (HTML parse mode, VN number
// formatting, emoji section markers).
// ============================================================

import type { Alert } from "@/lib/alert-rules";
import type { QSDropSummary } from "@/lib/quality-score-digest";

const nf = new Intl.NumberFormat("vi-VN");
const vnd = (v: number): string => `${nf.format(Math.round(v || 0))}đ`;

function nowIct(now: Date): string {
  return now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const CPA_TYPES = new Set(["cpl_critical", "cpl_warning", "high_cpc"]);
const BUDGET_TYPES = new Set(["budget_low", "budget_depleted"]);
const REJECTED_TYPES = new Set(["campaign_rejected"]);
const FATIGUE_TYPES = new Set(["fatigue_critical", "fatigue_warning"]);

// Telegram parse_mode "HTML" rejects unescaped &/</> in entity text — campaign
// names/messages are user/platform-controlled (e.g. "Hosting & Domain") and
// were breaking sendMessage with "can't parse entities" before this escape.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(title: string, emoji: string, alerts: Alert[]): string {
  if (alerts.length === 0) return `${emoji} <b>${title}</b>: không có\n`;
  const lines = alerts
    .slice(0, 5)
    .map(a => `   • [${escapeHtml(a.company)}] ${escapeHtml(a.campaign_name || a.message)} — ${escapeHtml(a.message)}`);
  const more = alerts.length > 5 ? `\n   … và ${alerts.length - 5} campaign khác` : "";
  return `${emoji} <b>${title}</b> (${alerts.length}):\n${lines.join("\n")}${more}\n`;
}

export function buildDigestMessage(
  alerts: Alert[],
  qs: Record<string, QSDropSummary>,
  now: Date
): string {
  const cpa = alerts.filter(a => CPA_TYPES.has(a.type));
  const budget = alerts.filter(a => BUDGET_TYPES.has(a.type));
  const rejected = alerts.filter(a => REJECTED_TYPES.has(a.type));
  const fatigue = alerts.filter(a => FATIGUE_TYPES.has(a.type));

  const totalSpendAtRisk = [...cpa, ...budget]
    .reduce((s, a) => s + (a.metadata?.spend ?? 0), 0);

  const qsTotalPoor = qs.MBC.poor + qs.MBI.poor;
  const qsTotalDeclining = qs.MBC.declining + qs.MBI.declining;

  const lines: string[] = [
    `📋 <b>Bản tin sức khỏe tài khoản</b> — ${nowIct(now)}`,
    "",
    section("CPA/CPC vượt ngưỡng", "🚨", cpa),
    section("Ngân sách sắp/đã hết", "💰", budget),
    section("Campaign bị từ chối", "⛔", rejected),
    section("Creative bão hòa (fatigue)", "😴", fatigue),
  ];

  lines.push(
    `📉 <b>Quality Score giảm</b>: MBC ${qs.MBC.declining}/${qs.MBC.total} từ khóa, MBI ${qs.MBI.declining}/${qs.MBI.total} từ khóa` +
    (qsTotalDeclining > 0 ? " ⚠️" : " ✅"),
    `🔴 <b>Quality Score kém (&lt;4)</b>: MBC ${qs.MBC.poor}, MBI ${qs.MBI.poor}` +
    (qsTotalPoor > 0 ? " ⚠️" : " ✅"),
  );

  if (totalSpendAtRisk > 0) {
    lines.push("", `💸 Tổng chi tiêu đang ở campaign có vấn đề: <b>${vnd(totalSpendAtRisk)}</b>`);
  }

  const totalIssues = cpa.length + budget.length + rejected.length + fatigue.length + qsTotalDeclining + qsTotalPoor;
  if (totalIssues === 0) {
    lines.push("", "✅ Không có vấn đề gì nổi bật hôm nay — tài khoản đang ổn định.");
  }

  return lines.join("\n");
}
