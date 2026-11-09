// ============================================================
// Giám sát đo lường tự động (Đợt 6 · A) — CHỈ ĐỌC + cảnh báo Teams
// ============================================================
// Đến Đợt 5 lỗi đo lường chỉ lộ khi có người mở /do-luong. Ca 27/09: user sửa
// GTM (bản 129) phải chờ người vào xem tên tự đặt đã ngừng chưa; ngược lại ai
// sửa GTM làm hỏng Purchase thì không ai biết. Job này mỗi ngày chụp lại tình
// trạng, so với lần trước, CHỈ báo Teams khi có thay đổi.
//
// Nguồn hỏng (Meta #613…) → ảnh chụp ghi "không đọc được" cho phần đó và KHÔNG
// so phần đó — so với dữ liệu thiếu sẽ ra "đã khỏi"/"hỏng mới" giả.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { sendTeamsAlert } from "@/lib/teams-alert"
import { vnDate } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { metaHealth, type MetaHealth } from "@/lib/measure/meta-health"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { normEvent, tagDoctor, type TagDoctorReport } from "@/lib/measure/tag-doctor"

const DIR = path.join(process.cwd(), "data", "measure-snapshots")
const KEEP_DAYS = 60

/** Tên chuẩn Meta — dùng để nhận ra "ngừng bắn" và "tên tự đặt trùng nghĩa". */
export const STANDARD_EVENTS = ["Purchase", "AddToCart", "AddPaymentInfo", "InitiateCheckout", "Lead", "CompleteRegistration", "ViewContent", "PageView", "Contact", "Subscribe"]
/** Trung bình 7 ngày trước ≥ ngần này lượt/ngày mà hôm qua 0 → coi là ngừng bắn (quy ước của tool). */
export const STOPPED_MIN_AVG = 5

export interface CompanySnapshot {
  company: Company
  metaOk: boolean
  tagsOk: boolean
  errors: string[]
  issues: { id: string; severity: "bad" | "warn"; title: string }[]
  gtm: { id: string; version: string | null; tags: { tagId: string; kind: string; eventName: string }[] }[]
  /** Sự kiện chuẩn đang "ngừng bắn": hôm qua 0 mà trung bình 7 ngày trước ≥ STOPPED_MIN_AVG. */
  stopped: { pixelId: string; name: string; prevAvg: number }[]
  /** Tên tự đặt trùng nghĩa sự kiện chuẩn còn bắn trong 7 ngày. */
  customVariants: { pixelId: string; name: string; last7: number }[]
  googleGoals: { category: string; origin: string; biddable: boolean }[]
  primarySilent: { name: string; total: number }[]
  /** Đợt 9 · 2 — trạng thái các bước lộ trình sửa đo lường Mua hàng. */
  roadmap?: { id: string; label: string; status: string; action: string }[]
}

