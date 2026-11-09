// ============================================================
// Đợt 10c (C3) — Gửi CHẤT LƯỢNG LEAD về Google (chuyển đổi offline), không phụ thuộc ERP
// ============================================================
// Vì sao: PMax/Search tối ưu theo "để lại thông tin" nên đuổi cả lead rác. Báo lại cho Google lead nào ĐẠT CHUẨN / CHỐT
// ĐƠN thì đặt giá học đuổi lead thật (quan trọng cho ngành sống bằng lead: bất động sản, giáo dục… — quyết định user 28/09).
// Nguồn: webhook JSON (CRM bất kỳ gọi vào) hoặc CSV tải lên. Khoá lead: gclid/gbraid/wbraid nếu có, không thì email/SĐT
// BĂM SHA-256 ngay khi nhận (chuyển đổi nâng cao cho khách tiềm năng — cả 2 tài khoản đã chấp nhận điều khoản dữ liệu
// khách hàng + bật ECL, đo 28/09). KHÔNG lưu email/SĐT thô.
// Hành động chuyển đổi tool tạo là PHỤ (primary_for_goal = false) → chưa ảnh hưởng đặt giá cho tới khi người dùng tự đưa
// vào mục tiêu trong Google Ads, khi đã thấy số đổ về đều.

import crypto from "crypto"
import fs from "fs"
import path from "path"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DIR = path.join(process.cwd(), "data", "lead-quality")
const SETTINGS = path.join(DIR, "settings.json")
const eventsFile = (co: Company) => path.join(DIR, `${co}-events.json`)
export const MAX_EVENTS_PER_CALL = 500
const KEEP_EVENTS = 20_000

export type Stage = "qualified" | "won" | "junk"
export const STAGE_LABEL: Record<Stage, string> = { qualified: "Lead đạt chuẩn", won: "Lead chốt đơn", junk: "Lead rác" }
export const ACTION_NAME: Record<Exclude<Stage, "junk">, string> = { qualified: "AdsCommand · Lead đạt chuẩn", won: "AdsCommand · Lead chốt đơn" }
const CATEGORY = { qualified: 22, won: 23 } as const // ConversionActionCategory.QUALIFIED_LEAD / CONVERTED_LEAD (đo 28/09)
const UPLOAD_CLICKS = 7

export interface CompanySettings {
  actions?: Partial<Record<Exclude<Stage, "junk">, string>>
  defaultValue?: Partial<Record<Exclude<Stage, "junk">, number>>
  webhookSecretHash?: string
  webhookSecretCreatedAt?: string
}
type Settings = Partial<Record<Company, CompanySettings>>
function readSettings(): Settings { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf-8")) as Settings } catch { return {} } }
async function updateSettings(co: Company, f: (s: CompanySettings) => void): Promise<CompanySettings> {
  return withFileLock(SETTINGS, async () => { const all = readSettings(); const s = all[co] ?? {}; f(s); all[co] = s; fs.mkdirSync(DIR, { recursive: true }); writeFileAtomicSync(SETTINGS, JSON.stringify(all, null, 1)); return s })
}
export const companySettings = (co: Company): CompanySettings => readSettings()[co] ?? {}

// ── Chuẩn hoá + băm (theo hướng dẫn Enhanced Conversions của Google) ──

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  const [local, domain] = e.split("@")
  return ["gmail.com", "googlemail.com"].includes(domain) ? `${local.replace(/\./g, "")}@${domain}` : e
}
/** SĐT Việt Nam về E.164: 0912… / 84912… / +84 912… → +84912… */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "")
  if (d.startsWith("+")) d = d.slice(1)
  else if (d.startsWith("00")) d = d.slice(2)
  else if (d.startsWith("0")) d = `84${d.slice(1)}`
  return /^\d{9,15}$/.test(d) ? `+${d}` : null
}
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

// ── Sự kiện lead ──

