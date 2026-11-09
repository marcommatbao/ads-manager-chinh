// ============================================================
// Thực thi hướng xử lý lên Google Ads — đọc trước, kiểm hợp lệ, ghi, ĐỌC LẠI
// ============================================================
// Trình tự đã chạy thật trên MBI 25/09 (lib/case/* được dựng lại từ đó):
//   1. đọc trạng thái hiện tại theo campaign.id, LOẠI chiến dịch đã xoá —
//      tài khoản có chiến dịch đã xoá trùng tên, nhắm theo tên từng làm Google
//      từ chối cả lô ("operation is not allowed for removed resources");
//   2. validate_only từng nhóm thao tác — lỗi thì dừng, chưa ghi gì;
//   3. ghi theo lô ≤ 200 (Google xử lý trọn lô: một dòng hỏng = cả lô không ghi);
//   4. đọc lại và so với dự kiến từng dòng — KHÔNG tin phản hồi "thành công".
// Hoàn tác chỉ đảo những gì lần thực thi đó đã đổi; chỗ nào người khác đã sửa
// sau đó thì bỏ qua và báo.

import { enums } from "google-ads-api"
import type { Customer } from "google-ads-api"
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard"
import type { CaseAction, Execution, ReadbackRow } from "./store"
import type { Company } from "./types"
import { tokens } from "./text"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

const xg = (k: string): MessageKey => `libcase.s.xg.${k}` as MessageKey

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CampaignState {
  campaignId: string
  name: string
  resourceName: string
  status: string
  negatives: { resourceName: string; text: string; match: string }[]
}

export interface SharedListState {
  sharedSetId: string
  name: string
  resourceName: string
  members: { resourceName: string; text: string; match: string }[]
  /** Liên kết đang bật với chiến dịch (resource name của campaign_shared_set). */
  attachedCampaigns: { campaignId: string; resourceName: string }[]
}

const norm = (t: string) => tokens(t).join(" ")
const negKey = (text: string, match: string) => `${match}|${norm(text)}`

export interface PlannedOps {
  creates: { campaignId: string; campaignResource: string; text: string; match: string }[]
  removes: { campaignId: string; resourceName: string; text: string; match: string }[]
  pauses: { campaignId: string; resourceName: string; before: string }[]
  sharedCreates: { sharedSetId: string; sharedSetResource: string; text: string; match: string }[]
  sharedRemoves: { sharedSetId: string; resourceName: string; text: string; match: string }[]
  attaches: { campaignId: string; campaignResource: string; sharedSetId: string; sharedSetResource: string }[]
  expected: Record<string, { negatives: number; status: string }>
  /** Số từ dự kiến trong mỗi danh sách dùng chung + các chiến dịch dự kiến đã gắn. */
  expectedShared: Record<string, { members: number; attached: string[] }>
  /** Việc bỏ qua vì đã đúng sẵn hoặc không còn đối tượng — báo cho người duyệt. */
  skipped: string[]
}

