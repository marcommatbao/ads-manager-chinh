// ============================================================
// 14/10/2026 — "Nên làm gì tiếp" sau khi đo lại phiên xử lý — HÀM THUẦN
// ============================================================
// Trước đây trang phiên chỉ hiện "₫354k → ₫707k ▲ xấu hơn" mà không nói vì sao, cũng không nói làm gì. Hàm này đọc lần đo gần
// nhất (mốc 7/14 ngày hoặc "Kiểm tra ngay") và trả:
//   • kết luận — tôn trọng "chưa đủ dữ liệu" (lib/case/judge.ts): mẫu nhỏ thì KHÔNG khuyên hoàn tác / làm lại;
//   • "vì sao" — so TỈ LỆ (CPC, CTR, tỉ lệ chuyển đổi, tỉ lệ hiển thị…) với lúc mở phiên. Không so số tuyệt đối vì hai kỳ dài
//     khác nhau (lúc mở phiên thường 30 ngày, kỳ đo = từ ngày thực hiện tới hôm nay);
//   • nguyên nhân mới phát sinh — bộ tìm nguyên nhân bước 4 chạy lại trên số kỳ đo (lưu sẵn trong remeasure[].diag);
//   • việc nên làm + nút: Mở lại ở bước 4 (tính lại hướng xử lý cụ thể), Hoàn tác (chỉ khi XẤU HƠN), Kiểm tra ngay.

import type { CampaignCase, RemeasureDiag, RemeasureEntry } from "./store"
import { judgeRemeasure, VERDICT_CODE } from "./judge"
import { metaGoalKind, metaResults } from "./goal-kind"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type NextVerdict = "improved" | "same" | "worse" | "insufficient"
const CODE: Record<number, NextVerdict> = { 1: "improved", 0: "same", [-1]: "worse", 2: "insufficient" }

export interface WhyRow { id?: string; label: string; before: string; after: string; change: string | null; tone: "bad" | "good" | "neutral" }
export interface TodoItem { kind: "reopen" | "undo" | "wait" | "check" | "settings" | "info"; text: string; href?: string }
export interface NextStepsView {
  source: { kind: "remeasure" | "check"; at: string; from: string | null; to: string | null } | null
  verdict: NextVerdict | null
  basis: "cpa" | "roas" | "cpl"
  orders: { before: number | null; after: number | null }
  headline: string
  why: WhyRow[]
  newCauses: RemeasureDiag["causes"]
  persistingCauses: RemeasureDiag["causes"]
  todo: TodoItem[]
  undoable: { executionId: string; at: string; summary: string }[]
  canReopen: boolean
  canCheck: boolean
  /** Lần đo không có ảnh chụp chẩn đoán (đo trước 14/10) — chỉ có kết luận, chưa giải thích được "vì sao". */
  missingDiag: boolean
}

const K = (k: string): never => `libcase.s.ns.${k}` as never
const numLocale = (t: TFunction) => t("libcase.s.numLocale")
const vndT = (t: TFunction) => (n: number) => t("libcase.s.ns.vnd", { n: Math.round(n).toLocaleString(numLocale(t)) })
const pct1T = (t: TFunction) => (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString(numLocale(t))}%`
const rel = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b - 1 : null)
const div = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b : null)
const signed = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`
/** Thay đổi tương đối đủ lớn để nêu ra (dưới mức này coi như không đổi — tránh liệt kê nhiễu). */
export const WHY_REL = 0.15
/** Thay đổi tỉ lệ hiển thị (điểm phần trăm) đủ lớn để nêu ra. */
export const WHY_PT = 0.05

interface Measured { kind: "remeasure" | "check"; at: string; verdict: number | null; result: Record<string, number | null>; diag: RemeasureDiag | null }

/** Lần đo gần nhất: mốc đo đã xong mới nhất, hoặc "Kiểm tra ngay" nếu mới hơn. */
export function latestMeasure(c: CampaignCase): Measured | null {
  const done = c.remeasure.filter((r) => r.status === "done" && r.result)
  const last = done[done.length - 1]
  const fromRm: Measured | null = last ? { kind: "remeasure", at: last.due, verdict: rejudge(c, last), result: last.result!, diag: last.diag ?? null } : null
  const chk = c.latestCheck
  const fromCheck: Measured | null = chk ? { kind: "check", at: chk.at.slice(0, 10), verdict: rejudge(c, { due: chk.at.slice(0, 10), result: chk.result }), result: chk.result, diag: chk.diag } : null
  if (fromRm && fromCheck) return fromCheck.at >= fromRm.at ? fromCheck : fromRm
  return fromRm ?? fromCheck
}
const num = (v: unknown) => (typeof v === "number" ? v : null)

/** 14/10: chấm LẠI một lần đo đã lưu theo luật hiện hành (lib/case/judge.ts) — lần đo trước 14/10 lưu "xấu hơn" dù chỉ vài đơn.
 *  Cần đủ cost + orders trong result và bằng chứng lúc mở phiên. Lần đo của vòng TRƯỚC khi mở lại (mốc so sánh đã đổi) → giữ kết
 *  luận đã lưu. Hàm thuần. */