export interface LeadEventInput { leadId?: unknown; stage?: unknown; time?: unknown; gclid?: unknown; gbraid?: unknown; wbraid?: unknown; email?: unknown; phone?: unknown; value?: unknown; currency?: unknown; /** Đợt 16: đã băm sẵn (SHA-256 hex) — dùng khi không có bản thô. */ hashedEmail?: unknown; hashedPhone?: unknown }
export interface LeadEvent {
  key: string; leadId: string; stage: Stage; time: string
  gclid?: string; gbraid?: string; wbraid?: string; hashedEmail?: string; hashedPhone?: string
  value?: number; currency: string
  status: "pending" | "uploaded" | "failed" | "skipped"; error?: string; attempts?: number; receivedAt: string; uploadedAt?: string; source: "webhook" | "csv" | "odoo"
}
export const MAX_ATTEMPTS = 3

/** Thời điểm KHÔNG ghi múi giờ = giờ Việt Nam (container chạy UTC — hiểu theo máy là lệch 7 tiếng). */
export function parseLeadTime(raw: unknown): Date | null {
  let s = String(raw ?? "").trim()
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (dmy) s = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T${(dmy[4] ?? "0").padStart(2, "0")}:${dmy[5] ?? "00"}:${dmy[6] ?? "00"}`
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(s)
  if (local) s = `${local[1]}T${local[2] ? (local[2].length === 5 ? `${local[2]}:00` : local[2]) : "00:00:00"}+07:00`
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t
}

const STAGE_ALIAS: Record<string, Stage> = { qualified: "qualified", mql: "qualified", sql: "qualified", dat: "qualified", dat_chuan: "qualified", tiem_nang: "qualified", won: "won", closed_won: "won", chot: "won", chot_don: "won", ban_duoc: "won", junk: "junk", spam: "junk", rac: "junk", lost: "junk", sai_so: "junk" }
// Hạ chữ thường TRƯỚC rồi mới đổi đ → d: "Đạt chuẩn" / "SĐT" có Đ hoa.
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")

/** Kiểm + chuẩn hoá một sự kiện. Email/SĐT băm NGAY, bản thô không đi tiếp. */
export function toLeadEvent(x: LeadEventInput, source: LeadEvent["source"], now = new Date()): { event?: LeadEvent; error?: string } {
  const leadId = String(x.leadId ?? "").trim().slice(0, 100)
  if (!leadId) return { error: "thiếu leadId" }
  const stage = STAGE_ALIAS[slug(String(x.stage ?? ""))]
  if (!stage) return { error: `giai đoạn "${String(x.stage ?? "").slice(0, 30)}" không hiểu (dùng qualified / won / junk)` }
  const t = parseLeadTime(x.time)
  if (!t) return { error: "thời điểm (time) không hợp lệ — vd 2026-09-28T10:00:00+07:00 hoặc 28/09/2026 10:00 (giờ VN)" }
  if (t.getTime() > now.getTime() + 5 * 60_000) return { error: "thời điểm ở tương lai" }
  const id = (v: unknown) => { const s = String(v ?? "").trim(); return /^[\w-]{10,200}$/.test(s) ? s : undefined }
  const email = typeof x.email === "string" ? normalizeEmail(x.email) : null
  const phone = typeof x.phone === "string" || typeof x.phone === "number" ? normalizePhone(String(x.phone)) : null
  const hex = (v: unknown) => (typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : undefined)
  const ev: LeadEvent = {
    key: `${leadId}:${stage}`, leadId, stage, time: t.toISOString(),
    gclid: id(x.gclid), gbraid: id(x.gbraid), wbraid: id(x.wbraid),
    hashedEmail: email ? sha256(email) : hex(x.hashedEmail), hashedPhone: phone ? sha256(phone) : hex(x.hashedPhone),
    value: Number.isFinite(Number(x.value)) && Number(x.value) > 0 ? Number(x.value) : undefined,
    currency: /^[A-Z]{3}$/.test(String(x.currency ?? "")) ? String(x.currency) : "VND",
    status: stage === "junk" ? "skipped" : "pending", receivedAt: now.toISOString(), source,
  }
  if (stage !== "junk" && !ev.gclid && !ev.gbraid && !ev.wbraid && !ev.hashedEmail && !ev.hashedPhone) return { error: "cần gclid hoặc email/SĐT để Google khớp lượt bấm" }
  return { event: ev }
}

function readEvents(co: Company): LeadEvent[] { try { return JSON.parse(fs.readFileSync(eventsFile(co), "utf-8")) as LeadEvent[] } catch { return [] } }

/** Nhận lô sự kiện; trùng (cùng lead + giai đoạn) thì bỏ qua — Google cũng chống trùng theo order_id. */
export async function ingestEvents(co: Company, inputs: LeadEventInput[], source: LeadEvent["source"]): Promise<{ accepted: number; duplicates: number; errors: string[] }> {
  if (inputs.length > MAX_EVENTS_PER_CALL) throw new PmaxControlError(`Tối đa ${MAX_EVENTS_PER_CALL} sự kiện một lần`, 413)
  const errors: string[] = []
  const evs: LeadEvent[] = []
  inputs.forEach((x, i) => { const r = toLeadEvent(x, source); if (r.event) evs.push(r.event); else if (errors.length < 20) errors.push(`#${i + 1}: ${r.error}`) })
  return withFileLock(eventsFile(co), async () => {
    const cur = readEvents(co)
    const seen = new Set(cur.map((e) => e.key))
    const fresh = evs.filter((e) => !seen.has(e.key) && (seen.add(e.key), true))
    fs.mkdirSync(DIR, { recursive: true })
    writeFileAtomicSync(eventsFile(co), JSON.stringify([...cur, ...fresh].slice(-KEEP_EVENTS)))
    return { accepted: fresh.length, duplicates: evs.length - fresh.length, errors }
  })
}

