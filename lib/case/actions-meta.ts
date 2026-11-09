// ============================================================
// Bước 5 (Facebook) — từ nguyên nhân ra việc cụ thể
// ============================================================
// Việc tool ghi được (user chốt 27/09): dừng chiến dịch, đổi ngân sách chiến
// dịch, dừng nhóm quảng cáo, loại vị trí hiển thị. KHÔNG việc nào chọn sẵn:
// dừng là cắt phân phối, còn đổi vị trí/đổi ngân sách lớn làm Meta RESET giai
// đoạn học — người duyệt phải tự tick khi đã đọc cảnh báo.
// Đổi sự kiện tối ưu KHÔNG có nút: Meta không cho sửa sự kiện của nhóm đã chạy,
// phải tạo nhóm mới → việc giao người.

import { bestLearnableEvent, EVENTS_PER_WEEK_TO_LEARN, judgePlacements } from "./causes-meta"
import { UNWRITABLE_TARGETING_KEYS } from "./meta-placements"
import { proposeCreateAdset } from "./meta-new-adset"
import { metaGoalKind, metaResults } from "./goal-kind"
import type { CaseAction, ManualTask } from "./store"
import type { Diagnosis, MetaEvidence } from "./types"
import { ROAS_MIN_SPEND_TO_JUDGE, ZERO_RESULT_SPEND_MULT, type CaseTarget, type Verdict } from "./verdict"
import { makeT, type TFunction } from "@/lib/i18n/translate"

