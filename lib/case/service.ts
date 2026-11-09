// ============================================================
// Điều phối phiên "Xử lý chiến dịch" — route API chỉ gọi vào đây
// ============================================================
// Route lo xác thực + phân quyền; file này lo nghiệp vụ. Đợt 1: Google, mở
// phiên cho chiến dịch Search (Pmax hiện ở tổng quan nhưng chưa mở phiên).

import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { proposeSearchActions } from "./actions-search"
import { proposePmaxActions } from "./actions-pmax"
import { diagnoseSearch } from "./causes-search"
import { addDays, vnDate } from "./dates"
import { executeGoogleActions, undoGoogleExecution } from "./execute-google"
import { collectSearchEvidence } from "./google-evidence"
import { productGroupOf, PRODUCT_LABEL } from "./product"
import { detectCompany } from "@/lib/company-detect"
import { metaClient } from "@/lib/meta-client"
import { proposeMetaActions } from "./actions-meta"
import { diagnoseMeta, ODOO_GAP_RATIO, ODOO_MIN_META_PURCHASES } from "./causes-meta"
import { executeMetaActions, undoMetaExecution } from "./execute-meta"
import { accountCampaignInsights, collectMetaEvidence, pickAction, PURCHASE_TYPES } from "./meta-evidence"
import { createCase, listCases, readCase, updateCase, type CampaignCase, type Execution, type RemeasureDiag, type RemeasureEntry } from "./store"
import { judgeRemeasure, VERDICT_CODE, type PerfSnap, type RemeasureVerdict } from "./judge"
import { lexiconFor, targetFor } from "./targets"
import { allSplits } from "@/lib/search/split"
import type { SplitRoute } from "./simulate-negatives"
import type { CaseEvidence, Company, MetaEvidence, SearchEvidence } from "./types"
import { compareVerdicts, verdictOf, type CampaignPerf, type CaseBasis, type CaseTarget, type Verdict } from "./verdict"
import { evidenceGoalKind, googleGoalKind, META_LEAD_OBJECTIVES, META_LEAD_TYPES, META_SALES_OBJECTIVES, metaGoalKind, metaResults, type GoalKind } from "./goal-kind"
import { leadCaseTarget } from "@/lib/targets/resolve"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { CaseError } from "./errors"
import type { MessageKey } from "@/lib/i18n/messages"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const micros = (v: unknown) => (Number(v) || 0) / 1_000_000
const en = (e: Record<string | number, string | number>, v: unknown) => (typeof v === "number" ? String(e[v] ?? v) : String(v ?? ""))

export { CaseError }
const svc = (k: string): MessageKey => `libcase.s.svc.${k}` as MessageKey
/** Tên nhóm sản phẩm theo ngôn ngữ (bản tiếng Việt = PRODUCT_LABEL). */
const groupLabelT = (g: keyof typeof PRODUCT_LABEL, t: TFunction): string => t(svc(`group.${g}`))

export interface OverviewRow {
  campaignId: string
  name: string
  status: string
  channel: string
  group: string
  groupLabel: string
  perf: CampaignPerf
  target: CaseTarget | null
  verdict: Verdict
  /** Mở phiên được cho Search (Đợt 1) và Pmax (Đợt 2). */
  canOpenCase: boolean
  latestCase: { id: string; step: number; status: string } | null
  /** Đợt 23 (3d): chiến dịch thu lead → perf.orders là số LEAD, target là CPL. */
  goalKind?: GoalKind
}

export type Platform = "google" | "facebook"

/** Chiến dịch Facebook mở phiên được: bán hàng (chấm theo lượt mua) + Đợt 23 (3d) thu lead (chấm theo chi phí mỗi lead). */
const metaCanOpen = (objective: string) => META_SALES_OBJECTIVES.has(objective) || META_LEAD_OBJECTIVES.has(objective)

/**
 * Tổng quan Facebook. Chấm theo số Meta (user chốt 27/09, phương án c) — số
 * Odoo đối chiếu ở từng phiên vì cần liên kết quảng cáo của từng chiến dịch.
 * 2 lượt gọi Meta, cả hai có đệm (10–15 phút).
 */
