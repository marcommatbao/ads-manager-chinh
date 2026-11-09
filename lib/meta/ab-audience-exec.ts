// ============================================================
// A/B test tệp đối tượng Meta — phần GỌI META (xem luật ở lib/meta/ab-audience.ts)
// ============================================================
// Mọi lệnh ghi: Kiểm trước (validate_only) rồi mới ghi; đọc trạng thái thật trước khi bật/tắt (lệch dự kiến → không ghi đè);
// nhóm B và quảng cáo tạo ở trạng thái TẠM DỪNG; bật/tắt được ghi nhật ký cấp nhóm (Hoàn tác được ở "Đã làm & kết quả").
import { detectCompany } from "@/lib/company-detect"
import { adAccountId, metaGet, metaGetAll, metaPost } from "@/lib/case/meta-graph"
import { readSource, undoD5 } from "@/lib/case/meta-new-adset"
import { retiredPositionsNote, writableTargeting } from "@/lib/case/meta-placements"
import { metaGoalKind } from "@/lib/case/goal-kind"
import { vnDate } from "@/lib/case/dates"
import { computeTargetingSimilarity } from "@/lib/audience-overlap"
import { recordCampaignMutation } from "@/lib/mutation-guard"
import { setCapped } from "@/lib/cost-guard"
import { getWinning } from "./winning-audiences"
import { targetingSummary } from "./winning-audiences-text"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { compareGroup, type CompareGroup } from "./audience-compare"
import { adsetRow, ADSET_INSIGHT_FIELDS, ATTRIBUTION_WINDOWS } from "./audience-compare-fetch"
import { busyAdset, daysRunning, newAbId, planWarnings, saveAbTest, validateEdit, variantTargeting, type AbAudienceTest, type AbVariant } from "./ab-audience"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export class AbRefused extends Error {}

const ddmm = () => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(new Date())
const num = (x: unknown) => (x === undefined || x === null || x === "" || x === "0" ? null : Number(x))

export interface AbPlan {
  campaignId: string; campaignName: string; goalKind: AbAudienceTest["goalKind"]
  a: { adsetId: string; adsetName: string; summary: string }
  bName: string; bSummary: string; bTargeting: Record<string, unknown>; droppedKeys: string[]
  dailyBudget: number | null; ads: number; overlapPct: number
  blockers: string[]; warnings: string[]
}

/** Đọc nhóm A + chiến dịch, dựng nhóm B (chưa ghi). */
async function buildPlan(company: string, sourceAdsetId: string, variant: AbVariant, t: TFunction = makeT("vi")) {
  if (!/^\d{5,25}$/.test(sourceAdsetId)) throw new AbRefused("Mã nhóm quảng cáo không hợp lệ")
  if (variant.kind === "edit") { const e = validateEdit(variant, t); if (e) throw new AbRefused(e) }
  const busy = busyAdset(sourceAdsetId)
  if (busy) throw new AbRefused("Nhóm này đang nằm trong một thử nghiệm chưa xong — kết thúc thử nghiệm đó trước")
  const s = await readSource(sourceAdsetId)
  const camp = await metaGet<Row>(String(s.src.campaign_id), { fields: "id,name,objective,status,daily_budget,lifetime_budget" })
  if (detectCompany(String(camp.name ?? "")) !== company) throw new AbRefused(`Chiến dịch “${camp.name ?? s.src.campaign_id}” không thuộc công ty đang chọn`)
  let winningT: Record<string, unknown> | undefined
  if (variant.kind === "winning") {
    const w = getWinning(variant.winningId)
    if (!w || w.company !== company) throw new AbRefused("Không còn tệp thắng này (hoặc thuộc công ty khác)")
    winningT = w.targeting
  }
  const aT = (s.src.targeting ?? {}) as Record<string, unknown>
  const { body: bT, dropped, retired } = writableTargeting(variantTargeting(aT, variant, winningT) as never)
  const overlapPct = Math.round(computeTargetingSimilarity({ targeting: aT } as never, { targeting: bT } as never).overall * 100)
  const daily = num(s.src.daily_budget), lifetime = num(s.src.lifetime_budget)
  const { blockers, warnings } = planWarnings({
    aTargeting: writableTargeting(aT as never).body as Record<string, unknown>, bTargeting: bT as Record<string, unknown>, overlapPct,
    campaignBudget: num(camp.daily_budget) !== null || num(camp.lifetime_budget) !== null,
    adsetDaily: daily, adsetLifetime: lifetime, aStatus: String(s.src.status), activeAds: s.ads.length, skippedAds: s.skipped,
  }, t)
  if (dropped.length) warnings.push(t("libmeta.ab.warnDropped", { keys: dropped.join(", ") }))
  const retiredNote = retiredPositionsNote(retired)
  if (retiredNote) warnings.push(retiredNote)
  const bName = `${String(s.src.name).slice(0, 150)} · A/B tệp B · AdsCommand ${ddmm()}`
  const plan: AbPlan = {
    campaignId: String(camp.id), campaignName: String(camp.name ?? ""), goalKind: metaGoalKind(String(camp.objective ?? "")),
    a: { adsetId: String(s.src.id), adsetName: String(s.src.name ?? ""), summary: targetingSummary(aT, t) },
    bName, bSummary: targetingSummary(bT as Record<string, unknown>, t), bTargeting: bT as Record<string, unknown>, droppedKeys: dropped,
    dailyBudget: daily, ads: s.ads.length, overlapPct, blockers, warnings,
  }
  return { plan, src: s.src, ads: s.ads }
}