export type ChangeLevel = "bad" | "good" | "info"
export interface MonitorChange { company: Company; level: ChangeLevel; text: string }
export interface MonitorRun {
  date: string
  at: string
  snapshots: CompanySnapshot[]
  changes: MonitorChange[]
  /** So với lần chạy ngày nào (null = lần đầu, chỉ lưu). */
  comparedTo: string | null
  teams: { sent: boolean; skipped?: string; error?: string }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const fmtL = (n: number, loc: string) => n.toLocaleString(loc, { maximumFractionDigits: 1 })
const fmt = (n: number) => fmtL(n, "vi-VN")

/** Hàm thuần: kết quả Chẩn đoán gắn thẻ + Sức khoẻ đo lường → ảnh chụp gọn. */
export function snapshotOf(company: Company, tags: TagDoctorReport | null, meta: MetaHealth | null, errors: string[] = []): CompanySnapshot {
  const snap: CompanySnapshot = {
    company, metaOk: !!meta, tagsOk: !!tags, errors, issues: [], gtm: [], stopped: [], customVariants: [], googleGoals: [], primarySilent: [],
  }
  if (tags) {
    snap.issues = tags.issues.filter((i) => !i.id.startsWith("meta_variant_") && !i.id.startsWith("google_primary_silent_"))
      .map((i) => ({ id: i.id, severity: i.severity, title: i.title }))
    snap.gtm = tags.gtm.map((g) => ({ id: g.id, version: g.version, tags: g.pixelTags.map((t) => ({ tagId: t.tagId, kind: t.kind, eventName: t.eventName })) }))
    snap.googleGoals = tags.googleGoals.filter((g) => g.origin === "WEBSITE").map((g) => ({ category: g.category, origin: g.origin, biddable: g.biddable }))
    snap.roadmap = (tags.roadmap ?? []).map((r) => ({ id: r.id, label: r.label, status: r.status, action: r.action }))
    snap.primarySilent = tags.googleActions.filter((a) => a.category === "PURCHASE" && a.origin === "WEBSITE" && a.primary && a.last7 === 0).map((a) => ({ name: a.name, total: a.total }))
  }
  if (meta) {
    const stdNorm = new Set(STANDARD_EVENTS.map(normEvent))
    for (const p of meta.pixels.filter((x) => x.known)) {
      for (const e of p.events) {
        const d = e.perDay
        if (STANDARD_EVENTS.includes(e.name) && d.length >= 9) {
          // perDay[-1] = hôm nay (chưa hết ngày) → "hôm qua" = perDay[-2]; 7 ngày trước đó = perDay[-9..-3].
          const yesterday = d[d.length - 2]
          const prevAvg = d.slice(-9, -2).reduce((s, x) => s + x, 0) / 7
          if (yesterday === 0 && prevAvg >= STOPPED_MIN_AVG) snap.stopped.push({ pixelId: p.pixelId, name: e.name, prevAvg: round1(prevAvg) })
        }
        const last7 = d.slice(-7).reduce((s, x) => s + x, 0)
        if (!STANDARD_EVENTS.includes(e.name) && stdNorm.has(normEvent(e.name)) && last7 > 0) snap.customVariants.push({ pixelId: p.pixelId, name: e.name, last7 })
      }
    }
  }
  return snap
}

/** Hàm thuần: so hai ảnh chụp cùng công ty → thay đổi. Phần nào một bên không đọc được thì KHÔNG so. */
export function diffSnapshots(prev: CompanySnapshot, cur: CompanySnapshot, t: TFunction = makeT("vi")): MonitorChange[] {
  const fmt = (n: number) => fmtL(n, t("libcase.r.numLocale"))
  const co = cur.company
  const out: MonitorChange[] = []
  const add = (level: ChangeLevel, text: string) => out.push({ company: co, level, text: `${co} · ${text}` })
  if (prev.tagsOk && cur.tagsOk) {
    const prevIds = new Set(prev.issues.map((i) => i.id)), curIds = new Set(cur.issues.map((i) => i.id))
    for (const i of cur.issues) if (!prevIds.has(i.id) && i.severity === "bad") add("bad", t("libcase.r.mm.newIssue", { title: i.title }))
    for (const i of prev.issues) if (!curIds.has(i.id)) add("good", t("libcase.r.mm.fixed", { title: i.title }))
    for (const g of cur.gtm) {
      const p = prev.gtm.find((x) => x.id === g.id)
      if (!p || p.version === g.version) continue
      const diffs = g.tags.flatMap((gt) => {
        const o = p.tags.find((x) => x.tagId === gt.tagId)
        if (!o) return [t("libcase.r.mm.tagNew", { id: gt.tagId, kind: gt.kind, ev: gt.eventName })]
        return o.kind !== gt.kind || o.eventName !== gt.eventName ? [t("libcase.r.mm.tagChg", { id: gt.tagId, ok: o.kind, oe: o.eventName, nk: gt.kind, ne: gt.eventName })] : []
      })
      const removed = p.tags.filter((o) => !g.tags.some((x) => x.tagId === o.tagId)).map((o) => t("libcase.r.mm.tagRm", { id: o.tagId, ev: o.eventName }))
      add("info", t("libcase.r.mm.gtm", { id: g.id, from: p.version ?? "?", to: g.version ?? "?", rest: [...diffs, ...removed].length ? `: ${[...diffs, ...removed].join("; ")}` : t("libcase.r.mm.gtmSame") }))
    }
    for (const g of cur.googleGoals) {
      const p = prev.googleGoals.find((x) => x.category === g.category && x.origin === g.origin)
      if (p && p.biddable !== g.biddable) add("info", t("libcase.r.mm.goal", { cat: g.category, a: p.biddable ? t("libcase.r.mm.bid") : t("libcase.r.mm.nobid"), b: g.biddable ? t("libcase.r.mm.bid") : t("libcase.r.mm.nobid") }))
    }
    // Lộ trình: bước vừa xong → báo "xong" + việc tiếp theo.
    for (const r of cur.roadmap ?? []) {
      const p = (prev.roadmap ?? []).find((x) => x.id === r.id)
      if (p && p.status !== "done" && r.status === "done") {
        const next = (cur.roadmap ?? []).find((x) => x.status === "todo")
        add("good", t("libcase.r.mm.road", { label: r.label, rest: next ? t("libcase.r.mm.roadNext", { label: next.label, action: next.action }) : t("libcase.r.mm.roadAll") }))
      }
      if (p && p.status === "done" && r.status !== "done") add("bad", t("libcase.r.mm.roadBack", { label: r.label }))
    }
    const ps = new Set(prev.primarySilent.map((x) => x.name)), cs = new Set(cur.primarySilent.map((x) => x.name))
    for (const x of cur.primarySilent) if (!ps.has(x.name)) add("bad", t("libcase.r.mm.silent", { name: x.name }))
    for (const x of prev.primarySilent) if (!cs.has(x.name)) add("good", t("libcase.r.mm.silentBack", { name: x.name }))
  }
  if (prev.metaOk && cur.metaOk) {
    const k = (x: { pixelId: string; name: string }) => `${x.pixelId}|${x.name}`
    const pStop = new Set(prev.stopped.map(k)), cStop = new Set(cur.stopped.map(k))
    for (const s of cur.stopped) if (!pStop.has(k(s))) add("bad", t("libcase.r.mm.stopped", { name: s.name, avg: fmt(s.prevAvg) }))
    for (const s of prev.stopped) if (!cStop.has(k(s))) add("good", t("libcase.r.mm.resumed", { name: s.name }))
    const pVar = new Map(prev.customVariants.map((x) => [k(x), x])), cVar = new Set(cur.customVariants.map(k))
    for (const v of cur.customVariants) if (!pVar.has(k(v))) add("bad", t("libcase.r.mm.variant", { name: v.name, n: fmt(v.last7) }))
    for (const v of prev.customVariants) if (!cVar.has(k(v))) add("good", t("libcase.r.mm.variantStop", { name: v.name, n: fmt(v.last7) }))
  }
  return out
}

// ── Lưu trữ ──
const fileOf = (date: string) => path.join(DIR, `${date}.json`)
export function listRuns(limit = 7): MonitorRun[] {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, limit)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8")) as MonitorRun } catch { return null } })
    .filter((x): x is MonitorRun => !!x)
}
function saveRun(run: MonitorRun) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
  writeFileAtomicSync(fileOf(run.date), JSON.stringify(run, null, 1))
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  for (const f of fs.readdirSync(DIR)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)
    if (m && Date.parse(m[1]) < cutoff) { try { fs.unlinkSync(path.join(DIR, f)) } catch { /* lần sau */ } }
  }
}

