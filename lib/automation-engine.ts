// ============================================================
// AdsCommand — Automation Engine
// Rule-based campaign automation with condition evaluation
// ============================================================

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { metaClient, type MetaCampaignRaw } from "@/lib/meta-client";
import { detectCompany } from "./company-detect";
import {
  fetchGoogleCampaigns, fetchGoogleMetrics, executeGoogleAction, checkLearningGuardGoogle,
  type GoogleEngineCampaign,
} from "./automation-google";
import { withFileLock } from "./file-lock";
import { checkRecentCampaignMutation, recordCampaignMutation } from "./mutation-guard";
import { hasOpenCase } from "./case/store";
import { ensureBaseline, clampBudgetChange } from "./automation-meta-baseline";
import { writeFileAtomicSync, writeFileAtomic } from "@/lib/fs-atomic";
import {
  MetricKey, ConditionOperator, TimeWindow, ActionType, CheckInterval,
  Condition, Action, AutomationRule, CampaignMetrics, RuleExecutionResult,
  PREBUILT_RULES, sanitizeGoogleChannelTypes
} from "./automation-shared";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export * from "./automation-shared";

// ─────────────────────────────────────────────
// File Storage (JSON DB)
// ─────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), "data", "automation-data.json");

interface AutomationDB {
  rules: AutomationRule[];
  executionLog: RuleExecutionResult[];
}

function readDB(): AutomationDB {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { rules: [], executionLog: [] };
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw) as AutomationDB;
  } catch {
    return { rules: [], executionLog: [] };
  }
}

function writeDB(db: AutomationDB): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function generateId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────
// Learning Phase Guard — safe-default helper
// ─────────────────────────────────────────────

/** Actions that should NOT fire during learning phase. Declared here (rather
 * than only down near checkLearningGuard) so createRule/updateRule can also
 * use it to safe-default respectLearningPhase before that guard ever runs. */
const LEARNING_GUARDED_ACTIONS: ActionType[] = [
  "pause_campaign",
  "decrease_budget",
];

function hasGuardedAction(actions: Action[]): boolean {
  return actions.some(a => LEARNING_GUARDED_ACTIONS.includes(a.type));
}

/** The rule builder's save payload (app/(dashboard)/automation/page.tsx) never
 * sets respectLearningPhase — even when built from a prebuilt template whose
 * definition has it set to true — because the field isn't carried into the
 * form's component state. Rather than patch that UI (and risk missing future
 * callers of this same API), default it here at the single choke point all
 * rule creation/edits pass through: any rule carrying a destructive action
 * (pause_campaign/decrease_budget) gets respectLearningPhase defaulted to
 * true unless a caller explicitly set it (including explicit `false`, which
 * stays an honored opt-out for whenever a UI toggle for this exists). */
function withLearningGuardDefault(rule: AutomationRule): AutomationRule {
  if (rule.respectLearningPhase === undefined && hasGuardedAction(rule.actions)) {
    return { ...rule, respectLearningPhase: true };
  }
  return rule;
}

// ─────────────────────────────────────────────
// Rule CRUD
// ─────────────────────────────────────────────

export function getAllRules(): AutomationRule[] {
  return readDB().rules;
}

export function getActiveRules(): AutomationRule[] {
  return readDB().rules.filter(r => r.isActive);
}

export function getRuleById(id: string): AutomationRule | undefined {
  return readDB().rules.find(r => r.id === id);
}

export function createRule(input: Omit<AutomationRule, "id" | "createdAt" | "triggerCount">): AutomationRule {
  const db = readDB();
  const rule: AutomationRule = withLearningGuardDefault({
    ...input,
    // Đợt 10b — lọc về đúng 5 giá trị hợp lệ; client gửi rác/lạ thì rơi hết,
    // không để lọt vào rule đang tự động chạy trên campaign thật.
    ...(input.googleChannelTypes !== undefined ? { googleChannelTypes: sanitizeGoogleChannelTypes(input.googleChannelTypes) } : {}),
    id: generateId(),
    triggerCount: 0,
    createdAt: new Date().toISOString(),
  });
  db.rules.push(rule);
  writeDB(db);
  return rule;
}

