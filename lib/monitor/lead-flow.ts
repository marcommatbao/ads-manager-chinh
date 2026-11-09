// ============================================================
// Đợt 9 · 1 — Canh ĐƯỜNG LEAD: khách gửi form (pixel) ↔ lead vào CRM (Odoo)
// ============================================================
// Sự cố thật 25–28/09: form "Tư vấn ngay" trên matbao.in vẫn được gửi (pixel "tu_van_ngay" 10/5/5 lượt/ngày)
// nhưng Odoo KHÔNG có lead nguồn matbao.in nào từ 25/09 11:17 — job báo lead vào Teams chạy đúng nhưng im
// (không có lead để báo), không ai biết. Tool chỉ thấy nhờ soi tay. Job này so HAI ĐẦU theo giờ:
//   có ≥ minForms lượt gửi form SAU lead cuối cùng, và đã ≥ quietHours giờ không có lead → "đứt".
// Mỗi đường là một cấu hình (pixel + tên sự kiện ↔ bộ lọc lead Odoo) — không gắn cứng Mắt Bão.

import fs from "fs"
import path from "path"
import { metaGet } from "@/lib/case/meta-graph"
import { vnDate, addDays } from "@/lib/case/dates"
import { searchRead } from "@/lib/odoo-client"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
// 29/09: đổi sang sendSystemAlert (Teams → rơi xuống Telegram). TEAMS_WEBHOOK_OPS_ALERTS không có trên Coolify — nếu
// Cài đặt cũng trống thì mọi cảnh báo ĐỨT từ 25/09 đã trả notConfigured và KHÔNG TỚI AI (user: "không biết khi nào lỗi").
import { sendSystemAlert } from "@/lib/system-alert"
import { isCompany } from "@/lib/companies/registry";
import { makeT, type TFunction } from "@/lib/i18n/translate";

const FILE = path.join(process.cwd(), "data", "lead-flows.json")
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LeadFlow {
  id: string
  company: string
  label: string
  pixelId: string
  /** Tên sự kiện pixel = một lượt gửi form (vd "tu_van_ngay", "Lead"). */
  pixelEvents: string[]
  /** Lead Odoo thuộc đường này: nguồn (source_id) chứa chuỗi này. */
  odooSourceIlike: string
  /** Ngưỡng: số lead LẼ RA phải có (form sau lead cuối × tỉ lệ lead/form 30 ngày) ≥ minExpectedLeads, và
   *  ≥ quietHours giờ không lead → báo. Đo 28/09: form ≠ lead 1:1 (22/09: 10 form, 2 lead) — ngưỡng theo số form
   *  thô báo nhầm. minForms là sàn tối thiểu. */
  minForms: number
  minExpectedLeads: number
  quietHours: number
  enabled: boolean
}
/** Mặc định từ sự cố 25/09 (MBI). */
export const DEFAULT_FLOWS: LeadFlow[] = [
  { id: "mbi_tu_van", company: "MBI", label: "Form “Tư vấn ngay” matbao.in → Odoo", pixelId: "1026655395091184", pixelEvents: ["tu_van_ngay", "Lead"], odooSourceIlike: "matbao.in", minForms: 5, minExpectedLeads: 4, quietHours: 24, enabled: true },
]

export interface LeadFlowStatus {
  flow: LeadFlow
  checkedAt: string
  status: "ok" | "broken" | "quiet" | "error"
  lastLeadAt: string | null
  hoursSinceLead: number | null
  formsSinceLead: number
  /** Tỉ lệ lead/form 30 ngày và số lead lẽ ra phải có từ lead cuối. */
  ratio: number | null
  expectedLeads: number | null
  /** 7 ngày gần nhất (giờ VN), cũ → mới. */
  days: { date: string; forms: number; leads: number }[]
  message: string
  error?: string
}

interface Store { flows?: LeadFlow[]; last?: Record<string, LeadFlowStatus>; alerted?: Record<string, string> }
function readStore(): Store { try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as Store) : {} } catch { return {} } }
function writeStore(s: Store) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(s, null, 1)) }
export function readFlows(): LeadFlow[] { return readStore().flows ?? DEFAULT_FLOWS }
export function saveFlows(flows: LeadFlow[]): void { writeStore({ ...readStore(), flows }) }
export function lastStatuses(): LeadFlowStatus[] { const s = readStore(); return readFlows().map((f) => s.last?.[f.id]).filter((x): x is LeadFlowStatus => !!x) }