// ── Hành động chuyển đổi ──

export async function readActions(co: Company): Promise<{ stage: Exclude<Stage, "junk">; name: string; resourceName: string | null; status: string | null; primary: boolean | null }[]> {
  const c = getGoogleAdsCustomer(co)
  const rows = (await c.query(`SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.type = 'UPLOAD_CLICKS' AND conversion_action.status != 'REMOVED'`)) as Row[]
  const saved = companySettings(co).actions ?? {}
  return (["qualified", "won"] as const).map((stage) => {
    const r = rows.find((x) => x.conversion_action.resource_name === saved[stage]) ?? rows.find((x) => x.conversion_action.name === ACTION_NAME[stage])
    return { stage, name: ACTION_NAME[stage], resourceName: r ? String(r.conversion_action.resource_name) : null, status: r ? String(r.conversion_action.status) : null, primary: r ? !!r.conversion_action.primary_for_goal : null }
  })
}

/** Tạo 2 hành động tải lên (PHỤ — không đụng đặt giá). Đã có thì dùng lại, không tạo trùng. */
export async function ensureActions(co: Company, input: { validateOnly: boolean; confirmText?: string; values?: Partial<Record<Exclude<Stage, "junk">, number>> }): Promise<{ created: string[]; existing: string[]; wouldCreate: string[] }> {
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(`Gõ đúng “${PMAX_CONFIRM_TEXT}” để tạo trên tài khoản thật`)
  const cur = await readActions(co)
  const missing = cur.filter((a) => !a.resourceName)
  const existing = cur.filter((a) => a.resourceName).map((a) => a.name)
  if (!missing.length) { await updateSettings(co, (s) => { s.actions = Object.fromEntries(cur.map((a) => [a.stage, a.resourceName!])) }); return { created: [], existing, wouldCreate: [] } }
  const c = getGoogleAdsCustomer(co)
  const ops = missing.map((a) => ({ name: a.name, type: UPLOAD_CLICKS, category: CATEGORY[a.stage], status: 2 /* ENABLED */, primary_for_goal: false,
    counting_type: 3 /* ONE_PER_CLICK */, click_through_lookback_window_days: 90,
    value_settings: { default_value: input.values?.[a.stage] ?? 0, always_use_default_value: false, default_currency_code: "VND" } }))
  try { await c.conversionActions.create(ops as never, { validate_only: true } as never) } catch (e) { throw new PmaxControlError(`Google từ chối khi kiểm — CHƯA tạo gì: ${googleAdsErrorMessage(e)}`, 502) }
  if (input.validateOnly) return { created: [], existing, wouldCreate: missing.map((a) => a.name) }
  const res = (await c.conversionActions.create(ops as never)) as { results?: { resource_name?: string }[] }
  const names = missing.map((a, i) => ({ stage: a.stage, rn: res?.results?.[i]?.resource_name ?? "" }))
  await updateSettings(co, (s) => { s.actions = { ...Object.fromEntries(cur.filter((a) => a.resourceName).map((a) => [a.stage, a.resourceName!])), ...Object.fromEntries(names.filter((n) => n.rn).map((n) => [n.stage, n.rn])) }; s.defaultValue = { ...s.defaultValue, ...input.values } })
  return { created: missing.map((a) => a.name), existing, wouldCreate: [] }
}