export function updateRule(id: string, updates: Partial<AutomationRule>): AutomationRule | null {
  const db = readDB();
  const idx = db.rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const u = { ...updates, ...(updates.googleChannelTypes !== undefined ? { googleChannelTypes: sanitizeGoogleChannelTypes(updates.googleChannelTypes) } : {}) };
  db.rules[idx] = withLearningGuardDefault({ ...db.rules[idx], ...u, id }); // prevent id override
  writeDB(db);
  return db.rules[idx];
}

export function deleteRule(id: string): boolean {
  const db = readDB();
  const before = db.rules.length;
  db.rules = db.rules.filter(r => r.id !== id);
  if (db.rules.length < before) {
    writeDB(db);
    return true;
  }
  return false;
}

export function toggleRule(id: string): AutomationRule | null {
  const db = readDB();
  const rule = db.rules.find(r => r.id === id);
  if (!rule) return null;
  rule.isActive = !rule.isActive;
  writeDB(db);
  return rule;
}

export function getExecutionLog(): RuleExecutionResult[] {
  return readDB().executionLog.slice(-100); // last 100
}

// Initialize with prebuilt rules
export function initPrebuiltRules(): void {
  const db = readDB();
  if (db.rules.length > 0) return; // already initialized
  for (const template of PREBUILT_RULES) {
    db.rules.push({
      ...template,
      id: generateId(),
      triggerCount: 0,
      createdAt: new Date().toISOString(),
    });
  }
  writeDB(db);
}

// Auto-init
initPrebuiltRules();

// ─────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDateRange(tw: TimeWindow): { from: string; to: string } {
  const now = new Date();
  const today = dateStr(now);

  switch (tw) {
    case "today":
      return { from: today, to: today };
    case "last_3d": {
      const d = new Date(now.getTime() - 3 * 86400000);
      return { from: dateStr(d), to: today };
    }
    case "last_7d": {
      const d = new Date(now.getTime() - 7 * 86400000);
      return { from: dateStr(d), to: today };
    }
    case "this_month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: dateStr(first), to: today };
    }
  }
}

/** The period immediately preceding getDateRange(tw), same duration — used
 * to compute real increased_by_pct/decreased_by_pct comparisons instead of
 * the placeholder that just compared the current value against a flat
 * threshold. */
function getPreviousDateRange(tw: TimeWindow): { from: string; to: string } {
  const now = new Date();

  switch (tw) {
    case "today": {
      const d = new Date(now.getTime() - 86400000);
      return { from: dateStr(d), to: dateStr(d) };
    }
    case "last_3d": {
      const to = new Date(now.getTime() - 3 * 86400000);
      const from = new Date(now.getTime() - 6 * 86400000);
      return { from: dateStr(from), to: dateStr(to) };
    }
    case "last_7d": {
      const to = new Date(now.getTime() - 7 * 86400000);
      const from = new Date(now.getTime() - 14 * 86400000);
      return { from: dateStr(from), to: dateStr(to) };
    }
    case "this_month": {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
      const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
      return { from: dateStr(firstOfPrevMonth), to: dateStr(lastOfPrevMonth) };
    }
  }
}

// ─────────────────────────────────────────────
// Metrics extraction from Meta API data
// ─────────────────────────────────────────────

interface RawInsight {
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }> | null;
  action_values?: Array<{ action_type: string; value: string }> | null;
}