export function validateFlows(x: unknown, t: TFunction = makeT("vi")): string | null {
  if (!Array.isArray(x) || x.length > 20) return t("libcase.r.lf.list")
  for (const [i, f] of (x as Partial<LeadFlow>[]).entries()) {
    if (!f || typeof f.id !== "string" || !/^[a-z0-9_]{2,40}$/.test(f.id)) return t("libcase.r.lf.id", { i: i + 1 })
    if (!isCompany(f.company)) return t("libcase.r.lf.company", { i: i + 1 })
    if (!f.pixelId || !/^\d+$/.test(f.pixelId)) return t("libcase.r.lf.pixel", { i: i + 1 })
    if (!Array.isArray(f.pixelEvents) || !f.pixelEvents.length || f.pixelEvents.some((e) => typeof e !== "string" || !e.trim())) return t("libcase.r.lf.events", { i: i + 1 })
    if (!f.odooSourceIlike || typeof f.odooSourceIlike !== "string") return t("libcase.r.lf.source", { i: i + 1 })
    if (!(Number(f.minForms) >= 1) || !(Number(f.quietHours) >= 2) || !(Number(f.minExpectedLeads ?? 4) >= 1)) return t("libcase.r.lf.thr", { i: i + 1 })
  }
  return null
}

/**
 * Hàm thuần: form theo giờ + lead → trạng thái.
 * formsByHour: [{ at: ISO giờ bắt đầu, n }]; leads: thời điểm tạo (ISO, UTC).
 */
export function evaluateFlow(flow: LeadFlow, formsByHour: { at: string; n: number }[], leads: string[], now: Date): Omit<LeadFlowStatus, "flow" | "checkedAt" | "error"> {
  const totalForms = formsByHour.reduce((s, h) => s + h.n, 0)
  const ratio = totalForms >= 20 ? Math.min(1, leads.length / totalForms) : null
  const lastLeadAt = leads.length ? leads.reduce((a, b) => (a > b ? a : b)) : null
  const hoursSinceLead = lastLeadAt ? Math.round(((now.getTime() - Date.parse(lastLeadAt)) / 3_600_000) * 10) / 10 : null
  // Giờ chứa lead cuối cũng tính (form trong cùng giờ SAU lead) — chấp nhận dư một chút, đổi lại không bỏ sót.
  const since = lastLeadAt ? Date.parse(lastLeadAt) - 3_600_000 : -Infinity
  const formsSinceLead = formsByHour.filter((h) => Date.parse(h.at) > since).reduce((s, h) => s + h.n, 0)
  const today = vnDate(now)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((date) => ({
    date,
    forms: formsByHour.filter((h) => vnDate(new Date(h.at)) === date).reduce((s, h) => s + h.n, 0),
    leads: leads.filter((l) => vnDate(new Date(l)) === date).length,
  }))
  const expectedLeads = ratio === null ? null : Math.round(formsSinceLead * ratio * 10) / 10
  // Chưa đủ số để có tỉ lệ → lùi về ngưỡng thô (sàn minForms × 3).
  const enough = expectedLeads !== null ? expectedLeads >= (flow.minExpectedLeads ?? 4) : formsSinceLead >= flow.minForms * 3
  const broken = formsSinceLead >= flow.minForms && enough && (hoursSinceLead === null || hoursSinceLead >= flow.quietHours)
  const quiet = !broken && hoursSinceLead !== null && hoursSinceLead >= flow.quietHours && formsSinceLead === 0
  const status: LeadFlowStatus["status"] = broken ? "broken" : quiet ? "quiet" : "ok"
  return {
    status, lastLeadAt, hoursSinceLead, formsSinceLead, ratio: ratio === null ? null : Math.round(ratio * 1000) / 1000, expectedLeads, days,
    message: flowMessage(status, flow.minForms, lastLeadAt, hoursSinceLead, formsSinceLead, expectedLeads),
  }
}