let seq = 0
const aid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`
/** Một lần loại vị trí dời tối đa ngần này chi phí của nhóm (quy ước của tool). */
export const MAX_EXCLUDED_SHARE = 0.5


/** Ngân sách mới giữ chi tiêu ở mức trần: hệ số kẹp 50%–90% (không cắt quá nửa một lần), làm tròn nghìn. */
export function budgetToCeiling(ev: MetaEvidence, goal: CaseTarget): { after: number; ratio: number } | null {
  const c = ev.campaign
  if (!c.dailyBudget || c.cost <= 0) return null
  // cpl (Đợt 23 · 3d): như cpa nhưng nhân với số lead.
  const allowed = goal.basis === "roas" ? c.purchaseValue / goal.ceiling : goal.ceiling * metaResults(c, goal.basis === "cpl" ? "leads" : "sales")
  if (allowed <= 0) return null
  const ratio = Math.min(0.9, Math.max(0.5, allowed / c.cost))
  return { after: Math.round((c.dailyBudget * ratio) / 1000) * 1000, ratio }
}

export function proposeMetaActions(input: {
  evidence: MetaEvidence
  diagnosis: Diagnosis
  verdict: Verdict
  goal: CaseTarget
}, t: TFunction = makeT("vi")): { actions: CaseAction[]; manualTasks: Omit<ManualTask, "id" | "createdAt">[] } {
  const NL = t("libcase.c.numLocale")
  const dec = (x: number) => x.toLocaleString(NL, { maximumFractionDigits: 1 })
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(NL)}`
  const { evidence: ev, diagnosis: dx, verdict, goal } = input
  const c = ev.campaign
  const has = (id: string) => dx.causes.some((x) => x.id === id)
  const actions: CaseAction[] = []
  const manualTasks: Omit<ManualTask, "id" | "createdAt">[] = []
  const campaignActive = c.status === "ACTIVE"
  // Đợt 23 (3d): chiến dịch thu lead — "kết quả" là lead; không tự dựng nhóm sự kiện mua hàng, không việc Odoo.
  const kind = metaGoalKind(c.objective)
  const leads = kind === "leads"
  const results = metaResults(c, kind)
  const resultWord = leads ? t("libcase.c.am.rwLead") : t("libcase.c.am.rwBuy")

  // Dừng nhóm quảng cáo: đã chi đủ để kết luận mà 0 đơn, và còn nhóm khác chạy tiếp.
  const judgeSpend = goal.basis === "roas" ? ROAS_MIN_SPEND_TO_JUDGE : goal.ceiling * ZERO_RESULT_SPEND_MULT
  const active = ev.adsets.filter((a) => a.status === "ACTIVE" && a.cost > 0)
  const pausedAdsets = new Set<string>()
  const dead = active.filter((a) => metaResults(a, kind) === 0 && a.cost >= judgeSpend)
  if (dead.length && dead.length < active.length) {
    for (const a of dead) {
      pausedAdsets.add(a.id)
      actions.push({
        id: aid("pauseadset"), type: "PAUSE_ADSET", selected: false, adsetId: a.id, adsetName: a.name,
        reason: t("libcase.c.am.pauseReason", { cost: vnd(a.cost), judge: vnd(judgeSpend), word: resultWord, n: active.length - dead.length }),
        label: t("libcase.c.am.pauseAdset", { name: a.name }),
      })
    }
  }

  // Loại vị trí đắt khỏi từng nhóm đang chạy nó (bỏ qua nhóm đã đề xuất dừng).
  if (has("placement-waste")) {
    const pl = judgePlacements(ev, t)
    const bad = pl.rows.filter((r) => r.flagged)
    const oversized: string[] = []
    for (const a of active) {
      if (pausedAdsets.has(a.id)) continue
      // Tệ nhất trước; dừng khi phần chi bị dời đi vượt trần — loại quá nhiều
      // thì thực chất là đổi cả nhóm, nên chọn "dừng nhóm" hoặc dựng nhóm mới.
      const costHere = (key: string) => ev.placements.filter((p) => p.adsetId === a.id && p.key === key).reduce((s, p) => s + p.cost, 0)
      const ranked = bad.filter((r) => r.adsetIds.includes(a.id))
        .sort((x, y) => (y.costPerResult ?? Infinity) - (x.costPerResult ?? Infinity) || y.cost - x.cost)
      if (!ranked.length) continue
      const mine: typeof ranked = []
      let moved = 0
      for (const r of ranked) {
        if (a.cost > 0 && (moved + costHere(r.key)) / a.cost > MAX_EXCLUDED_SHARE) break
        mine.push(r)
        moved += costHere(r.key)
      }
      const left = ranked.filter((r) => !mine.includes(r))
      if (!mine.length) {
        oversized.push(t("libcase.c.am.oversized", { name: a.name, pl: ranked[0].label, p: Math.round((costHere(ranked[0].key) / Math.max(1, a.cost)) * 100) }))
        continue
      }
      const slices = ev.placements.filter((p) => p.adsetId === a.id && mine.some((r) => r.key === p.key))
      const warnings = [t("libcase.c.am.w.reset")]
      if (UNWRITABLE_TARGETING_KEYS.some((k) => k in a.targeting)) warnings.push(t("libcase.c.am.w.wa"))
      if (a.automaticPlacement) warnings.push(t("libcase.c.am.w.auto"))
      if (left.length) warnings.push(t("libcase.c.am.w.left", { list: left.map((r) => r.label).join(", "), p: Math.round(MAX_EXCLUDED_SHARE * 100) }))
      if (a.optResultsApprox && pl.metric?.key === "optResults") warnings.push(t("libcase.c.am.w.approx"))
      actions.push({
        id: aid("placement"), type: "EXCLUDE_PLACEMENT", selected: false, adsetId: a.id, adsetName: a.name,
        placements: mine.map((r) => r.key), placementLabels: mine.map((r) => r.label), automatic: a.automaticPlacement,
        cost: slices.reduce((s, p) => s + p.cost, 0), results: slices.reduce((s, p) => s + (pl.metric ? p[pl.metric.key] ?? 0 : 0), 0),
        resultLabel: pl.metric?.label ?? t("libcase.c.am.resultLabel"), warnings,
        label: t("libcase.c.am.exclude", { list: mine.map((r) => r.label).join(", "), name: a.name }),
      })
    }
    if (oversized.length) {
      manualTasks.push({
        title: t("libcase.c.am.over.title"),
        detail: t("libcase.c.am.over.detail", { list: oversized.join("; ") }),
        assignee: null, status: "open",
      })
    }
  }

  // Dừng chiến dịch: đỏ vì 0 đơn.
  if (verdict.status === "red" && results === 0 && campaignActive) {
    actions.push({ id: aid("pause"), type: "PAUSE_CAMPAIGN", selected: false, campaignId: c.id, label: t("libcase.c.am.pause", { name: c.name }) })
  }

  // Giảm ngân sách về mức trần: đỏ nhưng có đơn (còn đáng chạy, chỉ đang chi quá).
  if (verdict.status === "red" && results > 0 && campaignActive) {
    const b = budgetToCeiling(ev, goal)
    if (b && b.after < (c.dailyBudget ?? 0)) {
      actions.push({
        id: aid("budget"), type: "SET_CAMPAIGN_BUDGET", selected: false, campaignId: c.id, before: c.dailyBudget!, after: b.after,
        reason: t("libcase.c.am.budget.reason", { p: Math.round(b.ratio * 100) }),
        label: t("libcase.c.am.budget.label", { a: vnd(c.dailyBudget!), b: vnd(b.after) }),
      })
    }
  }

  // Đợt 5: tool tự tạo nhóm mới với sự kiện chuẩn (không chọn sẵn). Có việc này thì không giao người việc trùng nghĩa.
  // Đợt 23 (3d): chiến dịch thu lead cũng được tự dựng nhóm mới (sự kiện Lead của pixel); nhóm form trên Meta thì vẫn giao người.
  const newAdset = leads
    ? (has("opt-event-not-lead") || has("learning-fail") ? proposeCreateAdset(ev, { leads: true }, t) : null)
    : has("opt-event-not-purchase") || has("learning-fail") || has("view-through-heavy") ? proposeCreateAdset(ev, { viewHeavy: has("view-through-heavy") }, t) : null
  if (newAdset) actions.push(newAdset)

  // ── Việc giao người ──
  if (!leads && (has("opt-event-not-purchase") || has("learning-fail")) && (!newAdset || (newAdset.type === "CREATE_ADSET_WITH_EVENT" && newAdset.lowSignal))) {
    const best = bestLearnableEvent(ev, t)
    const purchasePerWeek = ev.peers.eventsPerWeek.purchase ?? 0
    const detail = !best
      ? t("libcase.c.am.ev.d1", { need: EVENTS_PER_WEEK_TO_LEARN, n: dec(purchasePerWeek) })
      : best.key === "purchase"
        ? t("libcase.c.am.ev.d2", { n: dec(best.perWeek) })
        : t("libcase.c.am.ev.d3", { n: dec(purchasePerWeek), need: EVENTS_PER_WEEK_TO_LEARN, event: best.label, m: dec(best.perWeek) })
    manualTasks.push({ title: best ? t("libcase.c.am.ev.t1", { event: best.label }) : t("libcase.c.am.ev.t2"), detail, assignee: null, status: "open" })
  }
  if (leads && (has("opt-event-not-lead") || has("learning-fail")) && (!newAdset || (newAdset.type === "CREATE_ADSET_WITH_EVENT" && newAdset.lowSignal))) {
    manualTasks.push({ title: t("libcase.c.am.lead.title"), detail: t("libcase.c.am.lead.detail"), assignee: null, status: "open" })
  }
  if (has("purchase-value-missing")) {
    manualTasks.push({ title: t("libcase.c.am.pv.title"), detail: t("libcase.c.am.pv.detail"), assignee: null, status: "open" })
  }
  if (has("budget-thin")) {
    manualTasks.push({ title: t("libcase.c.am.thin.title", { n: ev.peers.activeCampaigns }), detail: t("libcase.c.am.thin.detail", { need: EVENTS_PER_WEEK_TO_LEARN }), assignee: null, status: "open" })
  }
  if (!leads && (has("meta-vs-odoo") || !ev.odoo.checked)) {
    manualTasks.push({
      title: ev.odoo.tags.length ? t("libcase.c.am.odoo.t1")
        : !ev.odoo.readableAds && ev.odoo.unreadableAds ? t("libcase.c.am.odoo.t2")
        : t("libcase.c.am.odoo.t3"),
      detail: ev.odoo.tags.length || (!ev.odoo.readableAds && ev.odoo.unreadableAds) ? ev.odoo.note
        : t("libcase.c.am.odoo.d"),
      assignee: null, status: "open",
    })
  }
  if (has("click-no-landing")) {
    manualTasks.push({ title: t("libcase.c.am.land.title"), detail: t("libcase.c.am.land.detail"), assignee: null, status: "open" })
  }
  if (has("high-frequency")) {
    manualTasks.push({ title: t("libcase.c.am.freq.title"), detail: t("libcase.c.am.freq.detail"), assignee: null, status: "open" })
  }
  return { actions, manualTasks }
}