/** Hàm thuần: trạng thái hiện tại + các việc được chọn → thao tác cụ thể + số dự kiến sau khi ghi. */
export function planOps(states: CampaignState[], actions: CaseAction[], shared: SharedListState[] = [], t: TFunction = makeT("vi")): PlannedOps {
  const byId = new Map(states.map((s) => [s.campaignId, s]))
  const lists = new Map(shared.map((l) => [l.sharedSetId, l]))
  const out: PlannedOps = { creates: [], removes: [], pauses: [], sharedCreates: [], sharedRemoves: [], attaches: [], expected: {}, expectedShared: {}, skipped: [] }
  const needList = (id: string) => {
    const l = lists.get(id)
    if (!l) throw new Error(t(xg("errListGone"), { id }))
    return l
  }
  for (const l of shared) out.expectedShared[l.sharedSetId] = { members: l.members.length, attached: l.attachedCampaigns.map((a) => a.campaignId) }
  const need = (id: string) => {
    const s = byId.get(id)
    if (!s) throw new Error(t(xg("errCampGone"), { id }))
    return s
  }
  for (const s of states) out.expected[s.campaignId] = { negatives: s.negatives.length, status: s.status }

  // Phủ định đã có sẵn gộp MỘT dòng mỗi chiến dịch — liệt kê từng từ (57 dòng
  // đo 26/09) che mất kết quả chính trên màn duyệt.
  const existed = new Map<string, string[]>()
  for (const a of actions.filter((x) => x.selected)) {
    if (a.type === "ADD_NEGATIVES") {
      for (const id of a.campaignIds) {
        const s = need(id)
        const have = new Set(s.negatives.map((n) => negKey(n.text, n.match)))
        for (const n of a.negatives) {
          const k = negKey(n.text, n.match)
          if (have.has(k)) { existed.set(s.name, [...(existed.get(s.name) ?? []), n.text]); continue }
          have.add(k)
          out.creates.push({ campaignId: id, campaignResource: s.resourceName, text: norm(n.text), match: n.match })
          out.expected[id].negatives += 1
        }
      }
    } else if (a.type === "REMOVE_NEGATIVE") {
      const s = need(a.campaignId)
      const hits = s.negatives.filter((n) => negKey(n.text, n.match) === negKey(a.text, a.match))
      if (!hits.length) { out.skipped.push(t(xg("skipNegGone"), { text: a.text, name: s.name })); continue }
      for (const h of hits) {
        out.removes.push({ campaignId: a.campaignId, resourceName: h.resourceName, text: h.text, match: h.match })
        out.expected[a.campaignId].negatives -= 1
      }
    } else if (a.type === "ADD_TO_SHARED_LIST") {
      const l = needList(a.sharedSetId)
      const have = new Set(l.members.map((m) => negKey(m.text, m.match)))
      for (const n of a.negatives) {
        const k = negKey(n.text, n.match)
        if (have.has(k)) { const ln = t(xg("listName"), { name: l.name }); existed.set(ln, [...(existed.get(ln) ?? []), n.text]); continue }
        have.add(k)
        out.sharedCreates.push({ sharedSetId: l.sharedSetId, sharedSetResource: l.resourceName, text: norm(n.text), match: n.match })
        out.expectedShared[l.sharedSetId].members += 1
      }
    } else if (a.type === "REMOVE_FROM_SHARED_LIST") {
      const l = needList(a.sharedSetId)
      for (const w of a.words) {
        const hits = l.members.filter((m) => negKey(m.text, m.match) === negKey(w.text, w.match))
        if (!hits.length) { out.skipped.push(t(xg("skipWordGone"), { text: w.text, name: l.name })); continue }
        for (const h of hits) {
          out.sharedRemoves.push({ sharedSetId: l.sharedSetId, resourceName: h.resourceName, text: h.text, match: h.match })
          out.expectedShared[l.sharedSetId].members -= 1
        }
      }
    } else if (a.type === "ATTACH_SHARED_LIST") {
      const s = need(a.campaignId)
      const l = needList(a.sharedSetId)
      if (l.attachedCampaigns.some((x) => x.campaignId === a.campaignId)) { out.skipped.push(t(xg("skipAttached"), { list: l.name, name: s.name })); continue }
      out.attaches.push({ campaignId: a.campaignId, campaignResource: s.resourceName, sharedSetId: l.sharedSetId, sharedSetResource: l.resourceName })
      out.expectedShared[l.sharedSetId].attached.push(a.campaignId)
    } else if (a.type === "PAUSE_CAMPAIGN") {
      const s = need(a.campaignId)
      if (s.status === "PAUSED") { out.skipped.push(t(xg("skipPaused"), { name: s.name })); continue }
      out.pauses.push({ campaignId: a.campaignId, resourceName: s.resourceName, before: s.status })
      out.expected[a.campaignId].status = "PAUSED"
    }
  }
  for (const [name, words] of existed) {
    const head = words.slice(0, 5).map((w) => `“${w}”`).join(", ")
    out.skipped.unshift(t(xg("skipExisting"), { n: words.length, name, head: head + (words.length > 5 ? t(xg("andMore"), { n: words.length - 5 }) : "") }))
  }
  return out
}