/** Câu mô tả trạng thái đường lead theo ngôn ngữ (mặc định tiếng Việt). Dựng từ số liệu nên có thể vẽ lại từ trạng thái đã lưu. */
function flowMessage(status: LeadFlowStatus["status"], minForms: number, lastLeadAt: string | null, hoursSinceLead: number | null, formsSinceLead: number, expectedLeads: number | null, t: TFunction = makeT("vi")): string {
  const since2 = lastLeadAt ? t("libcase.r.lf.since", { t: new Date(lastLeadAt).toLocaleString(t("libcase.r.lf.dateLocale"), { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) }) : t("libcase.r.lf.sinceNone")
  if (status === "broken") return t("libcase.r.lf.broken", { forms: formsSinceLead, since: since2, exp: expectedLeads !== null ? t("libcase.r.lf.exp", { n: expectedLeads }) : "" })
  if (status === "quiet") return t("libcase.r.lf.quiet", { h: Math.round(hoursSinceLead!) })
  return t("libcase.r.lf.ok", { since: since2, after: formsSinceLead ? t("libcase.r.lf.okAfter", { n: formsSinceLead, min: minForms }) : "" })
}

/** Thông điệp trạng thái theo ngôn ngữ cho giao diện/API (trạng thái lưu sẵn bằng tiếng Việt). */
export function leadFlowMessage(s: LeadFlowStatus, t: TFunction = makeT("vi")): string {
  if (s.status === "error") return t("libcase.r.lf.err")
  return flowMessage(s.status, s.flow.minForms, s.lastLeadAt, s.hoursSinceLead, s.formsSinceLead, s.expectedLeads, t)
}

async function formsByHour(flow: LeadFlow, now: Date): Promise<{ at: string; n: number }[]> {
  const end = Math.floor(now.getTime() / 1000), start = end - 30 * 86400
  const j = await metaGet<Row>(`${flow.pixelId}/stats`, { aggregation: "event", start_time: String(start), end_time: String(end) })
  const want = new Set(flow.pixelEvents.map((e) => e.trim()))
  const out: { at: string; n: number }[] = []
  for (const g of (j.data ?? []) as Row[]) {
    const n = ((g.data ?? []) as Row[]).filter((e) => want.has(String(e.value))).reduce((s, e) => s + (Number(e.count) || 0), 0)
    if (n && g.start_time) out.push({ at: new Date(String(g.start_time).replace("+0000", "Z")).toISOString(), n })
  }
  return out
}
async function leadTimes(flow: LeadFlow, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 19).replace("T", " ")
  const rows = await searchRead<{ create_date: string }>("crm.lead", [["create_date", ">=", since], ["source_id.name", "ilike", flow.odooSourceIlike]], ["create_date"], { limit: 2000, order: "create_date desc" })
  return rows.map((r) => `${r.create_date.replace(" ", "T")}Z`) // Odoo lưu UTC
}