/** Thân lệnh tạo nhóm B — chép y nhóm A, chỉ đổi tên + tệp. HÀM THUẦN. */
export function variantBody(src: Row, targeting: Record<string, unknown>, name: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name, campaign_id: String(src.campaign_id), status: "PAUSED", targeting,
    optimization_goal: src.optimization_goal, billing_event: src.billing_event,
  }
  for (const k of ["promoted_object", "attribution_spec", "destination_type", "bid_strategy", "bid_amount", "daily_budget", "lifetime_budget", "end_time"]) {
    if (src[k] !== undefined && src[k] !== null && src[k] !== "" && src[k] !== "0") body[k] = src[k]
  }
  return body
}

/** Bước 1 — xem trước + nhờ Meta Kiểm trước (không tạo gì). */
export async function planAbTest(company: string, sourceAdsetId: string, variant: AbVariant, t: TFunction = makeT("vi")): Promise<AbPlan & { validated: boolean; metaError: string | null }> {
  const { plan, src, ads } = await buildPlan(company, sourceAdsetId, variant, t)
  if (plan.blockers.length) return { ...plan, validated: false, metaError: null }
  const act = `act_${adAccountId()}`
  try {
    await metaPost(`${act}/adsets`, variantBody(src, plan.bTargeting, plan.bName), true)
    for (const ad of ads) await metaPost(`${act}/ads`, { name: String(ad.name), adset_id: plan.a.adsetId, creative: { creative_id: String(ad.creative.id) }, status: "PAUSED" }, true)
    return { ...plan, validated: true, metaError: null }
  } catch (e) {
    return { ...plan, validated: false, metaError: `Meta từ chối khi kiểm — chưa tạo gì: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Bước 2 — tạo nhóm B + quảng cáo (TẠM DỪNG), lưu thử nghiệm ở trạng thái "nháp". */
export async function createAbTest(company: string, sourceAdsetId: string, variant: AbVariant, actor: string): Promise<AbAudienceTest> {
  const { plan, src, ads } = await buildPlan(company, sourceAdsetId, variant)
  if (plan.blockers.length) throw new AbRefused(plan.blockers.join(" "))
  const act = `act_${adAccountId()}`
  const body = variantBody(src, plan.bTargeting, plan.bName)
  try { await metaPost(`${act}/adsets`, body, true) } catch (e) { throw new AbRefused(`Meta từ chối khi kiểm — chưa tạo gì: ${e instanceof Error ? e.message : String(e)}`) }
  const bId = String((await metaPost(`${act}/adsets`, body, false)).id)
  const t: AbAudienceTest = {
    id: newAbId(), company, goalKind: plan.goalKind, campaignId: plan.campaignId, campaignName: plan.campaignName,
    a: plan.a, b: { adsetId: bId, adsetName: plan.bName, adIds: [], summary: plan.bSummary }, variant,
    dailyBudget: plan.dailyBudget, overlapPct: plan.overlapPct, warnings: plan.warnings, status: "draft", createdBy: actor, createdAt: new Date().toISOString(),
  }
  await saveAbTest(t) // lưu NGAY khi có nhóm B — để luôn huỷ được kể cả khi tạo quảng cáo hỏng giữa chừng
  const errors: string[] = []
  for (const ad of ads) {
    try { t.b.adIds.push(String((await metaPost(`${act}/ads`, { name: String(ad.name), adset_id: bId, creative: { creative_id: String(ad.creative.id) }, status: "PAUSED" }, false)).id)) }
    catch (e) { errors.push(`Lỗi khi tạo quảng cáo “${ad.name}”: ${e instanceof Error ? e.message : String(e)}`); break }
  }
  if (errors.length) t.warnings = [...t.warnings, ...errors, "Nhóm B thiếu quảng cáo so với A — bấm Huỷ thử nghiệm rồi tạo lại."]
  await saveAbTest(t)
  return t
}

/** Trạng thái thật của nhiều đối tượng Meta. */
async function statuses(ids: string[]): Promise<Map<string, string>> {
  const r = await metaGet<Record<string, Row>>("", { ids: ids.join(","), fields: "id,status" })
  return new Map(Object.values(r).map((v) => [String(v.id), String(v.status)]))
}

/** Bước 3 — bắt đầu: bật quảng cáo của B rồi bật B (A phải còn chạy). */
export async function startAbTest(t: AbAudienceTest, actor: string): Promise<AbAudienceTest> {
  if (t.status !== "draft") throw new AbRefused("Thử nghiệm này đã bắt đầu hoặc đã xong")
  if (!t.b.adIds.length) throw new AbRefused("Nhóm B chưa có quảng cáo nào — huỷ rồi tạo lại")
  const cur = await statuses([t.a.adsetId, t.b.adsetId, ...t.b.adIds])
  if (cur.get(t.a.adsetId) !== "ACTIVE") throw new AbRefused(`Nhóm A đang ${cur.get(t.a.adsetId) ?? "?"} — bật lại A trước, nếu không hai bên không chạy cùng lúc`)
  if (cur.get(t.b.adsetId) !== "PAUSED") throw new AbRefused(`Nhóm B đang ${cur.get(t.b.adsetId) ?? "?"} (khác dự kiến TẠM DỪNG) — có người đã đổi, không ghi đè`)
  const ads = t.b.adIds.filter((id) => cur.get(id) === "PAUSED")
  try { for (const id of [...ads, t.b.adsetId]) await metaPost(id, { status: "ACTIVE" }, true) }
  catch (e) { throw new AbRefused(`Meta từ chối khi kiểm — chưa bật gì: ${e instanceof Error ? e.message : String(e)}`) }
  for (const id of ads) await metaPost(id, { status: "ACTIVE" }, false) // quảng cáo trước, nhóm sau
  await metaPost(t.b.adsetId, { status: "ACTIVE" }, false)
  recordCampaignMutation({ source: { type: "human_manual", actor }, event: "adset.resume", company: t.company, campaignId: t.b.adsetId, campaignName: t.b.adsetName, rationale: `Bắt đầu A/B test tệp (so với “${t.a.adsetName}”)`, platform: "meta", change: { field: "status", before: "PAUSED", after: "ACTIVE" }, entityType: "adset", parentId: t.campaignId, parentName: t.campaignName })
  const next = { ...t, status: "running" as const, startedAt: new Date().toISOString(), startedBy: actor }
  await saveAbTest(next)
  return next
}

/** Huỷ thử nghiệm chưa bắt đầu: B chưa phân phối → xoá B + quảng cáo; đã phân phối → chỉ tạm dừng (giữ số). */
export async function discardAbTest(t: AbAudienceTest, actor: string): Promise<{ test: AbAudienceTest; report: string[] }> {
  if (t.status !== "draft") throw new AbRefused("Chỉ huỷ được thử nghiệm CHƯA bắt đầu — thử nghiệm đang chạy thì bấm Kết thúc")
  const report = await undoD5([{ kind: "adset_created", id: t.b.adsetId, name: t.b.adsetName, adIds: t.b.adIds, sourceAdsetId: t.a.adsetId, event: "", after: "PAUSED" }])
  const next = { ...t, status: "discarded" as const, endedAt: new Date().toISOString(), endedBy: actor }
  await saveAbTest(next)
  return { test: next, report }
}

const memo = new Map<string, { at: number; v: { group: CompareGroup | null; days: number; range: { from: string; to: string } } }>()

/** Đo thử nghiệm từ ngày bắt đầu — cùng phép thử của So sánh tệp. 2 lượt gọi Meta, đệm 10 phút. */
export async function measureAbTest(t: AbAudienceTest, opts: { force?: boolean; now?: Date } = {}) {
  if (!t.startedAt) return { group: null, days: 0, range: null }
  const now = opts.now ?? new Date()
  const end = t.endedAt ? new Date(t.endedAt) : now
  const range = { from: vnDate(new Date(t.startedAt)), to: vnDate(end) }
  const key = `${t.id}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < 600_000) return hit.v
  const nodes = await metaGet<Record<string, Row>>("", { ids: `${t.a.adsetId},${t.b.adsetId}`, fields: "id,name,status,optimization_goal,promoted_object,learning_stage_info,targeting,ads.limit(50){status,creative{id}}" })
  const ins = await metaGetAll<Row>(`act_${adAccountId()}/insights`, {
    level: "adset", time_range: JSON.stringify({ since: range.from, until: range.to }),
    filtering: JSON.stringify([{ field: "adset.id", operator: "IN", value: [t.a.adsetId, t.b.adsetId] }]),
    fields: ADSET_INSIGHT_FIELDS, action_attribution_windows: ATTRIBUTION_WINDOWS, limit: "50",
  })
  const insBy = new Map(ins.map((r) => [String(r.adset_id), r]))
  const rows = [t.a.adsetId, t.b.adsetId].flatMap((id) => {
    const a = nodes[id]
    if (!a) return []
    const creatives = [...new Set(((a.ads?.data ?? []) as Row[]).filter((x) => x.creative?.id).map((x) => String(x.creative.id)))]
    return [adsetRow(a, insBy.get(id) ?? {}, { id: t.campaignId, name: t.campaignName }, t.goalKind, creatives)]
  })
  const v = { group: rows.length ? compareGroup(t.goalKind, rows) : null, days: daysRunning(t.startedAt, end), range }
  setCapped(memo, key, { at: Date.now(), v })
  return v
}

/** Kết thúc: chụp kết luận; tuỳ chọn tạm dừng một bên (bên còn lại phải đang chạy — không dừng cả hai). */
export async function endAbTest(t: AbAudienceTest, pauseSide: "a" | "b" | null, actor: string): Promise<AbAudienceTest> {
  if (t.status !== "running") throw new AbRefused("Chỉ kết thúc được thử nghiệm đang chạy")
  const m = await measureAbTest(t, { force: true })
  let paused: string | null = null
  if (pauseSide) {
    const id = pauseSide === "a" ? t.a.adsetId : t.b.adsetId
    const other = pauseSide === "a" ? t.b.adsetId : t.a.adsetId
    const cur = await statuses([id, other])
    if (cur.get(id) !== "ACTIVE") throw new AbRefused(`Nhóm ${pauseSide.toUpperCase()} đang ${cur.get(id) ?? "?"} — không cần tạm dừng`)
    if (cur.get(other) !== "ACTIVE") throw new AbRefused("Bên còn lại không chạy — tạm dừng bên này là dừng cả hai. Muốn vậy thì tắt ở bảng Chiến dịch.")
    try { await metaPost(id, { status: "PAUSED" }, true) } catch (e) { throw new AbRefused(`Meta từ chối khi kiểm — chưa ghi gì: ${e instanceof Error ? e.message : String(e)}`) }
    await metaPost(id, { status: "PAUSED" }, false)
    const name = pauseSide === "a" ? t.a.adsetName : t.b.adsetName
    recordCampaignMutation({ source: { type: "human_manual", actor }, event: "adset.pause", company: t.company, campaignId: id, campaignName: name, rationale: `Kết thúc A/B test tệp — giữ nhóm ${pauseSide === "a" ? "B" : "A"}`, notes: m.group?.summary, platform: "meta", change: { field: "status", before: "ACTIVE", after: "PAUSED" }, entityType: "adset", parentId: t.campaignId, parentName: t.campaignName })
    paused = id
  }
  const next: AbAudienceTest = { ...t, status: "ended", endedAt: new Date().toISOString(), endedBy: actor, result: { verdict: m.group?.verdict ?? "not_enough", winnerId: m.group?.winnerId ?? null, summary: m.group?.summary ?? "Chưa có số liệu", days: m.days, paused } }
  await saveAbTest(next)
  return next
}