export function rejudge(c: CampaignCase, r: Pick<RemeasureEntry, "due" | "result">): number | null {
  const res = r.result
  const stored = num(res?.verdict)
  const ev = c.evidence
  if (!res || !ev || typeof res.cost !== "number" || typeof res.orders !== "number") return stored
  if (c.reopenedAt && r.due < c.reopenedAt.slice(0, 10)) return stored
  const before = ev.kind === "meta"
    ? { cost: ev.campaign.cost, orders: metaResults(ev.campaign, metaGoalKind(ev.campaign.objective)), value: res.leads ? 0 : ev.campaign.purchaseValue }
    : { cost: ev.campaign.cost, orders: ev.campaign.orders, value: ev.campaign.orderValue ?? 0 }
  const after = { cost: res.cost, orders: res.orders, value: res.orderValue ?? 0 }
  const goal = c.goal ? { basis: c.goal.basis, target: c.goal.target, ceiling: c.goal.ceiling } : null
  return VERDICT_CODE[judgeRemeasure(goal, before, after).verdict]
}

function executionSummary(e: CampaignCase["executions"][number], t: TFunction): string {
  const parts: string[] = []
  if (e.created.length) parts.push(t(K("exCreated"), { n: e.created.length }))
  if (e.removed.length) parts.push(t(K("exRemoved"), { n: e.removed.length }))
  if (e.paused.length) parts.push(t(K("exPaused"), { n: e.paused.length }))
  if (e.sharedCreated?.length) parts.push(t(K("exShared"), { n: e.sharedCreated.length }))
  if (e.attached?.length) parts.push(t(K("exAttached"), { n: e.attached.length }))
  if (e.metaChanges?.length) parts.push(t(K("exMeta"), { n: e.metaChanges.length }))
  return parts.join(", ") || t(K("exNone"))
}

/** Bảng "vì sao": tỉ lệ lúc mở phiên → kỳ đo. Chỉ nêu dòng đổi đủ lớn. */
export function whyRows(c: CampaignCase, m: Measured, t: TFunction = makeT("vi")): WhyRow[] {
  const vnd = vndT(t), pct1 = pct1T(t)
  const ev = c.evidence
  const f = m.diag?.facts
  if (!ev || !f) return []
  const out: WhyRow[] = []
  const push = (id: string, b: number | null, a: number | null, fmt: (x: number) => string, badWhenUp: boolean, mode: "rel" | "pt" = "rel") => {
    if (b === null || a === null) return
    const change = mode === "rel" ? rel(a, b) : a - b
    if (change === null || Math.abs(change) < (mode === "rel" ? WHY_REL : WHY_PT)) return
    const bad = badWhenUp ? change > 0 : change < 0
    out.push({ id, label: t(K("why." + id)), before: fmt(b), after: fmt(a), change: mode === "rel" ? signed(change) : t(K("pts"), { v: `${change > 0 ? "+" : ""}${Math.round(change * 100)}` }), tone: bad ? "bad" : "good" })
  }
  const cost = m.result.cost ?? f.cost ?? null
  if (ev.kind === "meta") {
    const b = ev.campaign
    push("cpm1000", div(b.cost * 1000, b.impressions), div((cost ?? 0) * 1000, f.impressions), vnd, true)
    push("linkCtr", div(b.linkClicks || b.clicks, b.impressions), div(f.linkClicks || f.clicks, f.impressions), pct1, false)
    push("landing", div(b.landingViews, b.linkClicks), div(f.landingViews, f.linkClicks), pct1, false)
    push("freq", b.frequency, f.frequency ?? null, (x) => x.toFixed(1), true)
    return out
  }
  const b = ev.campaign
  push("cpc", div(b.cost, b.clicks), div(cost, f.clicks), vnd, true)
  push("ctr", div(b.clicks, b.impressions), div(f.clicks, f.impressions), pct1, false)
  push("cvr", div(b.orders, b.clicks), div(m.result.orders ?? f.orders, f.clicks), pct1, false)
  push("isShare", b.impressionShare, f.impressionShare ?? null, pct1, false, "pt")
  push("lostRank", b.lostIsRank, f.lostIsRank ?? null, pct1, true, "pt")
  push("lostBudget", b.lostIsBudget, f.lostIsBudget ?? null, pct1, true, "pt")
  return out
}