const STATUS_VI: Record<string, string> = { ENABLED: "Đang chạy", PAUSED: "Đã dừng" }
const viStatus = (s: string, t: TFunction) => (s in STATUS_VI ? t(xg(`status.${s}`)) : s)

/** Hàm thuần: so trạng thái đọc lại với dự kiến, từng dòng. */
export function compareReadback(
  before: CampaignState[], after: CampaignState[], plan: PlannedOps,
  sharedBefore: SharedListState[] = [], sharedAfter: SharedListState[] = [], t: TFunction = makeT("vi"),
): ReadbackRow[] {
  const unreadable = t(xg("unreadable")), yes = t(xg("yes")), no = t(xg("no"))
  const rows: ReadbackRow[] = []
  for (const b of sharedBefore) {
    const a = sharedAfter.find((x) => x.sharedSetId === b.sharedSetId)
    const exp = plan.expectedShared[b.sharedSetId]
    if (!exp) continue
    if (exp.members !== b.members.length) {
      rows.push({ label: t(xg("rbWordCount"), { name: b.name }), before: String(b.members.length), after: a ? String(a.members.length) : unreadable, expected: String(exp.members), ok: a?.members.length === exp.members })
    }
    for (const r of plan.sharedRemoves.filter((x) => x.sharedSetId === b.sharedSetId)) {
      const still = a ? a.members.some((m) => negKey(m.text, m.match) === negKey(r.text, r.match)) : true
      rows.push({ label: t(xg("rbStillInList"), { text: r.text, name: b.name }), before: yes, after: a ? (still ? yes : no) : unreadable, expected: no, ok: !still })
    }
    for (const cid of exp.attached.filter((id) => !b.attachedCampaigns.some((x) => x.campaignId === id))) {
      const name = before.find((x) => x.campaignId === cid)?.name ?? cid
      const ok = !!a?.attachedCampaigns.some((x) => x.campaignId === cid)
      rows.push({ label: t(xg("rbAttach"), { list: b.name, name }), before: t(xg("notYet")), after: a ? (ok ? t(xg("attached")) : t(xg("notYet"))) : unreadable, expected: t(xg("attached")), ok })
    }
  }
  for (const b of before) {
    const a = after.find((x) => x.campaignId === b.campaignId)
    const exp = plan.expected[b.campaignId]
    const afterNeg = a ? a.negatives.length : -1
    rows.push({ label: t(xg("rbNegatives"), { name: b.name }), before: String(b.negatives.length), after: a ? String(afterNeg) : unreadable, expected: String(exp.negatives), ok: afterNeg === exp.negatives })
    if (exp.status !== b.status || plan.pauses.some((p) => p.campaignId === b.campaignId)) {
      rows.push({ label: t(xg("rbStatus"), { name: b.name }), before: viStatus(b.status, t), after: a ? viStatus(a.status, t) : unreadable, expected: viStatus(exp.status, t), ok: a?.status === exp.status })
    }
  }
  for (const r of plan.removes) {
    const a = after.find((x) => x.campaignId === r.campaignId)
    const still = a?.negatives.some((n) => negKey(n.text, n.match) === negKey(r.text, r.match)) ?? true
    rows.push({ label: t(xg("rbStillNeg"), { text: r.text }), before: yes, after: still ? yes : no, expected: no, ok: !still })
  }
  return rows
}

// ── Gọi Google ─────────────────────────────────────────────────────