export const monitorWebhook = () => (process.env.MEASURE_MONITOR_TEAMS_WEBHOOK || process.env.CASE_TASK_TEAMS_WEBHOOK || "").trim()

export async function runMonitor(companies: Company[] = ["MBI", "MBC"], now: Date = new Date()): Promise<MonitorRun> {
  const date = vnDate(now)
  const snapshots: CompanySnapshot[] = []
  for (const co of companies) {
    const errors: string[] = []
    let tags: TagDoctorReport | null = null, meta: MetaHealth | null = null
    try { tags = await tagDoctor(co, { force: true }) } catch (e) { errors.push(`Chẩn đoán gắn thẻ: ${e instanceof Error ? e.message : String(e)}`) }
    try { meta = await metaHealth(co) } catch (e) { errors.push(`Sức khoẻ đo lường Meta: ${e instanceof Error ? e.message : String(e)}`) }
    // Chẩn đoán gắn thẻ tự nuốt lỗi từng nguồn → nguồn Google hỏng thì coi phần gắn thẻ là không đọc được.
    if (tags && tags.sources.some((s) => s.id === "google" && s.status === "error")) { errors.push("Google Ads không đọc được"); tags = null }
    snapshots.push(snapshotOf(co, tags, meta, errors))
  }
  // Lần chạy gần nhất TRƯỚC hôm nay (chạy lại trong ngày → vẫn so với hôm trước, ghi đè bản hôm nay).
  const prevRun = listRuns(10).find((r) => r.date < date) ?? null
  const changes: MonitorChange[] = []
  for (const s of snapshots) {
    const p = prevRun?.snapshots.find((x) => x.company === s.company)
    if (p) changes.push(...diffSnapshots(p, s))
    if (s.errors.length) changes.push({ company: s.company, level: "info", text: `${s.company} · Không đọc được: ${s.errors.join("; ")} — không so phần này hôm nay` })
  }
  const run: MonitorRun = { date, at: now.toISOString(), snapshots, changes, comparedTo: prevRun?.date ?? null, teams: { sent: false } }
  const real = changes.filter((c) => c.level !== "info" || !c.text.includes("Không đọc được"))
  if (!prevRun) run.teams.skipped = "Lần chạy đầu — chỉ lưu, chưa có gì để so"
  else if (!real.length) run.teams.skipped = "Không có thay đổi — không gửi Teams"
  else {
    const webhookUrl = monitorWebhook()
    if (!webhookUrl) run.teams.skipped = "Chưa cấu hình kênh Teams (MEASURE_MONITOR_TEAMS_WEBHOOK hoặc CASE_TASK_TEAMS_WEBHOOK)"
    else {
      const bad = real.filter((c) => c.level === "bad").length, good = real.filter((c) => c.level === "good").length
      const r = await sendTeamsAlert({
        webhookUrl, level: bad ? "danger" : good ? "good" : "warning",
        title: `${bad ? "⚠" : "✓"} Giám sát đo lường — ${bad} hỏng mới, ${good} đã khỏi, ${real.length - bad - good} thông tin`,
        facts: real.slice(0, 20).map((c) => ({ title: c.level === "bad" ? "✕ Hỏng mới" : c.level === "good" ? "✓ Đã khỏi" : "ℹ Thông tin", value: c.text })),
        action: "Mở AdsCommand → Sức khoẻ đo lường → Chẩn đoán gắn thẻ để xem chi tiết.",
      })
      run.teams = r.sent ? { sent: true } : { sent: false, error: r.error }
    }
  }
  saveRun(run)
  return run
}