/** Kiểm MỘT đường (đọc pixel + Odoo). Lỗi đọc → status "error", không ném. */
export async function checkFlow(flow: LeadFlow, now: Date = new Date()): Promise<LeadFlowStatus> {
  try {
    const [forms, leads] = await Promise.all([formsByHour(flow, now), leadTimes(flow, now)])
    return { flow, checkedAt: now.toISOString(), ...evaluateFlow(flow, forms, leads, now) }
  } catch (e) {
    return { flow, checkedAt: now.toISOString(), status: "error", lastLeadAt: null, hoursSinceLead: null, formsSinceLead: 0, ratio: null, expectedLeads: null, days: [], message: "Không kiểm được", error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Báo sáng (user 29/09: "không biết khi nào form bị lỗi") ──
// Job 2 giờ/lần chỉ lên tiếng khi ĐỨT (và chờ đủ số mới kết luận) → những ngày im lặng không biết là "ổn" hay "tool không
// chạy". Báo sáng gửi MỖI NGÀY kể cả khi bình thường: không nhận được tin 8:00 = có chuyện với chính tool.
const ICON: Record<LeadFlowStatus["status"], string> = { ok: "✓ Bình thường", quiet: "○ Yên (không form, không lead)", broken: "✕ ĐỨT", error: "⚠ Không kiểm được" }
/** Nội dung báo sáng — HÀM THUẦN. */
export function morningReport(statuses: LeadFlowStatus[], now: Date): { level: "danger" | "warning" | "good"; title: string; facts: { title: string; value: string }[] } {
  const yesterday = addDays(vnDate(now), -1)
  const bad = statuses.filter((s) => s.status === "broken"), err = statuses.filter((s) => s.status === "error")
  const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—")
  return {
    level: bad.length ? "danger" : err.length ? "warning" : "good",
    title: `${bad.length ? `✕ ${bad.length} đường lead đang ĐỨT` : err.length ? "⚠ Có đường lead không kiểm được" : "✓ Đường lead bình thường"} — báo sáng ${vnDate(now).split("-").reverse().join("/")}`,
    facts: statuses.map((s) => {
      const y = s.days.find((d) => d.date === yesterday)
      return { title: s.flow.label, value: `${ICON[s.status]} · lead cuối ${at(s.lastLeadAt)}${s.hoursSinceLead != null ? ` (${Math.round(s.hoursSinceLead)} giờ trước)` : ""}${y ? ` · hôm qua ${y.forms} form / ${y.leads} lead` : ""}${s.status === "broken" || s.status === "error" ? ` — ${s.error ?? s.message}` : ""}` }
    }),
  }
}

export async function runLeadFlowMorning(now: Date = new Date()): Promise<{ sent: boolean; channel: string | null; error?: string; report: ReturnType<typeof morningReport> }> {
  const statuses = await Promise.all(readFlows().filter((f) => f.enabled).map((f) => checkFlow(f, now)))
  const report = morningReport(statuses, now)
  const r = await sendSystemAlert({ ...report, action: report.level === "good" ? undefined : "Kiểm đường gửi form → CRM (website / tích hợp Odoo). Chi tiết: AdsCommand → Tổng quan → Tình trạng & cảnh báo." }).catch((e) => ({ sent: false, channel: null, error: String(e) }))
  return { sent: !!r.sent, channel: r.channel ?? null, error: r.error, report }
}

/** Job lead_flow_watch (2 giờ/lần): kiểm mọi đường; đứt → báo kênh IT tối đa 1 lần/ngày/đường; nối lại → báo 1 lần. */
export async function runLeadFlowWatch(now: Date = new Date()): Promise<{ statuses: LeadFlowStatus[]; alerts: string[] }> {
  const store = readStore()
  const statuses: LeadFlowStatus[] = []
  const alerts: string[] = []
  for (const flow of readFlows().filter((f) => f.enabled)) {
    const st = await checkFlow(flow, now)
    const prev = store.last?.[flow.id]
    const today = vnDate(now)
    if (st.status === "broken" && store.alerted?.[flow.id] !== today) {
      const r = await sendSystemAlert({
        level: "danger", title: `✕ Lead có thể đang mất — ${flow.label}`,
        facts: [
          { title: "Tình trạng", value: st.message },
          { title: "7 ngày (form / lead)", value: st.days.map((d) => `${d.date.slice(5)}: ${d.forms}/${d.leads}`).join(" · ") },
        ],
        action: "Kiểm đường gửi form → CRM (website/tích hợp Odoo) ngay; lấy lại các lượt gửi form từ lúc đứt (CSDL website / email thông báo).",
      }).catch(() => ({ sent: false }))
      if (r.sent) { store.alerted = { ...(store.alerted ?? {}), [flow.id]: today }; alerts.push(flow.id) }
    }
    if (prev?.status === "broken" && st.status === "ok") {
      await sendSystemAlert({ level: "good", title: `✓ Lead đã vào CRM trở lại — ${flow.label}`, facts: [{ title: "Tình trạng", value: st.message }] }).catch(() => null)
      alerts.push(`${flow.id}:recovered`)
    }
    store.last = { ...(store.last ?? {}), [flow.id]: st }
    statuses.push(st)
  }
  writeStore(store)
  return { statuses, alerts }
}