const en = (e: Record<string | number, string | number>, v: unknown) =>
  typeof v === "number" ? String(e[v] ?? v) : String(v ?? "")

export async function readCampaignStates(customer: Customer, campaignIds: string[]): Promise<CampaignState[]> {
  const ids = [...new Set(campaignIds)]
  if (!ids.length) return []
  if (!ids.every((id) => /^\d+$/.test(id))) throw new Error("campaignId phải là số")
  const inList = ids.join(",")
  const camps = (await customer.query(`SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name
    FROM campaign WHERE campaign.id IN (${inList}) AND campaign.status != 'REMOVED'`)) as Row[]
  const negs = (await customer.query(`SELECT campaign.id, campaign_criterion.resource_name,
      campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion WHERE campaign.id IN (${inList}) AND campaign_criterion.negative = TRUE
      AND campaign_criterion.type = 'KEYWORD' AND campaign.status != 'REMOVED'`)) as Row[]
  return camps.map((c) => ({
    campaignId: String(c.campaign.id),
    name: String(c.campaign.name),
    resourceName: String(c.campaign.resource_name),
    status: en(enums.CampaignStatus, c.campaign.status),
    negatives: negs.filter((n) => String(n.campaign.id) === String(c.campaign.id)).map((n) => ({
      resourceName: String(n.campaign_criterion.resource_name),
      text: String(n.campaign_criterion.keyword?.text ?? ""),
      match: en(enums.KeywordMatchType, n.campaign_criterion.keyword?.match_type),
    })),
  }))
}

export async function readSharedStates(customer: Customer, sharedSetIds: string[]): Promise<SharedListState[]> {
  const ids = [...new Set(sharedSetIds)]
  if (!ids.length) return []
  if (!ids.every((id) => /^\d+$/.test(id))) throw new Error("sharedSetId phải là số")
  const inList = ids.join(",")
  const sets = (await customer.query(`SELECT shared_set.id, shared_set.name, shared_set.resource_name FROM shared_set
    WHERE shared_set.id IN (${inList}) AND shared_set.status = 'ENABLED'`)) as Row[]
  const members = (await customer.query(`SELECT shared_set.id, shared_criterion.resource_name, shared_criterion.keyword.text,
      shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.id IN (${inList})`)) as Row[]
  const links = (await customer.query(`SELECT shared_set.id, campaign.id, campaign_shared_set.resource_name FROM campaign_shared_set
    WHERE shared_set.id IN (${inList}) AND campaign_shared_set.status = 'ENABLED'`)) as Row[]
  return sets.map((r) => {
    const id = String(r.shared_set.id)
    return {
      sharedSetId: id, name: String(r.shared_set.name), resourceName: String(r.shared_set.resource_name),
      members: members.filter((m) => String(m.shared_set.id) === id).map((m) => ({
        resourceName: String(m.shared_criterion.resource_name), text: String(m.shared_criterion.keyword?.text ?? ""),
        match: en(enums.KeywordMatchType, m.shared_criterion.keyword?.match_type),
      })),
      attachedCampaigns: links.filter((l) => String(l.shared_set.id) === id).map((l) => ({ campaignId: String(l.campaign.id), resourceName: String(l.campaign_shared_set.resource_name) })),
    }
  })
}

const gErr = (e: unknown) => {
  const x = e as { errors?: { message?: string }[]; message?: string }
  return x?.errors?.[0]?.message ?? x?.message ?? String(e)
}
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const matchEnum = (m: string) => (enums.KeywordMatchType as unknown as Record<string, number>)[m] ?? enums.KeywordMatchType.PHRASE