// ── Tải lên ──

/** "2026-09-28 10:00:00+07:00" — định dạng Google đòi. */
export function googleDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000)
  return `${d.toISOString().slice(0, 19).replace("T", " ")}+07:00`
}
export function buildClickConversion(e: LeadEvent, action: string, fallbackValue: number) {
  return {
    conversion_action: action, conversion_date_time: googleDateTime(e.time), order_id: e.key,
    conversion_value: e.value ?? fallbackValue, currency_code: e.currency,
    ...(e.gclid ? { gclid: e.gclid } : e.gbraid ? { gbraid: e.gbraid } : e.wbraid ? { wbraid: e.wbraid } : {}),
    ...(!e.gclid && !e.gbraid && !e.wbraid ? { user_identifiers: [...(e.hashedEmail ? [{ hashed_email: e.hashedEmail }] : []), ...(e.hashedPhone ? [{ hashed_phone_number: e.hashedPhone }] : [])] } : {}),
  }
}

export async function uploadPending(co: Company, opts: { validateOnly?: boolean; limit?: number } = {}): Promise<{ sent: number; uploaded: number; failed: number; errors: string[]; skippedNoAction: number }> {
  const s = companySettings(co)
  const acts = s.actions ?? {}
  return withFileLock(eventsFile(co), async () => {
    const all = readEvents(co)
    const pend = all.filter((e) => e.status === "pending" || (e.status === "failed" && (e.attempts ?? 0) < MAX_ATTEMPTS))
    const ready = pend.filter((e) => e.stage !== "junk" && acts[e.stage as Exclude<Stage, "junk">]).slice(0, opts.limit ?? 2000)
    const skippedNoAction = pend.length - ready.length
    const out = { sent: 0, uploaded: 0, failed: 0, errors: [] as string[], skippedNoAction }
    if (!ready.length) return out
    const c = getGoogleAdsCustomer(co) as unknown as { conversionUploads: { uploadClickConversions: (r: object) => Promise<Row> } }
    for (let i = 0; i < ready.length; i += 1000) {
      const chunk = ready.slice(i, i + 1000)
      const conversions = chunk.map((e) => buildClickConversion(e, acts[e.stage as Exclude<Stage, "junk">]!, s.defaultValue?.[e.stage as Exclude<Stage, "junk">] ?? 0))
      out.sent += chunk.length
      let res: Row
      try { res = await c.conversionUploads.uploadClickConversions({ customer_id: customerIdOf(co), conversions, partial_failure: true, validate_only: !!opts.validateOnly }) } catch (e) {
        out.errors.push(googleAdsErrorMessage(e)); out.failed += chunk.length
        if (!opts.validateOnly) for (const ev of chunk) { ev.status = "failed"; ev.attempts = (ev.attempts ?? 0) + 1; ev.error = googleAdsErrorMessage(e).slice(0, 300) }
        continue
      }
      const msg = String(res?.partial_failure_error?.message ?? "")
      if (msg) out.errors.push(msg.slice(0, 500))
      // Dòng lỗi có kết quả rỗng (không có conversion_action) — lấy theo vị trí, không đoán từ câu lỗi.
      const results = (res?.results ?? []) as Row[]
      chunk.forEach((ev, j) => {
        const ok = !msg || !!results[j]?.conversion_action
        if (ok) out.uploaded++; else out.failed++
        if (opts.validateOnly) return
        if (ok) { ev.status = "uploaded"; ev.uploadedAt = new Date().toISOString(); ev.error = undefined }
        else { ev.status = "failed"; ev.attempts = (ev.attempts ?? 0) + 1; ev.error = (new RegExp(`conversions\\[${j}\\][^,;]*`).exec(msg)?.[0] ?? msg).slice(0, 300) }
      })
    }
    if (!opts.validateOnly) writeFileAtomicSync(eventsFile(co), JSON.stringify(all))
    return out
  })
}