export function nextSteps(c: CampaignCase, t: TFunction = makeT("vi")): NextStepsView {
  const vnd = vndT(t)
  const basis = c.goal?.basis ?? "cpa"
  const m = latestMeasure(c)
  const liveExec = c.executions.filter((e) => e.status === "done" && !e.undoneAt && e.mode !== "validate")
  const base: NextStepsView = {
    source: null, verdict: null, basis, orders: { before: null, after: null }, headline: "", why: [], newCauses: [], persistingCauses: [],
    todo: [], undoable: [], canReopen: false, canCheck: liveExec.length > 0, missingDiag: false,
  }
  if (!m) return { ...base, headline: liveExec.length ? t(K("noMeasureYet")) : t(K("noChanges")) }

  const verdict = m.verdict !== null ? CODE[m.verdict] ?? null : null
  const ev = c.evidence
  const ordersBefore = ev ? (ev.kind === "meta" ? (ev.campaign.leads && basis === "cpl" ? ev.campaign.leads : ev.campaign.purchases) : ev.campaign.orders) : null
  const ordersAfter = m.result.orders ?? null
  const unit = basis === "cpl" ? t("libcase.s.word.lead") : t("libcase.s.word.order")
  const why = whyRows(c, m, t)
  const known = new Set((c.diagnosis?.causes ?? []).map((x) => x.id))
  const causes = m.diag?.causes ?? []
  const view: NextStepsView = {
    ...base,
    source: { kind: m.kind, at: m.at, from: m.diag?.from ?? null, to: m.diag?.to ?? null },
    verdict, orders: { before: ordersBefore, after: ordersAfter }, why,
    newCauses: causes.filter((x) => !known.has(x.id)),
    persistingCauses: causes.filter((x) => known.has(x.id)),
    missingDiag: !m.diag,
  }
  const todo: TodoItem[] = []

  if (verdict === "improved") {
    view.headline = t(K("improved"))
    view.todo = todo
    return view
  }
  if (verdict === "insufficient") {
    const extensionsLeft = c.remeasure.some((r) => r.status === "pending")
    view.headline = t(K("insufficient"), { n: ordersAfter ?? 0, unit })
    todo.push({ kind: "wait", text: extensionsLeft
      ? t(K("waitMore"), { unit })
      : t(K("waitNoMore"), { unit }) })
    for (const w of why.filter((x) => x.tone === "bad")) todo.push({ kind: "info", text: t(K("notice"), { label: w.label.toLowerCase(), before: w.before, after: w.after, change: w.change ?? "" }) })
    view.todo = todo
    return view
  }

  // worse / same (hoặc lần đo cũ không có kết luận)
  view.headline = verdict === "worse"
    ? t(K("worse"), { before: ordersBefore ?? "?", after: ordersAfter ?? "?", unit })
    : verdict === "same"
      ? t(K("same"))
      : t(K("noVerdict"))
  if (!m.diag) {
    todo.push({ kind: "check", text: t(K("noDiag")) })
  }
  const byLabel = (id: string) => why.find((w) => w.id === id && w.tone === "bad")
  if (ev?.kind !== "meta") {
    const cvr = byLabel("cvr"), cpc = byLabel("cpc"), ctr = byLabel("ctr"), rank = byLabel("lostRank"), budget = byLabel("lostBudget")
    if (cvr) todo.push({ kind: "info", text: t(K("gCvr"), { before: cvr.before, after: cvr.after }) })
    if (cpc) {
      const bid = ev?.kind === "google_search" || ev?.kind === "google_pmax" ? ev.campaign : null
      const bidNote = bid?.biddingType === "TARGET_CPA" && bid.targetCpa ? t(K("gBidNote"), { cpa: vnd(bid.targetCpa), ceil: c.goal ? vnd(c.goal.ceiling) : "" }) : ""
      todo.push({ kind: "info", text: t(K("gCpc"), { before: cpc.before, after: cpc.after }) + bidNote })
    }
    if (rank) todo.push({ kind: "info", text: t(K("gRank"), { before: rank.before, after: rank.after }) })
    if (ctr) todo.push({ kind: "info", text: t(K("gCtr"), { before: ctr.before, after: ctr.after }) })
    if (budget) todo.push({ kind: "info", text: t(K("gBudget"), { before: budget.before, after: budget.after, unit }) })
  } else {
    const freq = byLabel("freq"), land = byLabel("landing"), cpm = byLabel("cpm1000"), ctr = byLabel("linkCtr")
    if (freq) todo.push({ kind: "info", text: t(K("mFreq"), { before: freq.before, after: freq.after }) })
    if (ctr) todo.push({ kind: "info", text: t(K("mCtr"), { before: ctr.before, after: ctr.after }) })
    if (land) todo.push({ kind: "info", text: t(K("mLand"), { before: land.before, after: land.after }) })
    if (cpm) todo.push({ kind: "info", text: t(K("mCpm"), { before: cpm.before, after: cpm.after }) })
  }
  for (const x of view.newCauses.slice(0, 4)) todo.push({ kind: "info", text: t(K("newCause"), { title: x.title, money: x.money ? ` (~${vnd(x.money)})` : "" }) })
  if (!why.some((w) => w.tone === "bad") && !view.newCauses.length && m.diag) {
    todo.push({ kind: "info", text: t(K("flat")) })
  }
  todo.push({ kind: "reopen", text: t(K("reopen")) })
  view.canReopen = !!c.goal && c.status !== "reopened"
  if (verdict === "worse") {
    view.undoable = liveExec.map((e) => ({ executionId: e.id, at: e.at.slice(0, 10), summary: executionSummary(e, t) }))
    if (view.undoable.length) todo.push({ kind: "undo", text: t(K("undo")) })
  }
  if (c.goal && verdict === "same") todo.push({ kind: "settings", text: t(K("settings")), href: "/xu-ly/muc-tieu" })
  view.todo = todo
  return view
}