async function runOps(customer: Customer, plan: PlannedOps, validateOnly: boolean, out?: { sharedCreated: string[]; attached: string[] }): Promise<string[]> {
  const opt = validateOnly ? { validate_only: true } : undefined
  const created: string[] = []
  // Bỏ từ rủi ro + thêm từ vào list TRƯỚC khi gắn list — gắn xong là list đã đúng.
  if (plan.sharedRemoves.length) await customer.sharedCriteria.remove(plan.sharedRemoves.map((r) => r.resourceName), opt)
  for (const batch of chunk(plan.sharedCreates, 200)) {
    const r = await customer.sharedCriteria.create(batch.map((c) => ({
      shared_set: c.sharedSetResource, keyword: { text: c.text, match_type: matchEnum(c.match) },
    })), opt)
    if (!validateOnly) out?.sharedCreated.push(...(r.results ?? []).map((x) => String(x.resource_name)))
  }
  if (plan.attaches.length) {
    const r = await customer.campaignSharedSets.create(plan.attaches.map((a) => ({ campaign: a.campaignResource, shared_set: a.sharedSetResource })), opt)
    if (!validateOnly) out?.attached.push(...(r.results ?? []).map((x) => String(x.resource_name)))
  }
  for (const batch of chunk(plan.creates, 200)) {
    const r = await customer.campaignCriteria.create(batch.map((c) => ({
      campaign: c.campaignResource, negative: true, keyword: { text: c.text, match_type: matchEnum(c.match) },
    })), opt)
    if (!validateOnly) created.push(...(r.results ?? []).map((x) => String(x.resource_name)))
  }
  if (plan.removes.length) await customer.campaignCriteria.remove(plan.removes.map((r) => r.resourceName), opt)
  if (plan.pauses.length) {
    await customer.campaigns.update(plan.pauses.map((p) => ({ resource_name: p.resourceName, status: enums.CampaignStatus.PAUSED })), opt)
  }
  return created
}

