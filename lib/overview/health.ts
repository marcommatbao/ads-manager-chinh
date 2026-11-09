// ============================================================
// Tình trạng & cảnh báo (Đợt 5) — gộp phát hiện của Đợt 1–4 vào MỘT chỗ
// ============================================================
// Trang Tổng quan cũ chỉ có chi phí + Odoo; mọi phát hiện nằm rải ở /xu-ly,
// /do-luong, /xu-ly/theo-doi. Ở đây KHÔNG gọi API mới — chỉ gọi lại các hàm có
// sẵn (mỗi hàm có đệm 10–30 phút riêng), mỗi nguồn chạy độc lập: nguồn hỏng →
// thẻ đó "không đọc được", thẻ khác vẫn hiện, không bao giờ hiện số cũ như mới.
//
// Thứ tự "Sửa gì trước": (a) đo lường chặn mọi thứ khác → (b) tiền chi vượt
// trần → (c) việc giao người quá hạn. Số đo sai thì mọi kết luận về tiền sai theo.

import { caseBoard, remindersEnabled } from "@/lib/case/board"
import { googleOverview, metaOverview, type OverviewRow } from "@/lib/case/service"
import { lastDays } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { metaHealth, type MetaHealth } from "@/lib/measure/meta-health"
import { tagDoctor, type TagDoctorReport } from "@/lib/measure/tag-doctor"
import { lastStatuses, leadFlowMessage, type LeadFlowStatus } from "@/lib/monitor/lead-flow"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { pmaxXray, type PmaxXray } from "@/lib/pmax/xray"

export type CardTone = "ok" | "warn" | "bad" | "unknown"
export interface StatusCard { id: string; title: string; tone: CardTone; text: string; href: string; error?: string }
export interface FixItem {
  id: string; rank: "measurement" | "money" | "overdue"; company: Company
  title: string; why: string; suggestion: string; href: string; hrefLabel: string; money?: number
}
export interface HealthOverview {
  companies: Company[]; generatedAt: string; cards: StatusCard[]; fixes: FixItem[]; notes: string[]
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string }
const settle = async <T,>(p: Promise<T>): Promise<Settled<T>> => {
  try { return { ok: true, value: await p } } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}
const worst = (ts: CardTone[]): CardTone => (ts.includes("bad") ? "bad" : ts.includes("warn") ? "warn" : ts.includes("unknown") ? "unknown" : "ok")