export interface LeadQualityStats { total: number; byStage: Record<Stage, number>; byStatus: Record<LeadEvent["status"], number>; last: { key: string; stage: Stage; status: LeadEvent["status"]; time: string; error?: string; via: string }[] }
export function leadQualityStats(co: Company): LeadQualityStats {
  const ev = readEvents(co)
  const byStage = { qualified: 0, won: 0, junk: 0 }, byStatus = { pending: 0, uploaded: 0, failed: 0, skipped: 0 }
  for (const e of ev) { byStage[e.stage]++; byStatus[e.status]++ }
  return { total: ev.length, byStage, byStatus, last: ev.slice(-20).reverse().map((e) => ({ key: e.key, stage: e.stage, status: e.status, time: e.time, error: e.error, via: e.gclid ? "gclid" : e.gbraid || e.wbraid ? "gbraid/wbraid" : "email/SĐT băm" })) }
}

// ── Khoá webhook: chỉ lưu BĂM, bản thật hiện đúng một lần lúc tạo ──

export async function rotateWebhookSecret(co: Company): Promise<string> {
  const secret = `lq_${crypto.randomBytes(24).toString("base64url")}`
  await updateSettings(co, (s) => { s.webhookSecretHash = sha256(secret); s.webhookSecretCreatedAt = new Date().toISOString() })
  return secret
}
export function verifyWebhookSecret(co: Company, presented: string | null): boolean {
  const h = companySettings(co).webhookSecretHash
  if (!h || !presented) return false
  const a = Buffer.from(sha256(presented)), b = Buffer.from(h)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// CSV: lead_id,stage,time,gclid,email,phone,value (tiêu đề bắt buộc — cột theo tên, thứ tự tuỳ ý).
export function parseLeadCsv(text: string): { rows: LeadEventInput[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], errors: ["Tệp rỗng"] }
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ","
  const head = lines[0].split(sep).map((h) => slug(h.replace(/"/g, "")))
  const col = (names: string[]) => head.findIndex((h) => names.includes(h))
  const idx = { leadId: col(["lead_id", "leadid", "id", "ma_lead"]), stage: col(["stage", "giai_doan", "trang_thai", "status"]), time: col(["time", "thoi_gian", "ngay", "date", "datetime"]), gclid: col(["gclid"]), gbraid: col(["gbraid"]), wbraid: col(["wbraid"]), email: col(["email"]), phone: col(["phone", "sdt", "so_dien_thoai", "dien_thoai"]), value: col(["value", "gia_tri", "doanh_thu"]) }
  if (idx.leadId < 0 || idx.stage < 0 || idx.time < 0) return { rows: [], errors: ["Thiếu cột bắt buộc: lead_id, stage, time"] }
  const rows = lines.slice(1).map((l) => {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""))
    const get = (i: number) => (i >= 0 ? c[i] : undefined)
    return { leadId: get(idx.leadId), stage: get(idx.stage), time: get(idx.time), gclid: get(idx.gclid), gbraid: get(idx.gbraid), wbraid: get(idx.wbraid), email: get(idx.email), phone: get(idx.phone), value: get(idx.value) }
  })
  return { rows, errors: [] }
}