export async function metaOverview(company: Company, range: { from: string; to: string }, t: TFunction = makeT("vi")) {
  const [ins, camps] = await Promise.all([accountCampaignInsights(range), metaClient.getCampaigns()])
  const meta = new Map(camps.map((c) => [String(c.id), c]))
  const cases = listCases({ company })
  const out: OverviewRow[] = ins
    .filter((r) => detectCompany(String(r.campaign_name ?? "")) === company && Number(r.spend) > 0)
    .map((r) => {
      const id = String(r.campaign_id), name = String(r.campaign_name)
      const c = meta.get(id)
      const group = productGroupOf(name)
      const objective = String(c?.objective ?? "")
      // Đợt 23 (3d): chiến dịch thu lead chấm theo SỐ LEAD + mục tiêu CPL — trước đây bị chấm bằng lượt mua (luôn 0) với
      // mục tiêu bán hàng nên đỏ/xám oan.
      const leads = metaGoalKind(objective) === "leads"
      const perf: CampaignPerf = leads
        ? { cost: Number(r.spend) || 0, clicks: Number(r.clicks) || 0, orders: pickAction(r.actions, META_LEAD_TYPES), orderValue: 0 }
        : { cost: Number(r.spend) || 0, clicks: Number(r.clicks) || 0, orders: pickAction(r.actions, PURCHASE_TYPES), orderValue: pickAction(r.action_values, PURCHASE_TYPES) }
      const target: CaseTarget | null = leads ? leadCaseTarget(company, name) : targetFor(company, group)
      const latest = cases.find((x) => x.campaignId === id)
      return {
        campaignId: id, name, status: String(c?.status ?? "—"), channel: objective || "—", group, groupLabel: groupLabelT(group, t),
        perf, target, verdict: verdictOf(perf, target, t), canOpenCase: metaCanOpen(objective), goalKind: leads ? "leads" : "sales",
        latestCase: latest ? { id: latest.id, step: latest.step, status: latest.status } : null,
      }
    })
  out.sort(compareVerdicts)
  // Tổng "đơn" chỉ cộng chiến dịch bán hàng — lead KHÔNG phải đơn (tổng lead đứng riêng).
  const totals = out.reduce((t, r) => ({
    cost: t.cost + r.perf.cost, orders: t.orders + (r.goalKind === "leads" ? 0 : r.perf.orders),
    leads: t.leads + (r.goalKind === "leads" ? r.perf.orders : 0), orderValue: t.orderValue + r.perf.orderValue,
    overCeiling: t.overCeiling + (r.verdict.status === "red" ? r.verdict.overCeiling ?? 0 : 0),
    redCount: t.redCount + (r.verdict.status === "red" ? 1 : 0),
  }), { cost: 0, orders: 0, leads: 0, orderValue: 0, overCeiling: 0, redCount: 0 })
  return { company, range, rows: out, totals, scoredBy: "meta" as const }
}

/** Đợt 23 (3d): hạng mục chuyển đổi đang đặt giá của MỌI chiến dịch trong tài khoản (1 lượt gọi). Ném lỗi — job tự kiểm sáng
 *  (lib/smoke/run.ts) dùng để bắt truy vấn hỏng; tổng quan thì bắt lỗi và chấm như bán hàng. */
export async function googleBiddableCategories(customer: { query: (q: string) => Promise<unknown> }): Promise<Map<string, string[]>> {
  const goals = (await customer.query(`SELECT campaign.id, campaign_conversion_goal.category FROM campaign_conversion_goal
      WHERE campaign_conversion_goal.biddable = TRUE`)) as Row[]
  const cats = new Map<string, string[]>()
  for (const g of goals) {
    const id = String(g.campaign?.id ?? ""), cat = en(enums.ConversionActionCategory, g.campaign_conversion_goal?.category)
    cats.set(id, [...(cats.get(id) ?? []), cat])
  }
  return cats
}