/** Hàm thuần: kết quả từng nguồn → thẻ + danh sách ưu tiên + lưu ý. */
export function buildHealthOverview(input: {
  companies: Company[]
  meta: Record<string, Settled<MetaHealth>>
  tags: Record<string, Settled<TagDoctorReport>>
  campaigns: Record<string, Settled<OverviewRow[]>>
  board: Settled<ReturnType<typeof caseBoard>>
  remindersOn: boolean
  /** Đợt 9 · 1 — kết quả lần canh đường lead gần nhất (job lead_flow_watch). */
  leadFlows?: LeadFlowStatus[]
  /** Đợt 10a — PMax X-quang 30 ngày theo công ty. */
  pmax?: Record<string, Settled<PmaxXray>>
  now?: Date
  /** Ngôn ngữ hiển thị (mặc định tiếng Việt). */
  t?: TFunction
}): HealthOverview {
  const t = input.t ?? makeT("vi")
  const loc = t("libcase.r.numLocale")
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(loc)}`
  const cards: StatusCard[] = []
  const fixes: FixItem[] = []
  const notes: string[] = []
  const cos = input.companies

  // ── PMax: kênh ăn tiền nhờ đơn sau lượt xem, ăn lượt tìm thương hiệu ──
  if (input.pmax) {
    const parts: string[] = [], tones: CardTone[] = []
    let err: string | undefined
    for (const co of cos) {
      const r = input.pmax[co]
      if (!r) continue
      if (!r.ok) { tones.push("unknown"); err = r.error; continue }
      const x = r.value
      if (!x.account.totals.cost) continue
      const bad = x.account.warnings.filter((w) => w.level === "bad")
      const brand = x.cannibalization.pmaxClicks >= 30 ? x.cannibalization.brandShare : 0
      tones.push(bad.length ? "bad" : brand >= 0.4 ? "warn" : "ok")
      parts.push(`${co}: ${t("libcase.r.health.1", { cost: Math.round(x.account.totals.cost).toLocaleString(loc), conv: Math.round(x.account.totals.convClick), eng: Math.round(x.account.totals.convEngaged) })}${brand >= 0.4 ? t("libcase.r.health.2", { pct: Math.round(brand * 100) }) : ""}`)
      for (const w of bad) fixes.push({
        id: `pmax_${co}_${w.id}`, rank: "money", company: co, money: 0,
        title: `${co} · PMax: ${w.text.split(";")[0]}`, why: w.text,
        suggestion: t("libcase.r.health.3"),
        href: "/google-pmax?tab=xray", hrefLabel: t("libcase.r.health.4"),
      })
    }
    if (parts.length || err) cards.push({ id: "pmax", title: "PMax", tone: worst(tones.length ? tones : ["unknown"]), text: parts.join(" · ") || t("libcase.r.health.5"), href: "/google-pmax?tab=xray", error: err })
  }

  // ── Đường lead: form trên web ↔ lead trong CRM ──
  {
    const flows = (input.leadFlows ?? []).filter((f) => cos.includes(f.flow.company))
    if (flows.length) {
      const tone = worst(flows.map((f) => (f.status === "broken" ? "bad" : f.status === "error" ? "unknown" : "ok")))
      cards.push({ id: "leads", title: t("libcase.r.health.6"), tone, href: "/?tab=health#duong-lead",
        text: flows.map((f) => `${f.flow.label}: ${f.status === "broken" ? "✕ " : f.status === "error" ? "? " : "✓ "}${leadFlowMessage(f, t)}`).join(" · ") })
      for (const f of flows.filter((x) => x.status === "broken")) fixes.push({
        id: `lead_flow_${f.flow.id}`, rank: "measurement", company: f.flow.company,
        title: t("libcase.r.health.7", { label: f.flow.label }),
        why: leadFlowMessage(f, t), suggestion: t("libcase.r.health.8"),
        href: "/?tab=health#duong-lead", hrefLabel: t("libcase.r.health.9"),
      })
    }
  }

  // ── Đo lường Meta ──
  {
    const parts: string[] = [], tones: CardTone[] = []
    let err: string | undefined
    for (const co of cos) {
      const m = input.meta[co]
      if (!m?.ok) { tones.push("unknown"); err = m?.error; parts.push(t("libcase.r.health.10", { co })); continue }
      const probs = m.value.products.flatMap((p) => p.optEvents.map((e) => ({ p, e }))).filter(({ e }) => e.status === "dead" || e.status === "low" || e.allFail || e.adsLow)
      const landing = m.value.landing.filter((l) => l.flagged).length
      const nv = m.value.noValue.length
      tones.push(probs.length || nv ? "bad" : landing ? "warn" : "ok")
      parts.push(t("libcase.r.health.11", { co, probs: probs.length, nv, landing }))
      for (const { p, e } of probs.slice(0, 3)) {
        fixes.push({
          id: `meta_opt_${co}_${p.group}_${e.label}`, rank: "measurement", company: co,
          title: t("libcase.r.health.12", { co, label: p.label, event: e.label, custom: e.custom ? t("libcase.r.health.13") : "", n: e.adsAttributed }),
          why: t("libcase.r.health.14"),
          suggestion: e.custom ? t("libcase.r.health.15") : t("libcase.r.health.16"),
          href: "/xu-ly", hrefLabel: t("libcase.r.health.17"),
        })
      }
      if (m.value.links.postUnreadable > 0) notes.push(t("libcase.r.health.18", { co, n: m.value.links.postUnreadable }))
    }
    cards.push({ id: "meta", title: t("libcase.r.health.19"), tone: worst(tones), text: parts.join(" · "), href: "/do-luong", error: err })
  }

  // ── Đo lường Google + Gắn thẻ (cùng nguồn Chẩn đoán gắn thẻ) ──
  {
    const gParts: string[] = [], gTones: CardTone[] = [], tParts: string[] = [], tTones: CardTone[] = []
    let err: string | undefined
    for (const co of cos) {
      const tg = input.tags[co]
      if (!tg?.ok) { gTones.push("unknown"); tTones.push("unknown"); err = tg?.error; gParts.push(t("libcase.r.health.10", { co })); tParts.push(t("libcase.r.health.10", { co })); continue }
      const gIssues = tg.value.issues.filter((i) => i.platform === "google")
      const tIssues = tg.value.issues.filter((i) => i.platform !== "google")
      gTones.push(gIssues.some((i) => i.severity === "bad") ? "bad" : gIssues.length ? "warn" : "ok")
      tTones.push(tIssues.some((i) => i.severity === "bad") ? "bad" : tIssues.length ? "warn" : "ok")
      gParts.push(gIssues.length ? `${co}: ${gIssues[0].title}` : t("libcase.r.health.20", { co }))
      tParts.push(tIssues.length ? t("libcase.r.health.21", { co, n: tIssues.length, bad: tIssues.filter((i) => i.severity === "bad").length }) : t("libcase.r.health.22", { co }))
      // Google: sửa trigger/hành động chính TRƯỚC, đổi mục tiêu SAU.
      const silent = gIssues.filter((i) => i.id.startsWith("google_primary_silent_"))
      const goal = gIssues.find((i) => i.id === "google_goal_not_purchase")
      for (const i of silent) fixes.push({ id: `${co}_${i.id}`, rank: "measurement", company: co, title: `${co} · ${i.title}`, why: t("libcase.r.health.23"), suggestion: i.steps[0] ?? i.detail, href: "/do-luong?tab=tags", hrefLabel: t("libcase.r.health.24") })
      if (goal) fixes.push({
        id: `${co}_${goal.id}`, rank: "measurement", company: co, title: `${co} · ${goal.title}`,
        why: t("libcase.r.health.25"),
        suggestion: silent.length ? t("libcase.r.health.26") : t("libcase.r.health.27"),
        href: "/do-luong?tab=tags", hrefLabel: t("libcase.r.health.28"),
      })
      for (const i of tIssues.filter((x) => x.severity === "bad").slice(0, 2)) fixes.push({ id: `${co}_${i.id}`, rank: "measurement", company: co, title: `${co} · ${i.title}`, why: i.detail, suggestion: i.steps[0] ?? "", href: "/do-luong?tab=tags", hrefLabel: t("libcase.r.health.24") })
    }
    cards.push({ id: "google", title: t("libcase.r.health.29"), tone: worst(gTones), text: gParts.join(" · "), href: "/do-luong?tab=google", error: err })
    cards.push({ id: "tags", title: t("libcase.r.health.30"), tone: worst(tTones), text: tParts.join(" · "), href: "/do-luong?tab=tags", error: err })
  }

  // ── Chiến dịch (Google + Facebook, chấm theo mục tiêu sản phẩm) ──
  {
    const tones: CardTone[] = [], parts: string[] = []
    let err: string | undefined
    const reds: (OverviewRow & { company: Company; platform: string })[] = []
    let judged = 0, noTarget = 0
    for (const co of cos) for (const pf of ["google", "facebook"]) {
      const r = input.campaigns[`${co}|${pf}`]
      if (!r?.ok) { tones.push("unknown"); err = r?.error; parts.push(t("libcase.r.health.32", { co, pf: pf === "google" ? "Google" : "Facebook" })); continue }
      const red = r.value.filter((x) => x.verdict.status === "red")
      noTarget += r.value.filter((x) => x.verdict.status === "no_target").length
      judged += r.value.filter((x) => x.verdict.status !== "no_target").length
      reds.push(...red.map((x) => ({ ...x, company: co, platform: pf })))
      tones.push(red.length ? "bad" : r.value.some((x) => x.verdict.status === "amber") ? "warn" : "ok")
    }
    const over = reds.reduce((s, x) => s + (x.verdict.overCeiling ?? 0), 0)
    // Chưa đặt mục tiêu sản phẩm = KHÔNG chấm được — báo "ổn" lúc đó là sai (đo 27/09: prod chưa nhập mục tiêu).
    if (noTarget) tones.push("warn") // đọc được, chỉ là chưa có mục tiêu để chấm — không phải "không đọc được"
    parts.unshift(reds.length ? t("libcase.r.health.33", { n: reds.length, over: vnd(over) })
      : judged ? t("libcase.r.health.34") : t("libcase.r.health.35"))
    if (noTarget) parts.push(t("libcase.r.health.36", { n: noTarget }))
    cards.push({ id: "campaigns", title: t("libcase.r.health.31"), tone: worst(tones), text: parts.join(" · "), href: noTarget && !judged ? "/xu-ly/muc-tieu" : "/xu-ly", error: err })
    if (noTarget) fixes.push({
      id: "set_targets", rank: "money", company: cos[0], money: 0,
      title: t("libcase.r.health.37", { n: noTarget }),
      why: t("libcase.r.health.38"),
      suggestion: t("libcase.r.health.39"), href: "/xu-ly/muc-tieu", hrefLabel: t("libcase.r.health.40"),
    })
    for (const x of reds.sort((a, b) => (b.verdict.overCeiling ?? 0) - (a.verdict.overCeiling ?? 0)).slice(0, 5)) {
      fixes.push({
        id: `money_${x.platform}_${x.campaignId}`, rank: "money", company: x.company, money: x.verdict.overCeiling ?? 0,
        title: `${x.company} · ${x.platform === "google" ? "Google" : "Facebook"} · ${x.name}`,
        why: t("libcase.r.health.41", { label: x.verdict.label, over: vnd(x.verdict.overCeiling ?? 0) }),
        suggestion: x.latestCase ? t("libcase.r.health.42") : t("libcase.r.health.43"),
        href: x.latestCase ? `/xu-ly/${x.latestCase.id}` : "/xu-ly", hrefLabel: x.latestCase ? t("libcase.r.health.44") : t("libcase.r.health.45"),
      })
    }
  }

  // ── Phiên xử lý ──
  if (!input.board.ok) cards.push({ id: "cases", title: t("libcase.r.health.46"), tone: "unknown", text: t("libcase.r.health.5"), href: "/xu-ly/theo-doi", error: input.board.error })
  else {
    const rows = input.board.value
    const n = (s: string) => rows.filter((r) => r.state === s).length
    const overdue = rows.reduce((s, r) => s + r.tasks.overdue, 0)
    const pending = rows.flatMap((r) => r.remeasure.filter((m) => m && !m.done).map((m) => m!.due)).sort()
    cards.push({
      id: "cases", title: t("libcase.r.health.46"), tone: n("reopened") || overdue ? "warn" : "ok", href: "/xu-ly/theo-doi",
      text: t("libcase.r.health.47", { open: n("working"), w: n("waiting"), near: pending.length ? t("libcase.r.health.48", { d: pending[0] }) : "", re: n("reopened"), od: overdue }),
    })
    for (const r of rows.filter((x) => x.tasks.overdue > 0)) {
      fixes.push({ id: `overdue_${r.id}`, rank: "overdue", company: r.company, title: t("libcase.r.health.49", { co: r.company, name: r.campaignName, n: r.tasks.overdue }), why: t("libcase.r.health.50"), suggestion: t("libcase.r.health.51"), href: `/xu-ly/${r.id}`, hrefLabel: t("libcase.r.health.44") })
    }
  }

  // ── Lưu ý khi đọc số (không phải lỗi) ──
  notes.unshift(
    t("libcase.r.health.52"),
    t("libcase.r.health.53"),
  )
  notes.push(input.remindersOn ? t("libcase.r.health.54") : t("libcase.r.health.55"))

  const order = { measurement: 0, money: 1, overdue: 2 }
  fixes.sort((a, b) => order[a.rank] - order[b.rank] || (b.money ?? 0) - (a.money ?? 0))
  return { companies: cos, generatedAt: (input.now ?? new Date()).toISOString(), cards, fixes, notes }
}

export async function healthOverview(companies: Company[], opts: { force?: boolean; t?: TFunction } = {}): Promise<HealthOverview> {
  const range = lastDays(30)
  const meta: Record<string, Settled<MetaHealth>> = {}, tags: Record<string, Settled<TagDoctorReport>> = {}, campaigns: Record<string, Settled<OverviewRow[]>> = {}
  // Tuần tự theo công ty để không nện hạn mức Meta cùng lúc; trong một công ty chạy song song.
  for (const co of companies) {
    const [m, t, g, f] = await Promise.all([
      settle(metaHealth(co, { force: opts.force })), settle(tagDoctor(co, { force: opts.force })),
      settle(googleOverview(co, range).then((r) => r.rows)), settle(metaOverview(co, range).then((r) => r.rows)),
    ])
    meta[co] = m; tags[co] = t; campaigns[`${co}|google`] = g; campaigns[`${co}|facebook`] = f
  }
  const board = await settle(Promise.resolve(caseBoard(companies)))
  const pmax: Record<string, Settled<PmaxXray>> = {}
  for (const co of companies) pmax[co] = await settle(pmaxXray(co, lastDays(30)))
  return buildHealthOverview({ companies, meta, tags, campaigns, board, remindersOn: remindersEnabled(), leadFlows: lastStatuses(), pmax, t: opts.t })
}