function extractMetrics(raw: RawInsight, dailyBudget?: number): CampaignMetrics {
  const spend = parseFloat(raw.spend ?? "0");
  const conversions = raw.actions
    ?.filter(a => ["purchase", "lead", "complete_registration", "offsite_conversion"].includes(a.action_type))
    .reduce((sum, a) => sum + parseFloat(a.value), 0) ?? 0;

  // Meta chỉ trả `action_values` khi chiến dịch CÓ tín hiệu doanh thu. Không có
  // mảng đó, hoặc không có dòng purchase nào trong đó, nghĩa là doanh thu CHƯA
  // ĐO ĐƯỢC — không phải bằng không. Phân biệt hai thứ này là chốt an toàn duy
  // nhất giữa chiến dịch lead-gen và luật `roas < 0.8 → pause_campaign`.
  const revenueRows = raw.action_values
    ?.filter(a => ["purchase", "offsite_conversion"].includes(a.action_type)) ?? [];
  const conversionValue = revenueRows.reduce((sum, a) => sum + parseFloat(a.value), 0);
  const revenueMeasurable = revenueRows.length > 0;

  const roas = revenueMeasurable && spend > 0 ? conversionValue / spend : null;
  const budgetPct = dailyBudget && dailyBudget > 0 ? (spend / dailyBudget) * 100 : 0;

  const ctr = parseFloat(raw.ctr ?? "0");
  return {
    ctr,
    cpc: parseFloat(raw.cpc ?? "0"),
    cpm: parseFloat(raw.cpm ?? "0"),
    roas,
    spend,
    impressions: parseInt(raw.impressions ?? "0", 10),
    frequency: parseFloat(raw.frequency ?? "0"),
    budget_used_pct: budgetPct,
    conversions,
    cpl: conversions > 0 ? spend / conversions : 0,
    ctr_drop_pct: 0,       // requires period comparison — not available here
    days_running: 0,        // requires campaign start date — not available here
    remaining_budget: dailyBudget ? dailyBudget - spend : 0,
    days_until_end: 0,      // requires end date — not available here
    end_date_is_set: 0,     // requires end date — not available here
  };
}

// ─────────────────────────────────────────────
// Condition evaluator
// ─────────────────────────────────────────────

function evaluateCondition(cond: Condition, metrics: CampaignMetrics, previousMetrics?: CampaignMetrics): boolean {
  const actual = metrics[cond.metric];
  if (actual === undefined || actual === null) return false;

  switch (cond.operator) {
    case ">":  return actual > cond.value;
    case "<":  return actual < cond.value;
    case ">=": return actual >= cond.value;
    case "<=": return actual <= cond.value;
    case "==": return Math.abs(actual - cond.value) < 0.001;
    case "increased_by_pct":
    case "decreased_by_pct": {
      // Real period-over-period comparison — cond.value is the % change
      // threshold (e.g. 40 for "cpc increased_by_pct 40" = CPC up >40% vs
      // the immediately preceding period of the same length). Previously
      // this compared the raw metric value against the threshold as if it
      // were a plain ">"/"<" — a rule like "cpc increased_by_pct 40" would
      // fire whenever cpc > 40 (a nonsensical currency comparison), not
      // when it actually rose 40%.
      const previous = previousMetrics?.[cond.metric];
      if (previous === undefined || previous === null || previous === 0) return false;
      const pctChange = ((actual - previous) / Math.abs(previous)) * 100;
      return cond.operator === "increased_by_pct"
        ? pctChange > cond.value
        : pctChange < -cond.value;
    }
  }
}

export function evaluateConditions(
  conditions: Condition[],
  logic: "AND" | "OR",
  metrics: CampaignMetrics,
  previousMetrics?: CampaignMetrics
): boolean {
  if (conditions.length === 0) return false;

  return logic === "AND"
    ? conditions.every(c => evaluateCondition(c, metrics, previousMetrics))
    : conditions.some(c => evaluateCondition(c, metrics, previousMetrics));
}

// ─────────────────────────────────────────────
// Cooldown check
// ─────────────────────────────────────────────

const CHECK_INTERVAL_MS: Record<CheckInterval, number> = {
  "15min": 15 * 60000,
  "1hour": 3600000,
  "6hour": 6 * 3600000,
  "daily": 86400000,
};

function shouldRunRule(rule: AutomationRule): boolean {
  if (!rule.isActive) return false;

  // checkInterval gates how often conditions are re-evaluated at all,
  // independent of whether the rule has ever fired. Previously this field
  // was purely cosmetic — shouldRunRule only ever checked `cooldown` (which
  // only applies AFTER a firing), so a rule's configured "Kiểm tra mỗi: X"
  // had zero real effect. This is still bounded by how often the engine
  // itself actually runs (Docker cron, every 6h) — a "15 phút" rule can't
  // check more often than that, but it will no longer silently ignore its
  // own setting when the engine does run.
  if (rule.lastCheckedAt) {
    const sinceCheck = Date.now() - new Date(rule.lastCheckedAt).getTime();
    if (sinceCheck < CHECK_INTERVAL_MS[rule.checkInterval]) return false;
  }

  if (!rule.lastTriggered) return true;

  const lastRun = new Date(rule.lastTriggered).getTime();
  const cooldownMs = rule.cooldown * 3600000;
  return Date.now() - lastRun > cooldownMs;
}