/** Bản theo ngôn ngữ của các thay đổi trong một lần chạy đã lưu (cho giao diện): dựng lại từ ảnh chụp hai ngày nên không phụ thuộc chữ đã lưu.
 *  `all` = các lần chạy đã lưu (để tìm lần so sánh). Không tìm thấy lần so sánh → giữ nguyên chữ đã lưu. */
export function localizedChanges(run: MonitorRun, all: MonitorRun[], t: TFunction): MonitorChange[] {
  if (t("libcase.r.numLocale") === "vi-VN") return run.changes
  const prev = run.comparedTo ? all.find((r) => r.date === run.comparedTo) : null
  if (!prev) return run.changes
  const out: MonitorChange[] = []
  for (const s of run.snapshots) {
    const p = prev.snapshots.find((x) => x.company === s.company)
    if (p) out.push(...diffSnapshots(p, s, t))
    if (s.errors.length) out.push({ company: s.company, level: "info", text: t("libcase.r.mm.notRead", { co: s.company, errs: s.errors.join("; ") }) })
  }
  return out
}

/** Lý do không gửi Teams theo ngôn ngữ (chuỗi đã lưu bằng tiếng Việt → nhận ra rồi dịch; lạ thì giữ nguyên). */
export function localizedTeams(teams: MonitorRun["teams"], t: TFunction): MonitorRun["teams"] {
  const map: Record<string, string> = {
    "Lần chạy đầu — chỉ lưu, chưa có gì để so": "libcase.r.mm.skipFirst",
    "Không có thay đổi — không gửi Teams": "libcase.r.mm.skipNone",
    "Chưa cấu hình kênh Teams (MEASURE_MONITOR_TEAMS_WEBHOOK hoặc CASE_TASK_TEAMS_WEBHOOK)": "libcase.r.mm.skipWebhook",
  }
  const key = teams.skipped ? map[teams.skipped] : undefined
  return key ? { ...teams, skipped: t(key as never) } : teams
}