export async function googleOverview(company: Company, range: { from: string; to: string }, t: TFunction = makeT("vi")) {
  const customer = getGoogleAdsCustomer(company)
  const rows = (await customer.query(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
      metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
      AND campaign.status != 'REMOVED' AND metrics.cost_micros > 0`)) as Row[]
  const cases = listCases({ company })
  // Đợt 23 (3d): hạng mục chuyển đổi chiến dịch ĐANG ĐẶT GIÁ — có lead, không có Mua hàng → thu lead (metrics.conversions
  // của chiến dịch đó là lead). Đọc lỗi → coi như bán hàng (y như trước).
  let cats = new Map<string, string[]>()
  try {
    cats = await googleBiddableCategories(customer)
  } catch (e) {
    console.warn("[case] googleOverview: không đọc được hạng mục đặt giá — chấm như bán hàng:", e instanceof Error ? e.message : String(e))
  }
  const out: OverviewRow[] = rows.map((r) => {
    const name = String(r.campaign.name)
    const group = productGroupOf(name)
    const leads = googleGoalKind(cats.get(String(r.campaign.id))) === "leads"
    const perf: CampaignPerf = {
      cost: micros(r.metrics.cost_micros), clicks: Number(r.metrics.clicks) || 0,
      orders: Number(r.metrics.conversions) || 0, orderValue: leads ? 0 : Number(r.metrics.conversions_value) || 0,
    }
    const target: CaseTarget | null = leads ? leadCaseTarget(company, name) : targetFor(company, group)
    const channel = en(enums.AdvertisingChannelType, r.campaign.advertising_channel_type)
    const latest = cases.find((c) => c.campaignId === String(r.campaign.id))
    return {
      campaignId: String(r.campaign.id), name, status: en(enums.CampaignStatus, r.campaign.status),
      channel, group, groupLabel: groupLabelT(group, t), perf, target, verdict: verdictOf(perf, target, t),
      canOpenCase: channel === "SEARCH" || channel === "PERFORMANCE_MAX",
      latestCase: latest ? { id: latest.id, step: latest.step, status: latest.status } : null,
      goalKind: leads ? "leads" : "sales",
    }
  })
  out.sort(compareVerdicts)
  const totals = out.reduce((t, r) => ({
    cost: t.cost + r.perf.cost, orders: t.orders + (r.goalKind === "leads" ? 0 : r.perf.orders),
    leads: t.leads + (r.goalKind === "leads" ? r.perf.orders : 0), orderValue: t.orderValue + r.perf.orderValue,
    overCeiling: t.overCeiling + (r.verdict.status === "red" ? r.verdict.overCeiling ?? 0 : 0),
    redCount: t.redCount + (r.verdict.status === "red" ? 1 : 0),
  }), { cost: 0, orders: 0, leads: 0, orderValue: 0, overCeiling: 0, redCount: 0 })
  return { company, range, rows: out, totals }
}

/** Mở phiên (hoặc trả phiên đang mở của chiến dịch này) và kéo bằng chứng ngay. */
export async function openCase(input: { company: Company; campaignId: string; range: { from: string; to: string }; actor: string; platform?: Platform }): Promise<CampaignCase> {
  const open = listCases({ company: input.company, campaignId: input.campaignId }).find((c) => c.status !== "done")
  if (open) return open
  if (input.platform === "facebook") {
    const evidence = await collectMetaEvidence(input.company, input.campaignId, input.range)
    if (!metaCanOpen(evidence.campaign.objective)) throw new CaseError(`Chưa hỗ trợ chiến dịch Facebook mục tiêu ${evidence.campaign.objective} — phiên chấm theo lượt mua (bán hàng) hoặc lead (thu khách tiềm năng)`, 400, { key: svc("err.fbObjective"), vars: { objective: evidence.campaign.objective } })
    return createCase({
      platform: "facebook", company: input.company, campaignId: input.campaignId, campaignName: evidence.campaign.name,
      range: input.range, step: 1, status: "open", goal: null, evidence, diagnosis: null, actions: [], manualTasks: [],
      executions: [], remeasure: [], createdBy: input.actor,
    })
  }
  const customer = getGoogleAdsCustomer(input.company)
  if (!/^\d+$/.test(input.campaignId)) throw new CaseError("campaignId không hợp lệ", 400, { key: svc("err.campaignId") })
  const ch = (await customer.query(`SELECT campaign.advertising_channel_type FROM campaign
    WHERE campaign.id = ${input.campaignId} AND campaign.status != 'REMOVED'`)) as Row[]
  if (!ch.length) throw new CaseError("Không tìm thấy chiến dịch trong tài khoản này", 404, { key: svc("err.campaignNotFound") })
  const channel = en(enums.AdvertisingChannelType, ch[0].campaign.advertising_channel_type)
  if (channel !== "SEARCH" && channel !== "PERFORMANCE_MAX") throw new CaseError(`Chưa hỗ trợ loại chiến dịch ${channel}`, 400, { key: svc("err.channel"), vars: { channel } })
  const evidence = await collectSearchEvidence(customer, input.company, input.campaignId, input.range, channel === "PERFORMANCE_MAX" ? "google_pmax" : "google_search")
  return createCase({
    platform: "google", company: input.company, campaignId: input.campaignId, campaignName: evidence.campaign.name,
    range: input.range, step: 1, status: "open", goal: null, evidence, diagnosis: null, actions: [], manualTasks: [],
    executions: [], remeasure: [], createdBy: input.actor,
  })
}

/** Thu thập lại bằng chứng theo nền tảng của phiên. */
async function collectFor(c: CampaignCase, range: { from: string; to: string }): Promise<CaseEvidence> {
  if (c.platform === "facebook") return collectMetaEvidence(c.company, c.campaignId, range)
  const kind = c.evidence && c.evidence.kind !== "meta" ? c.evidence.kind : "google_search"
  return collectSearchEvidence(getGoogleAdsCustomer(c.company), c.company, c.campaignId, range, kind)
}

export async function recollect(id: string): Promise<CampaignCase> {
  return updateCase(id, async (c) => {
    const evidence = await collectFor(c, c.range)
    const next = { ...c, evidence, step: Math.max(c.step, 2) as CampaignCase["step"] }
    return { next, result: next }
  })
}

export function setStep(id: string, step: CampaignCase["step"]) {
  return updateCase(id, async (c) => {
    const next = { ...c, step }
    return { next, result: next }
  })
}

/** Bước 3 → 4 → 5: chốt mục tiêu, tính nguyên nhân, dựng hướng xử lý (kèm mô phỏng). */
export async function confirmGoal(id: string, goal: { basis: CaseBasis; target: number; ceiling: number; where: string }, actor: string, t: TFunction = makeT("vi")) {
  return updateCase(id, async (c) => {
    const next = planCase(c, goal, actor, t)
    return { next, result: next }
  })
}

/** Chiến dịch là gốc của bản tách "· Chung" còn dùng → nơi nhận lượt tìm chung. live = đã chuyển từ khoá (bản Chung phải BẬT mới chuyển được). */
export function splitRouteFor(company: Company, campaignId: string): SplitRoute | undefined {
  const r = allSplits().filter((x) => x.company === company && x.sourceId === campaignId && x.newCampaign && (x.step === "created" || x.step === "moved")).pop()
  return r ? { to: r.name, live: r.step === "moved" } : undefined
}

/** Tính nguyên nhân + hướng xử lý từ bằng chứng hiện có của phiên (dùng chung cho bước 3 và "Mở lại ở bước 4"). */
function planCase(c: CampaignCase, goal: { basis: CaseBasis; target: number; ceiling: number; where: string }, actor: string, t: TFunction = makeT("vi")): CampaignCase {
  if (!c.evidence) throw new CaseError("Phiên chưa có bằng chứng — thu thập lại trước", 400, { key: svc("err.noEvidence") })
  // Đợt 23 (3d): phiên thu lead chỉ chấm theo CPL; phiên bán hàng chỉ CPA / ROAS.
  const kind = evidenceGoalKind(c.evidence)
  if ((kind === "leads") !== (goal.basis === "cpl")) throw new CaseError(kind === "leads" ? "Chiến dịch thu lead chấm theo chi phí mỗi lead (CPL)" : "Chiến dịch bán hàng chấm theo CPA hoặc ROAS", 400, { key: svc(kind === "leads" ? "err.leadBasis" : "err.salesBasis") })
  const now = new Date().toISOString()
  const tasks = (list: Omit<CampaignCase["manualTasks"][number], "id" | "createdAt">[]) =>
    list.map((t, i) => ({ ...t, id: `task_${Date.now().toString(36)}_${i}`, createdAt: now })) as CampaignCase["manualTasks"]
  if (c.evidence.kind === "meta") {
    const ev = c.evidence
    const diagnosis = diagnoseMeta(ev, t)
    const verdict = metaVerdict(ev, goal, t)
    const { actions, manualTasks } = proposeMetaActions({ evidence: ev, diagnosis, verdict, goal }, t)
    return { ...c, step: 4, diagnosis, actions, goal: { ...goal, confirmedBy: actor, confirmedAt: now }, manualTasks: tasks(manualTasks) }
  }
  const lexicon = lexiconFor(c.company)
  const diagnosis = diagnoseSearch(c.evidence, { lexicon, ceilingCpa: goal.basis === "roas" ? null : goal.ceiling, goalKind: kind }, t)
  const ev = c.evidence.campaign
  const verdict = verdictOf({ cost: ev.cost, clicks: ev.clicks, orders: ev.orders, orderValue: ev.orderValue }, goal, t)
  const { actions, manualTasks } = c.evidence.kind === "google_pmax"
    ? proposePmaxActions({ evidence: c.evidence, diagnosis, lexicon }, t)
    : proposeSearchActions({ evidence: c.evidence, diagnosis, verdict, lexicon, split: splitRouteFor(c.company, c.evidence.campaign.id) }, t)
  return { ...c, step: 4, diagnosis, actions, goal: { ...goal, confirmedBy: actor, confirmedAt: now }, manualTasks: tasks(manualTasks) }
}

/** Tuỳ chọn của việc Đợt 5: đổi sự kiện (chỉ trong danh sách đề xuất) / tạm dừng nhóm cũ khi bật nhóm mới. */
export type ActionOptions = Record<string, { event?: string; pauseSource?: boolean; lowSignalAck?: boolean }>

export function applyActionOptions(a: CampaignCase["actions"][number], o: ActionOptions[string] | undefined, t: TFunction = makeT("vi")): CampaignCase["actions"][number] {
  if (!o) return a
  if (a.type === "CREATE_ADSET_WITH_EVENT" && o.event && o.event !== a.event) {
    const alt = a.alternatives.find((x) => x.event === o.event)
    if (!alt) throw new CaseError("Sự kiện không có trong danh sách đề xuất", 400, { key: svc("err.eventNotListed") })
    return { ...a, event: alt.event, eventLabel: alt.label, perWeek: alt.perWeek, lowSignalAck: false,
      lowSignal: alt.perWeek < 50, label: t(svc("act.newAdset"), { event: alt.label, source: a.sourceAdsetName }) }
  }
  if (a.type === "CREATE_ADSET_WITH_EVENT" && typeof o.lowSignalAck === "boolean") return { ...a, lowSignalAck: o.lowSignalAck }
  if (a.type === "ACTIVATE_NEW_ADSET" && typeof o.pauseSource === "boolean") return { ...a, pauseSource: o.pauseSource }
  return a
}

export async function selectActions(id: string, selected: Record<string, boolean>, options: ActionOptions = {}, t: TFunction = makeT("vi")) {
  return updateCase(id, async (c) => {
    const next = { ...c, step: Math.max(c.step, 5) as CampaignCase["step"], actions: c.actions.map((a) => applyActionOptions(a.id in selected ? { ...a, selected: !!selected[a.id] } : a, options[a.id], t)) }
    return { next, result: next }
  })
}

/** Bước 6. Cùng idempotencyKey gửi 2 lần → trả lần đầu, không ghi 2 lần. */
export async function executeCase(id: string, input: { actor: string; idempotencyKey: string; validateOnly: boolean }, t: TFunction = makeT("vi")): Promise<{ case: CampaignCase; execution: Execution }> {
  return updateCase(id, async (c) => {
    const dup = c.executions.find((e) => e.idempotencyKey === input.idempotencyKey)
    if (dup) return { next: null, result: { case: c, execution: dup } }
    if (!c.actions.some((a) => a.selected)) throw new CaseError("Chưa chọn việc nào để thực hiện", 400, { key: svc("err.noneSelected") })
    const execution = c.evidence?.kind === "meta"
      ? await executeMetaActions({
        company: c.company, evidence: c.evidence, actions: c.actions,
        actor: input.actor, idempotencyKey: input.idempotencyKey, validateOnly: input.validateOnly, t,
      })
      : await executeGoogleActions({
        customer: getGoogleAdsCustomer(c.company), company: c.company, actions: c.actions,
        actor: input.actor, idempotencyKey: input.idempotencyKey, validateOnly: input.validateOnly, t,
      })
    if (input.validateOnly) return { next: null, result: { case: c, execution } }
    const today = vnDate()
    const wrote = execution.created.length + execution.removed.length + execution.paused.length
      + (execution.sharedCreated?.length ?? 0) + (execution.attached?.length ?? 0) + (execution.metaChanges?.length ?? 0) > 0
    // Đợt 5: vừa tạo nhóm mới → thêm việc "Bật nhóm mới" (không chọn sẵn) để người duyệt quyết thời điểm.
    const created = (execution.metaChanges ?? []).filter((m): m is Extract<typeof m, { kind: "adset_created" }> => m.kind === "adset_created")
    const activations: CampaignCase["actions"] = created.map((m, i) => ({
      id: `activate_${Date.now().toString(36)}_${i}`, type: "ACTIVATE_NEW_ADSET", selected: false,
      newAdsetId: m.id, newAdIds: m.adIds, sourceAdsetId: m.sourceAdsetId, pauseSource: false,
      label: t(svc("act.activate"), { name: m.name, n: m.adIds.length }),
    }))
    const next: CampaignCase = {
      ...c, step: 6, executions: [...c.executions, execution],
      actions: [...c.actions.map((a) => (a.type === "CREATE_ADSET_WITH_EVENT" && created.some((m) => m.sourceAdsetId === a.sourceAdsetId) ? { ...a, selected: false } : a)), ...activations],
      // 14/10: trước đây chỉ đặt lịch khi CHƯA TỪNG có lịch → phiên mở lại rồi làm tiếp không bao giờ được đo lại.
      // Nay: không còn mốc nào đang chờ thì mở VÒNG ĐO MỚI, kỳ đo tính từ hôm nay (start).
      remeasure: wrote && !c.remeasure.some((r) => r.status === "pending")
        ? [...c.remeasure, { due: addDays(today, 7), status: "pending", start: today }, { due: addDays(today, 14), status: "pending", start: today }]
        : c.remeasure,
    }
    return { next, result: { case: next, execution } }
  })
}

export async function undoExecution(id: string, execId: string, actor: string, t: TFunction = makeT("vi")) {
  return updateCase(id, async (c) => {
    const ex = c.executions.find((e) => e.id === execId)
    if (!ex) throw new CaseError("Không tìm thấy lần thực hiện", 404, { key: svc("err.execNotFound") })
    if (ex.undoneAt) throw new CaseError("Lần thực hiện này đã được hoàn tác", 409, { key: svc("err.alreadyUndone") })
    const report = c.evidence?.kind === "meta"
      ? await undoMetaExecution({ company: c.company, evidence: c.evidence, exec: ex, actor, t })
      : await undoGoogleExecution({ customer: getGoogleAdsCustomer(c.company), company: c.company, exec: ex, actor, t })
    const next: CampaignCase = {
      ...c, executions: c.executions.map((e) => (e.id === execId ? { ...e, undoneAt: new Date().toISOString(), undoReport: report } : e)),
    }
    return { next, result: { case: next, report } }
  })
}

export async function closeCase(id: string) {
  return updateCase(id, async (c) => {
    const next: CampaignCase = { ...c, step: 7, status: "done" }
    return { next, result: next }
  })
}

export async function updateManualTask(id: string, taskId: string, patch: { status?: "open" | "done"; assignee?: string | null }) {
  return updateCase(id, async (c) => {
    if (!c.manualTasks.some((t) => t.id === taskId)) throw new CaseError("Không tìm thấy việc", 404, { key: svc("err.taskNotFound") })
    const next: CampaignCase = {
      ...c, manualTasks: c.manualTasks.map((t) => (t.id === taskId ? {
        ...t, ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
        ...(patch.status ? { status: patch.status, doneAt: patch.status === "done" ? new Date().toISOString() : undefined } : {}),
      } : t)),
    }
    return { next, result: next }
  })
}

/**
 * Đo lại các phiên tới hạn (job case-remeasure). So kỳ [ngày thực hiện, ngày
 * đo] với bằng chứng lúc mở phiên. Mốc 14 ngày mà chi phí/đơn không giảm →
 * phiên mở lại ở bước 4.
 */
export async function runDueRemeasures(now: Date = new Date()): Promise<{ checked: number; reopened: number; errors: string[] }> {
  const today = vnDate(now)
  let checked = 0, reopened = 0
  const errors: string[] = []
  for (const c of listCases()) {
    const due = c.remeasure.filter((r) => r.status === "pending" && r.due <= today)
    if (!due.length || !c.executions.length) continue
    const start = due[0].start ?? firstExecutionDay(c)
    if (!start) continue
    try {
      await updateCase(c.id, async (cur) => {
        const range = { from: start, to: today }
        const fresh = await collectFor(cur, range)
        const { result, enabled, verdict } = remeasureResult(cur, fresh)
        const diag = diagOf(cur, fresh, range)
        let status = cur.status, step = cur.step, reopenedAt = cur.reopenedAt
        const remeasure: RemeasureEntry[] = cur.remeasure.map((r) => (r.status === "pending" && r.due <= today ? { ...r, status: "done" as const, result, diag } : r))
        const isFinal = remeasure.every((r) => r.status === "done")
        const improved = verdict === "improved" // Đợt 23: không còn "giảm 1% là đạt" — xem lib/case/judge.ts
        if (isFinal && verdict === "insufficient") {
          // 14/10: mốc cuối mà quá ít đơn → KHÔNG mở lại (mở lại vì vài đơn may rủi là làm lại phiên oan). Đo thêm 14 ngày,
          // tối đa MAX_REMEASURE_EXTENSIONS lần; hết lượt vẫn ít đơn thì để nguyên, trang phiên nói rõ "chiến dịch quá ít đơn để đo".
          if (remeasure.filter((r) => r.extended).length < MAX_REMEASURE_EXTENSIONS) {
            remeasure.push({ due: addDays(today, 14), status: "pending", extended: true, start })
          }
        } else if (isFinal && !improved && enabled) {
          status = "reopened"; step = 4; reopenedAt = new Date().toISOString(); reopened++
        }
        checked++
        return { next: { ...cur, remeasure, status, step, reopenedAt }, result: null }
      })
    } catch (e) {
      errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { checked, reopened, errors }
}

/** Số lần đo thêm tối đa khi mốc cuối "chưa đủ dữ liệu" (mỗi lần +14 ngày). */
export const MAX_REMEASURE_EXTENSIONS = 2

/** Ngày thực hiện đầu tiên (chưa hoàn tác) của vòng đo hiện tại — sau lần mở lại gần nhất nếu có. */
function firstExecutionDay(c: CampaignCase): string | null {
  const live = c.executions.filter((e) => !e.undoneAt)
  const since = c.reopenedAt ?? ""
  const pick = (list: typeof live) => list.map((e) => e.at.slice(0, 10)).sort()[0] ?? null
  return pick(live.filter((e) => e.at >= since)) ?? pick(live)
}

/** 14/10: ảnh chụp chẩn đoán của kỳ đo — tỉ lệ để so với lúc mở phiên + bộ tìm nguyên nhân bước 4 chạy trên số mới. Hàm thuần. */
export function diagOf(cur: CampaignCase, fresh: CaseEvidence, range: { from: string; to: string }): RemeasureDiag {
  const top = (causes: { id: string; title: string; money: number | null }[]) =>
    causes.slice(0, 6).map((x) => ({ id: x.id, title: x.title, money: x.money === null ? null : Math.round(x.money) }))
  if (fresh.kind === "meta") {
    const c = fresh.campaign
    return {
      ...range,
      facts: { cost: Math.round(c.cost), impressions: c.impressions, reach: c.reach, clicks: c.clicks, linkClicks: c.linkClicks, landingViews: c.landingViews, frequency: c.frequency },
      causes: top(diagnoseMeta(fresh).causes),
    }
  }
  const c = fresh.campaign
  const goal = cur.goal
  const dx = diagnoseSearch(fresh, { lexicon: lexiconFor(cur.company), ceilingCpa: goal && goal.basis !== "roas" ? goal.ceiling : null, goalKind: evidenceGoalKind(fresh) })
  return {
    ...range,
    facts: { cost: Math.round(c.cost), clicks: c.clicks, impressions: c.impressions, orders: c.orders, impressionShare: c.impressionShare, lostIsBudget: c.lostIsBudget, lostIsRank: c.lostIsRank },
    causes: top(dx.causes),
  }
}

/** 14/10: "Kiểm tra ngay" — đo kỳ [ngày thực hiện, hôm nay] ngoài lịch để xem chẩn đoán. KHÔNG đổi lịch đo, KHÔNG mở lại.
 *  Gọi Google/Meta thật → chặn bấm liên tục (CHECK_COOLDOWN_MS). */
export const CHECK_COOLDOWN_MS = 10 * 60_000
export async function checkNow(id: string, now: Date = new Date()) {
  return updateCase(id, async (c) => {
    const start = firstExecutionDay(c)
    if (!start) throw new CaseError("Phiên chưa thực hiện thay đổi nào nên chưa có gì để đo", 400, { key: svc("err.nothingToMeasure") })
    if (c.latestCheck && now.getTime() - Date.parse(c.latestCheck.at) < CHECK_COOLDOWN_MS) {
      throw new CaseError("Vừa kiểm tra xong — đợi khoảng 10 phút rồi kiểm lại (mỗi lần kiểm gọi Google/Meta thật)", 429, { key: svc("err.cooldown") })
    }
    const range = { from: start, to: vnDate(now) }
    const fresh = await collectFor(c, range)
    const { result } = remeasureResult(c, fresh)
    const next: CampaignCase = { ...c, latestCheck: { at: now.toISOString(), verdict: Number(result.verdict ?? 0), result, diag: diagOf(c, fresh, range) } }
    return { next, result: next }
  })
}

/** 14/10: "Mở lại phiên ở bước 4 ngay" — không chờ mốc đo cuối. Thu lại bằng chứng 30 ngày gần nhất, tính lại nguyên nhân +
 *  hướng xử lý theo mục tiêu đã chốt. Việc giao người cũ được giữ; lần thực hiện cũ giữ nguyên (vẫn hoàn tác được). */
export async function reopenNow(id: string, actor: string, now: Date = new Date(), t: TFunction = makeT("vi")) {
  return updateCase(id, async (c) => {
    if (!c.goal) throw new CaseError("Phiên chưa chốt mục tiêu — làm tiếp từ bước 3", 400, { key: svc("err.noGoal") })
    const today = vnDate(now)
    const range = { from: addDays(today, -29), to: today }
    const evidence = await collectFor(c, range)
    const planned = planCase({ ...c, evidence, range }, { basis: c.goal.basis, target: c.goal.target, ceiling: c.goal.ceiling, where: c.goal.where }, actor, t)
    const next: CampaignCase = {
      ...planned,
      manualTasks: [...c.manualTasks, ...planned.manualTasks],
      // Mốc đo đang chờ của vòng cũ bỏ đi (đo tiếp thứ đã quyết làm lại là vô nghĩa và có thể tự mở lại lần nữa);
      // lần thực hiện mới ở bước 6 sẽ mở vòng đo mới. Mốc đã đo giữ lại làm lịch sử.
      remeasure: c.remeasure.filter((r) => r.status === "done"),
      status: "reopened", step: 4, reopenedAt: now.toISOString(),
    }
    return { next, result: next }
  })
}

/** Chấm phiên Facebook theo số Meta; lệch Odoo lớn → thêm cờ (phương án c). */
export function metaVerdict(ev: MetaEvidence, goal: CaseTarget, t: TFunction = makeT("vi")): Verdict {
  const c = ev.campaign
  // Đợt 23 (3d): thu lead → chấm theo số lead Meta ghi; không có đơn để đối chiếu Odoo.
  if (metaGoalKind(c.objective) === "leads") return verdictOf({ cost: c.cost, clicks: c.linkClicks || c.clicks, orders: c.leads ?? 0, orderValue: 0 }, goal, t)
  const v = verdictOf({ cost: c.cost, clicks: c.linkClicks || c.clicks, orders: c.purchases, orderValue: c.purchaseValue }, goal, t)
  if (ev.odoo.checked && c.purchases >= ODOO_MIN_META_PURCHASES && ev.odoo.orders < c.purchases * ODOO_GAP_RATIO) {
    v.flags.push(t(svc("flag.odooGap"), { purchases: c.purchases, orders: ev.odoo.orders }))
  } else if (!ev.odoo.checked) {
    v.flags.push(t(svc("flag.odooNone")))
  }
  return v
}

/**
 * Đợt 6 · B2: phiên đã tạo nhóm mới (Đợt 5) → so nhóm mới với nhóm nguồn trong CÙNG kỳ đo lại,
 * đọc từ bằng chứng mới (đã có số theo nhóm). Hàm thuần. Chỉ nhóm tạo đầu tiên chưa hoàn tác.
 */
export function newAdsetComparison(cur: CampaignCase, fresh: MetaEvidence): Record<string, number | null> {
  const created = cur.executions.filter((e) => !e.undoneAt).flatMap((e) => e.metaChanges ?? [])
    .find((m): m is Extract<typeof m, { kind: "adset_created" }> => m.kind === "adset_created")
  if (!created) return {}
  const n = fresh.adsets.find((a) => a.id === created.id), o = fresh.adsets.find((a) => a.id === created.sourceAdsetId)
  const per = (cost?: number, res?: number) => (cost !== undefined && res ? Math.round(cost / res) : null)
  return {
    newCost: n ? Math.round(n.cost) : null, newResults: n ? n.optResults : null, newPurchases: n ? n.purchases : null, newCostPerResult: per(n?.cost, n?.optResults),
    oldCost: o ? Math.round(o.cost) : null, oldResults: o ? o.optResults : null, oldPurchases: o ? o.purchases : null, oldCostPerResult: per(o?.cost, o?.optResults),
  }
}

/** Số đo lại của một phiên — so với bằng chứng lúc mở phiên. */
function remeasureResult(cur: CampaignCase, fresh: CaseEvidence): { result: Record<string, number | null>; beforeCpa: number | null; enabled: boolean; verdict: RemeasureVerdict } {
  const r = remeasureRaw(cur, fresh)
  // Đợt 23: chấm theo mục tiêu của phiên (CPA / ROAS) với ngưỡng thay đổi tối thiểu — xem lib/case/judge.ts.
  const j = judgeRemeasure(cur.goal ? { basis: cur.goal.basis, target: cur.goal.target, ceiling: cur.goal.ceiling } : null, r.before, r.after)
  const roasOf = (x: PerfSnap | null) => (x && x.cost > 0 ? Math.round((x.value / x.cost) * 100) / 100 : null)
  return {
    result: { ...r.result, verdict: VERDICT_CODE[j.verdict], ...(j.basis === "roas" ? { roasBefore: roasOf(r.before), roas: roasOf(r.after) } : {}) },
    beforeCpa: r.beforeCpa, enabled: r.enabled, verdict: j.verdict,
  }
}

function remeasureRaw(cur: CampaignCase, fresh: CaseEvidence): { result: Record<string, number | null>; beforeCpa: number | null; enabled: boolean; before: PerfSnap | null; after: PerfSnap } {
  if (fresh.kind === "meta") {
    const before = cur.evidence?.kind === "meta" ? cur.evidence.campaign : null
    const c = fresh.campaign
    // Đợt 23 (3d): phiên thu lead đo lại theo số LEAD ("orders"/"cpa" = lead / chi phí mỗi lead; leads=1 để giao diện đổi nhãn).
    const kind: GoalKind = metaGoalKind(c.objective)
    const res = (x: typeof c) => metaResults(x, kind)
    const rb = before ? res(before) : 0, ra = res(c)
    return {
      result: {
        cost: Math.round(c.cost), orders: ra, cpa: ra > 0 ? Math.round(c.cost / ra) : null,
        orderValue: Math.round(kind === "leads" ? 0 : c.purchaseValue), frequency: c.frequency,
        ...(kind === "leads" ? { leads: 1 } : {}),
        ...newAdsetComparison(cur, fresh),
      },
      beforeCpa: before && rb > 0 ? before.cost / rb : null,
      enabled: c.status === "ACTIVE",
      before: before ? { cost: before.cost, orders: rb, value: kind === "leads" ? 0 : before.purchaseValue } : null,
      after: { cost: c.cost, orders: ra, value: kind === "leads" ? 0 : c.purchaseValue },
    }
  }
  const ev = fresh as SearchEvidence
  const dx = diagnoseSearch(ev, { lexicon: lexiconFor(cur.company), ceilingCpa: null })
  const before = cur.evidence && cur.evidence.kind !== "meta" ? cur.evidence.campaign : null
  return {
    result: {
      cost: Math.round(ev.campaign.cost),
      orders: ev.campaign.orders,
      cpa: ev.campaign.orders > 0 ? Math.round(ev.campaign.cost / ev.campaign.orders) : null,
      competitorSpend: Math.round(dx.causes.find((x) => x.id === "competitor-spend")?.money ?? 0),
      orderValue: Math.round(ev.campaign.orderValue ?? 0),
    },
    beforeCpa: before && before.orders > 0 ? before.cost / before.orders : null,
    enabled: ev.campaign.status === "ENABLED",
    before: before ? { cost: before.cost, orders: before.orders, value: before.orderValue ?? 0 } : null,
    after: { cost: ev.campaign.cost, orders: ev.campaign.orders, value: ev.campaign.orderValue ?? 0 },
  }
}

export { readCase, listCases }