// ─────────────────────────────────────────────
// Notification writer — push into alerts.json
// ─────────────────────────────────────────────

const ALERTS_FILE = path.join(process.cwd(), "data", "alerts.json");

async function pushNotification(campaign: MetaCampaignRaw, ruleName: string, message: string): Promise<void> {
  try {
    let alerts: unknown[] = [];
    try {
      const raw = await fsPromises.readFile(ALERTS_FILE, "utf-8");
      alerts = JSON.parse(raw) as unknown[];
    } catch { /* file may not exist yet */ }

    alerts.push({
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: "automation_rule",
      severity: "warning",
      campaign_id: campaign.id ?? "",
      campaign_name: campaign.name ?? "Unknown",
      company: "MBC",
      message: `[Automation] ${ruleName}: ${message}`,
      metadata: {},
      is_read: false,
      is_resolved: false,
      created_at: new Date().toISOString(),
    });

    // Keep last 500 alerts
    if (alerts.length > 500) alerts = alerts.slice(-500);
    await writeFileAtomic(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  } catch (e) {
    console.error("[Automation] Failed to write notification:", e);
  }
}

// ─────────────────────────────────────────────
// Meta API helpers for real campaign mutations
// ─────────────────────────────────────────────

const META_BASE = META_GRAPH_BASE;

// Generic /{objectId} POST — works for campaigns, adsets, and ads alike
// (Meta Graph API uses the same `status` field on all three), so this is
// exported for reuse by other real-mutation code paths (e.g. ab-test-engine.ts
// pausing a single losing ad) instead of duplicating the fetch call.
export async function metaPost(campaignId: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");

  const res = await fetch(`${META_BASE}/${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json() as { error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
}

// Trả về ngân sách thật, hoặc NÉM LỖI. Bản cũ trả {daily: 0} khi thiếu token hoặc
// khi Graph API trả lỗi — engine đọc 0 rồi lặng lẽ bỏ qua, trong khi nhật ký thi
// hành vẫn ghi "increase_budget" như đã chạy. Không đọc được ngân sách và campaign
// không có ngân sách cấp campaign là hai chuyện khác nhau, phải phân biệt được.
async function getCampaignBudget(campaignId: string): Promise<{ daily: number; lifetime: number }> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN chưa cấu hình");
  const res = await fetch(`${META_BASE}/${campaignId}?fields=daily_budget,lifetime_budget&access_token=${token}`);
  const data = await res.json() as { daily_budget?: string; lifetime_budget?: string; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "Graph API trả lỗi khi đọc ngân sách");
  return {
    daily: parseFloat(data.daily_budget ?? "0") || 0,
    lifetime: parseFloat(data.lifetime_budget ?? "0") || 0,
  };
}

// ─────────────────────────────────────────────
// Action executor — real API + UI notifications
// ─────────────────────────────────────────────

/** Việc đã làm thật, hay đã bỏ qua và vì sao. Nhật ký thi hành dựa vào đây để
 *  không ghi một hành động chưa từng xảy ra như đã xảy ra. */
export interface ActionOutcome {
  executed: boolean;
  skipReason?: string;
}

/** Những hành động chạm thật vào tài khoản — phải qua cổng chặn xung đột.
 *  Giữ trùng khít với MUTATION_ACTIONS của nhánh Google. */
const META_MUTATION_ACTIONS = new Set([
  "pause_campaign", "activate_campaign", "increase_budget", "decrease_budget",
]);

async function executeAction(
  action: Action,
  campaign: MetaCampaignRaw,
  ruleId: string,
  ruleName: string,
  company: string,
): Promise<ActionOutcome> {
  const id = campaign.id ?? "";
  const name = campaign.name ?? "Unknown";

  // Chặn xung đột: hệ thống tự động khác (NBA auto-apply, auto-apply cải thiện,
  // người bấm tay) vừa sửa campaign này thì dừng, đừng đẩy chồng lên nhau.
  // Nhánh Google đã làm việc này từ lâu; nhánh Facebook thì chưa.
  if (META_MUTATION_ACTIONS.has(action.type)) {
    const recent = checkRecentCampaignMutation(id, company, "automation_rule");
    if (recent.hasConflict) {
      const why = recent.note ?? "Campaign vừa được hệ thống khác sửa";
      console.log(`[Automation] Bỏ qua "${name}" — ${why}`);
      await pushNotification(campaign, ruleName, `Bỏ qua hành động — ${why}`);
      return { executed: false, skipReason: why };
    }
  }

  switch (action.type) {
    case "pause_campaign":
    case "activate_campaign": {
      const pausing = action.type === "pause_campaign";
      await metaPost(id, { status: pausing ? "PAUSED" : "ACTIVE" });
      const msg = pausing
        ? `Đã PAUSE campaign "${name}" — điều kiện rule đã khớp.`
        : `Đã kích hoạt lại campaign "${name}".`;
      console.log(`[Automation] ${pausing ? "🛑" : "▶️"} ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      recordCampaignMutation({
        source: { type: "automation_rule", ruleId, ruleName, platform: "facebook" },
        platform: "meta",
        event: pausing ? "campaign.pause" : "campaign.resume",
        company, campaignId: id, campaignName: name,
        rationale: msg,
      });
      return { executed: true };
    }
    case "increase_budget":
    case "decrease_budget": {
      const up = action.type === "increase_budget";
      const pct = action.value ?? 20;

      // Phiên "Xử lý chiến dịch" đang mở → luật không tự TĂNG tiền (user chốt
      // 27/09). Giảm vẫn cho: đó là hướng an toàn.
      if (up && hasOpenCase(id)) {
        const why = "Chiến dịch đang có phiên xử lý mở — luật không tự tăng ngân sách";
        console.log(`[Automation] Bỏ qua "${name}" — ${why}`);
        return { executed: false, skipReason: why };
      }

      // Đọc ngân sách: ném lỗi thì để vòng ngoài bắt và ghi đúng là THẤT BẠI,
      // không lặng lẽ coi như campaign không có ngân sách.
      const budget = await getCampaignBudget(id);

      // daily_budget = 0 nghĩa là ngân sách nằm ở cấp adset (không bật CBO).
      // Ghi ngân sách cấp campaign lúc này sẽ đổi cả cấu trúc campaign — đúng
      // như nhánh Google bỏ qua shared budget vì "nguy hiểm khi tự đổi".
      if (budget.daily <= 0) {
        const why = "Ngân sách nằm ở cấp adset (không bật CBO) — rule không tự đổi ngân sách cấp campaign";
        console.log(`[Automation] Bỏ qua "${name}" — ${why}`);
        return { executed: false, skipReason: why };
      }

      const baseline = ensureBaseline(id, name, budget.daily, ruleName);
      const clamped = clampBudgetChange(budget.daily, baseline, pct, up ? 1 : -1);
      if (!clamped.meaningful) {
        console.log(`[Automation] Bỏ qua "${name}" — ${clamped.reason}`);
        return { executed: false, skipReason: clamped.reason ?? "Không đáng một lần đổi" };
      }

      await metaPost(id, { daily_budget: String(clamped.newVnd) });
      const msg = `Đã ${up ? "tăng" : "giảm"} daily budget của "${name}" ${pct}% `
        + `(${budget.daily.toLocaleString("vi-VN")}₫ → ${clamped.newVnd.toLocaleString("vi-VN")}₫; `
        + `mốc gốc ${baseline.toLocaleString("vi-VN")}₫, cho phép 50%–300%).`;
      console.log(`[Automation] ${up ? "📈" : "📉"} ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      recordCampaignMutation({
        source: { type: "automation_rule", ruleId, ruleName, platform: "facebook" },
        platform: "meta",
        event: clamped.newVnd > budget.daily ? "budget.increase" : "budget.decrease",
        company, campaignId: id, campaignName: name,
        rationale: msg,
      });
      return { executed: true };
    }
    case "send_notification": {
      const msg = action.message
        ? `${action.message} — Campaign: "${name}"`
        : `Rule "${ruleName}" đã khớp với campaign "${name}".`;
      console.log(`[Automation] 🔔 ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      return { executed: true };
    }
    case "send_email":
      // Chưa có SMTP: đẩy vào chuông thông báo trong app chứ không gửi mail.
      console.log(`[Automation] 📧 EMAIL (chưa cấu hình SMTP): ${action.message} — "${name}"`);
      await pushNotification(campaign, ruleName, `[Email] ${action.message ?? ""} — Campaign: "${name}"`);
      return { executed: false, skipReason: "Chưa cấu hình SMTP — đã đẩy vào thông báo trong app thay cho email" };
    case "send_webhook":
      console.log(`[Automation] 🌐 WEBHOOK (chưa cấu hình endpoint) — "${name}"`);
      return { executed: false, skipReason: "Chưa cấu hình endpoint webhook" };
    case "add_to_report":
      console.log(`[Automation] 📊 Added to report: "${name}"`);
      await pushNotification(campaign, ruleName, `Ghi nhận "${name}" khớp điều kiện — chưa có báo cáo tự tổng hợp, xem ở Lịch sử thực thi.`);
      return { executed: true };
    case "request_ai_evaluation":
      console.log(`[Automation] 🔎 Đánh dấu để xem lại: "${name}" (không gọi AI)`);
      await pushNotification(campaign, ruleName, `Đã đánh dấu campaign "${name}" để xem lại — chưa có AI tự đánh giá, cần người mở xem.`);
      return { executed: true };
  }
  return { executed: false, skipReason: `Hành động "${action.type}" chưa được cài đặt` };
}

// ─────────────────────────────────────────────
// Learning Phase Guard
// ─────────────────────────────────────────────
// (LEARNING_GUARDED_ACTIONS / hasGuardedAction are declared earlier in this
// file, alongside the Rule CRUD helpers that also need them.)

interface LearningGuardResult {
  skip: boolean;
  reason?: string;
}

function checkLearningGuard(
  rule: AutomationRule,
  campaign: MetaCampaignRaw,
  metrics: CampaignMetrics
): LearningGuardResult {
  if (!hasGuardedAction(rule.actions)) return { skip: false };

  // Any rule with a destructive action (pause_campaign/decrease_budget) is
  // guarded by default — matches withLearningGuardDefault() at create/update
  // time. Checked again here (not just at write-time) so rules that already
  // existed in data/automation-data.json before this fix are protected too,
  // without needing a migration script. `false` is the only way to opt out.
  if (rule.respectLearningPhase === false) return { skip: false };

  const createdTime = campaign.created_time || campaign.start_time;
  if (!createdTime) return { skip: false };

  const ageMs = Date.now() - new Date(createdTime).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  const conversionsThisWeek = metrics.conversions ?? 0;

  const isInLearning = ageDays < 7 || conversionsThisWeek < 50;

  if (isInLearning) {
    const phase = ageDays < 7 ? "learning" : "learning_limited";
    return {
      skip: true,
      reason: `Campaign đang trong ${phase === "learning" ? "learning phase" : "learning limited"} `
        + `(${ageDays} ngày tuổi, ${conversionsThisWeek} conversions/tuần). `
        + `Rule sẽ được áp dụng sau khi campaign thoát learning phase.`,
    };
  }

  return { skip: false };
}

// ─────────────────────────────────────────────
// Main Engine
// ─────────────────────────────────────────────

export async function runAutomationEngine(): Promise<RuleExecutionResult[]> {
  return withFileLock(DATA_FILE, _runAutomationEngine);
}

// Was previously stored but never applied — every active rule ran against
// every fetched Meta campaign regardless of these tags. Fixed alongside
// adding Google support: without this, a "platform: facebook" rule tuned
// to Meta's metric scale (e.g. CPC > ₫35K) would start firing on Google
// campaigns too the moment Google campaigns entered the loop.
function ruleAllowsCompany(rule: AutomationRule, company: string): boolean {
  return !rule.company || rule.company === "all" || rule.company === company;
}
function ruleAllowsCampaign(rule: AutomationRule, campaignId: string): boolean {
  return !rule.targetCampaignIds || rule.targetCampaignIds.length === 0 || rule.targetCampaignIds.includes(campaignId);
}

async function _runAutomationEngine(): Promise<RuleExecutionResult[]> {
  const db = readDB();
  const activeRules = db.rules.filter(r => r.isActive);
  if (activeRules.length === 0) return [];

  const needsMeta = activeRules.some(r => r.platform === "facebook" || r.platform === "all");
  const needsGoogle = activeRules.some(r => r.platform === "google" || r.platform === "all");

  let campaigns: MetaCampaignRaw[] = [];
  if (needsMeta) {
    try {
      campaigns = await metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED"] });
    } catch (err) {
      console.warn("[Automation] Failed to fetch Meta campaigns:", err instanceof Error ? err.message : err);
    }
  }
  const metaCompanyById = new Map(campaigns.map(c => [c.id, detectCompany(c.name)]));

  let googleCampaigns: GoogleEngineCampaign[] = [];
  if (needsGoogle) {
    try {
      googleCampaigns = await fetchGoogleCampaigns();
    } catch (err) {
      console.warn("[Automation] Failed to fetch Google campaigns:", err instanceof Error ? err.message : err);
    }
  }

  if (campaigns.length === 0 && googleCampaigns.length === 0) return [];

  const results: RuleExecutionResult[] = [];

  for (const rule of activeRules) {
    if (!shouldRunRule(rule)) continue;

    // Stamp as checked regardless of whether it ends up firing — this is
    // what makes checkInterval a real constraint instead of decoration.
    const dbRuleForCheck = db.rules.find(r => r.id === rule.id);
    if (dbRuleForCheck) dbRuleForCheck.lastCheckedAt = new Date().toISOString();

    const timeWindow = rule.conditions[0]?.timeWindow ?? "today";
    const dateRange = getDateRange(timeWindow);
    const needsPrevPeriod = rule.conditions.some(
      c => c.operator === "increased_by_pct" || c.operator === "decreased_by_pct"
    );

    let ruleFired = false;

    // ── Meta campaigns ──
    if ((rule.platform === "facebook" || rule.platform === "all") && campaigns.length > 0) {
      const metaCampaignsForRule = campaigns.filter(c =>
        ruleAllowsCompany(rule, metaCompanyById.get(c.id) ?? "MBC") && ruleAllowsCampaign(rule, c.id)
      );

      if (metaCampaignsForRule.length > 0) {
        let insights: Awaited<ReturnType<typeof metaClient.getCampaignInsights>> = [];
        try {
          insights = await metaClient.getCampaignInsights(metaCampaignsForRule.map(c => c.id), dateRange);
        } catch {
          console.warn("[Automation] Failed to fetch Meta insights for rule:", rule.name);
        }

        // Only fetched for rules that actually need a period-over-period
        // comparison — avoids doubling API calls for every other rule.
        let prevInsights: Awaited<ReturnType<typeof metaClient.getCampaignInsights>> = [];
        if (needsPrevPeriod && insights.length > 0) {
          try {
            prevInsights = await metaClient.getCampaignInsights(
              metaCampaignsForRule.map(c => c.id),
              getPreviousDateRange(timeWindow)
            );
          } catch {
            console.warn("[Automation] Failed to fetch previous-period Meta insights for rule:", rule.name);
          }
        }

        for (const campaign of metaCampaignsForRule) {
          const raw = insights.find(i => i.campaign_id === campaign.id);
          if (!raw) continue;

          // VND is a zero-decimal currency — no /100 conversion (matches the
          // fix already applied elsewhere in this codebase for the same
          // Meta Graph API daily_budget field).
          const dailyBudget = parseFloat(campaign.daily_budget ?? "0");
          const metrics = extractMetrics(raw, dailyBudget);

          const prevRaw = needsPrevPeriod ? prevInsights.find(i => i.campaign_id === campaign.id) : undefined;
          const previousMetrics = prevRaw ? extractMetrics(prevRaw, dailyBudget) : undefined;

          const conditionsMet = evaluateConditions(rule.conditions, rule.conditionLogic, metrics, previousMetrics);
          if (!conditionsMet) continue;

          // Learning Phase Guard
          const guard = checkLearningGuard(rule, campaign, metrics);
          if (guard.skip) {
            console.log(
              `[Automation] ❌ Rule "${rule.name}" — BỎ QUA cho campaign "${campaign.name}": ${guard.reason}`
            );
            const skipResult: RuleExecutionResult = {
              ruleId: rule.id,
              ruleName: rule.name,
              campaignId: campaign.id,
              campaignName: campaign.name,
              action: rule.actions[0]?.type ?? "send_notification",
              triggeredAt: new Date().toISOString(),
              metricsSnapshot: metrics,
              skipped: true,
              skipReason: guard.reason,
            };
            results.push(skipResult);
            db.executionLog.push(skipResult);
            continue;
          }

          const company = metaCompanyById.get(campaign.id) ?? "MBC";
          for (const action of rule.actions) {
            // Một campaign hỏng không được giết cả lượt chạy — và thất bại phải
            // vào nhật ký đúng là thất bại, không im lặng biến mất.
            let outcome: ActionOutcome;
            try {
              outcome = await executeAction(action, campaign, rule.id, rule.name, company);
            } catch (err) {
              const why = err instanceof Error ? err.message : "Lỗi không xác định";
              console.error(`[Automation] Hành động "${action.type}" lỗi trên "${campaign.name}": ${why}`);
              outcome = { executed: false, skipReason: `Thất bại: ${why}` };
            }

            const execResult: RuleExecutionResult = {
              ruleId: rule.id,
              ruleName: rule.name,
              campaignId: campaign.id,
              campaignName: campaign.name,
              action: action.type,
              triggeredAt: new Date().toISOString(),
              metricsSnapshot: metrics,
              ...(outcome.executed ? {} : { skipped: true, skipReason: outcome.skipReason }),
            };
            results.push(execResult);
            db.executionLog.push(execResult);
          }
          ruleFired = true;
        }
      }
    }

    // ── Google campaigns ──
    if ((rule.platform === "google" || rule.platform === "all") && googleCampaigns.length > 0) {
      const googleCampaignsForRule = googleCampaigns.filter(c =>
        ruleAllowsCompany(rule, c.company) && ruleAllowsCampaign(rule, c.id)
        && (!rule.googleChannelTypes?.length || rule.googleChannelTypes.includes(c.channelType))
      );

      if (googleCampaignsForRule.length > 0) {
        const metricsMap = await fetchGoogleMetrics(googleCampaignsForRule, dateRange);
        const prevMetricsMap = needsPrevPeriod
          ? await fetchGoogleMetrics(googleCampaignsForRule, getPreviousDateRange(timeWindow))
          : new Map<string, CampaignMetrics>();

        for (const campaign of googleCampaignsForRule) {
          const metrics = metricsMap.get(campaign.id);
          if (!metrics) continue;
          const previousMetrics = needsPrevPeriod ? prevMetricsMap.get(campaign.id) : undefined;

          const conditionsMet = evaluateConditions(rule.conditions, rule.conditionLogic, metrics, previousMetrics);
          if (!conditionsMet) continue;

          const guard = checkLearningGuardGoogle(
            rule.respectLearningPhase, hasGuardedAction(rule.actions), campaign, metrics.conversions
          );
          if (guard.skip) {
            console.log(
              `[Automation] ❌ Rule "${rule.name}" — BỎ QUA cho campaign Google "${campaign.name}": ${guard.reason}`
            );
            const skipResult: RuleExecutionResult = {
              ruleId: rule.id,
              ruleName: rule.name,
              campaignId: campaign.id,
              campaignName: campaign.name,
              action: rule.actions[0]?.type ?? "send_notification",
              triggeredAt: new Date().toISOString(),
              metricsSnapshot: metrics,
              skipped: true,
              skipReason: guard.reason,
            };
            results.push(skipResult);
            db.executionLog.push(skipResult);
            continue;
          }

          for (const action of rule.actions) {
            await executeGoogleAction(action, campaign, rule.id, rule.name);

            const execResult: RuleExecutionResult = {
              ruleId: rule.id,
              ruleName: rule.name,
              campaignId: campaign.id,
              campaignName: campaign.name,
              action: action.type,
              triggeredAt: new Date().toISOString(),
              metricsSnapshot: metrics,
            };
            results.push(execResult);
            db.executionLog.push(execResult);
          }
          ruleFired = true;
        }
      }
    }

    if (ruleFired) {
      const dbRule = db.rules.find(r => r.id === rule.id);
      if (dbRule) {
        dbRule.lastTriggered = new Date().toISOString();
        dbRule.triggerCount++;
      }
    }
  }

  // Cap the execution log length to 500
  db.executionLog = db.executionLog.slice(-500);
  writeDB(db);

  return results;
}