export async function executeGoogleActions(input: {
  customer: Customer; company: Company; actions: CaseAction[]; actor: string; idempotencyKey: string
  /** true = chỉ nhờ Google kiểm hợp lệ rồi dừng — KHÔNG ghi gì (nút "Kiểm trước"). */
  validateOnly?: boolean
  t?: TFunction
}): Promise<Execution> {
  const { customer, company, actions, actor } = input
  const t = input.t ?? makeT("vi")
  const exec: Execution = {
    id: `exec_${Date.now().toString(36)}`, at: new Date().toISOString(), by: actor, idempotencyKey: input.idempotencyKey,
    mode: input.validateOnly ? "validate" : "write",
    status: "failed", warnings: [], errors: [], created: [], removed: [], paused: [], readback: [],
  }
  const sel = actions.filter((a) => a.selected)
  const ids = sel.flatMap((a) => (a.type === "ADD_NEGATIVES" ? a.campaignIds
    : a.type === "REMOVE_NEGATIVE" || a.type === "PAUSE_CAMPAIGN" || a.type === "ATTACH_SHARED_LIST" ? [a.campaignId] : []))
  const listIds = sel.flatMap((a) => (a.type === "ADD_TO_SHARED_LIST" || a.type === "ATTACH_SHARED_LIST" || a.type === "REMOVE_FROM_SHARED_LIST" ? [a.sharedSetId] : []))
  let before: CampaignState[]
  let sharedBefore: SharedListState[]
  let plan: PlannedOps
  try {
    before = await readCampaignStates(customer, ids)
    sharedBefore = await readSharedStates(customer, listIds)
    plan = planOps(before, actions, sharedBefore, t)
  } catch (e) {
    exec.errors.push(t(xg("errReadBefore"), { error: gErr(e) }))
    return exec
  }
  exec.warnings.push(...plan.skipped)
  for (const id of new Set(ids)) {
    const chk = checkRecentCampaignMutation(id, company, "human_manual")
    if (chk.hasConflict && chk.note) exec.warnings.push(chk.note)
  }

  try {
    await runOps(customer, plan, true)
  } catch (e) {
    exec.errors.push(t(xg("errValidate"), { error: gErr(e) }))
    return exec
  }
  if (input.validateOnly) {
    exec.status = "done"
    exec.readback = Object.entries(plan.expected).map(([id, e]) => {
      const b = before.find((x) => x.campaignId === id)!
      const vi = (st: string) => viStatus(st, t)
      return { label: t(xg("rbExpected"), { name: b.name }), before: t(xg("rbNegStatus"), { n: b.negatives.length, status: vi(b.status) }), after: t(xg("rbNotWritten")), expected: t(xg("rbNegStatus"), { n: e.negatives, status: vi(e.status) }), ok: true }
    })
    const extra = plan.sharedCreates.length || plan.sharedRemoves.length || plan.attaches.length
      ? t(xg("validateExtra"), { removes: plan.sharedRemoves.length, creates: plan.sharedCreates.length, attaches: plan.attaches.length }) : ""
    exec.warnings.unshift(t(xg("validateOnly"), { creates: plan.creates.length, removes: plan.removes.length, pauses: plan.pauses.length, extra }))
    return exec
  }
  try {
    const extraOut = { sharedCreated: [] as string[], attached: [] as string[] }
    exec.sharedCreated = extraOut.sharedCreated
    exec.sharedRemoved = plan.sharedRemoves.map(({ sharedSetId, text, match }) => ({ sharedSetId, text, match }))
    exec.attached = extraOut.attached
    exec.created = await runOps(customer, plan, false, extraOut)
    exec.removed = plan.removes.map(({ campaignId, text, match }) => ({ campaignId, text, match }))
    exec.paused = plan.pauses.map(({ campaignId, before: b }) => ({ campaignId, before: b }))
  } catch (e) {
    // Lô trước có thể đã ghi — đọc lại bên dưới sẽ cho biết thật sự đã đổi gì.
    exec.errors.push(t(xg("errWrite"), { error: gErr(e) }))
  }
  for (const p of plan.pauses) {
    const name = before.find((b) => b.campaignId === p.campaignId)?.name ?? ""
    recordCampaignMutation({ source: { type: "human_manual", actor }, event: "campaign.pause", company, campaignId: p.campaignId, campaignName: name, rationale: "Xử lý chiến dịch — dừng sau khi chẩn đoán" })
  }
  try {
    const after = await readCampaignStates(customer, ids)
    const sharedAfter = await readSharedStates(customer, listIds)
    exec.readback = compareReadback(before, after, plan, sharedBefore, sharedAfter, t)
  } catch (e) {
    exec.errors.push(t(xg("errReadback"), { error: gErr(e) }))
  }
  exec.status = exec.errors.length === 0 && exec.readback.every((r) => r.ok) ? "done" : "failed"
  return exec
}

export async function undoGoogleExecution(input: {
  customer: Customer; company: Company; exec: Execution; actor: string; t?: TFunction
}): Promise<string[]> {
  const { customer, exec } = input
  const t = input.t ?? makeT("vi")
  const report: string[] = []
  const ids = [...new Set([...exec.removed.map((r) => r.campaignId), ...exec.paused.map((p) => p.campaignId),
    ...exec.created.map((rn) => rn.split("/campaignCriteria/")[1]?.split("~")[0] ?? "").filter(Boolean)])]
  const now = await readCampaignStates(customer, ids)
  const existing = new Set(now.flatMap((s) => s.negatives.map((n) => n.resourceName)))

  const toDelete = exec.created.filter((rn) => existing.has(rn))
  if (exec.created.length - toDelete.length > 0) report.push(t(xg("undoNegDeletedByOther"), { n: exec.created.length - toDelete.length }))
  for (const batch of chunk(toDelete, 200)) await customer.campaignCriteria.remove(batch)
  if (toDelete.length) report.push(t(xg("undoNegDeleted"), { n: toDelete.length }))

  const readd = exec.removed.filter((r) => {
    const s = now.find((x) => x.campaignId === r.campaignId)
    return s && !s.negatives.some((n) => negKey(n.text, n.match) === negKey(r.text, r.match))
  })
  if (readd.length) {
    await customer.campaignCriteria.create(readd.map((r) => ({
      campaign: now.find((s) => s.campaignId === r.campaignId)!.resourceName, negative: true,
      keyword: { text: r.text, match_type: matchEnum(r.match) },
    })))
    report.push(t(xg("undoNegReadded"), { n: readd.length, list: readd.map((r) => `“${r.text}”`).join(", ") }))
  }

  for (const p of exec.paused) {
    const s = now.find((x) => x.campaignId === p.campaignId)
    if (!s) { report.push(t(xg("undoCampGone"), { id: p.campaignId })); continue }
    if (s.status !== "PAUSED") { report.push(t(xg("undoStatusChanged"), { name: s.name, status: s.status })); continue }
    const target = (enums.CampaignStatus as unknown as Record<string, number>)[p.before]
    await customer.campaigns.update([{ resource_name: s.resourceName, status: target }])
    recordCampaignMutation({ source: { type: "human_manual", actor: input.actor }, event: "campaign.resume", company: input.company, campaignId: p.campaignId, campaignName: s.name, rationale: "Xử lý chiến dịch — hoàn tác" })
    report.push(t(xg("undoResumed"), { name: s.name }))
  }
  // Danh sách dùng chung: gỡ liên kết phiên đã gắn, xoá từ phiên đã thêm (còn tồn tại mới xoá).
  const sharedCreated = exec.sharedCreated ?? []
  const attached = exec.attached ?? []
  const sharedRemoved = exec.sharedRemoved ?? []
  if (sharedCreated.length || attached.length || sharedRemoved.length) {
    const listIds = [...new Set([
      ...sharedRemoved.map((r) => r.sharedSetId),
      ...sharedCreated.map((rn) => rn.split("/sharedCriteria/")[1]?.split("~")[0] ?? ""),
      ...attached.map((rn) => rn.split("/campaignSharedSets/")[1]?.split("~")[1] ?? ""),
    ].filter(Boolean))]
    const lists = await readSharedStates(customer, listIds)
    const liveLinks = new Set(lists.flatMap((l) => l.attachedCampaigns.map((a) => a.resourceName)))
    const liveMembers = new Set(lists.flatMap((l) => l.members.map((m) => m.resourceName)))
    const unlink = attached.filter((rn) => liveLinks.has(rn))
    if (unlink.length) { await customer.campaignSharedSets.remove(unlink); report.push(t(xg("undoUnlinked"), { n: unlink.length })) }
    if (attached.length > unlink.length) report.push(t(xg("undoLinksGone"), { n: attached.length - unlink.length }))
    const delMembers = sharedCreated.filter((rn) => liveMembers.has(rn))
    for (const batch of chunk(delMembers, 200)) await customer.sharedCriteria.remove(batch)
    if (delMembers.length) report.push(t(xg("undoWordsDeleted"), { n: delMembers.length }))
    if (sharedCreated.length > delMembers.length) report.push(t(xg("undoWordsGone"), { n: sharedCreated.length - delMembers.length }))
    // Thêm lại từ phiên đã bỏ (nếu chưa có ai thêm lại).
    const readd = sharedRemoved.filter((r) => {
      const l = lists.find((x) => x.sharedSetId === r.sharedSetId)
      return l && !l.members.some((m) => negKey(m.text, m.match) === negKey(r.text, r.match))
    })
    if (readd.length) {
      await customer.sharedCriteria.create(readd.map((r) => ({
        shared_set: lists.find((x) => x.sharedSetId === r.sharedSetId)!.resourceName, keyword: { text: r.text, match_type: matchEnum(r.match) },
      })))
      report.push(t(xg("undoWordsReadded"), { n: readd.length, list: readd.map((r) => `“${r.text}”`).join(", ") }))
    }
  }
  return report
}
