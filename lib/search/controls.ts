// ============================================================
// Đợt 11b — Việc nên làm cho Search: thêm lượt tìm ra đơn làm từ khoá · tạm dừng từ khoá đốt tiền · phủ định đối thủ/hỏi
// ============================================================
// Khác các nút cũ ở /google-search (ghi thẳng, không hoàn tác — kiểm kê 29/09): ở đây mọi ghi đều Kiểm trước (validate_only
// CẢ lô) → XAC NHAN → ghi → đọc lại → nhật ký data/search-controls.json → hoàn tác. Đề xuất TÍNH LẠI ở máy chủ, client chỉ
// gửi mã việc. "Đơn" = nhóm Mua hàng.

import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { intentOf, type IntentLexicon } from "@/lib/case/intent"
import { blocks, withAccentVariants, type NegativeKw } from "@/lib/case/simulate-negatives"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { BRAND_INTENTS, type SearchXray } from "./xray"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, vndT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const SEARCH_CONFIRM_TEXT = PMAX_CONFIRM_TEXT
export type SearchControlKind = "add_keyword" | "pause_keyword" | "neg_keyword"
export interface SearchProposal {
  id: string; kind: SearchControlKind; campaignId: string; campaignName: string; adGroupId?: string
  label: string; why: string; defaultChecked: boolean; warning?: string; cost: number | null
  payload: { text?: string; match?: "EXACT" | "PHRASE"; criterion?: string }
}
/** Chiến dịch thương hiệu đã tách → bản "· Chung": nhóm gốc → nhóm cùng tên ở bản tách (id số). */
export interface SplitTarget { campaignId: string; campaignName: string; adGroups: Map<string, string> }
export const ADD_MIN_PURCHASES = 2
export const PAUSE_CPA_X = 3
export const PAUSE_MIN_COST = 300_000
const NEG_INTENTS = new Set(["competitor", "info"])
const norm = (s: string) => stripDiacritics(s).replace(/\s+/g, " ").trim()

/** Đề xuất — HÀM THUẦN. existingNegatives: campaignId → phủ định (chữ đã bỏ dấu). */
export function proposeSearch(x: Pick<SearchXray, "campaigns" | "keywords" | "terms">, existingNegatives: Record<string, string[]>, lex: IntentLexicon, splitSources: Set<string> = new Set(), splitTargets: Map<string, SplitTarget> = new Map(), t: TFunction = viT): SearchProposal[] {
  const vnd = (n: number) => vndT(t, n)
  const out: SearchProposal[] = []
  const ids = new Set<string>()
  const camps = new Map(x.campaigns.filter((c) => c.status === "ENABLED").map((c) => [c.id, c]))
  const accCost = x.campaigns.reduce((s, c) => s + c.cost, 0), accP = x.campaigns.reduce((s, c) => s + c.purchases, 0)
  const accCpa = accP > 0 ? accCost / accP : null
  const kwByCamp = new Map<string, Set<string>>()
  for (const k of x.keywords) (kwByCamp.get(k.campaignId) ?? kwByCamp.set(k.campaignId, new Set()).get(k.campaignId)!).add(norm(k.text))

  // 1. Lượt tìm ra đơn chưa có từ khoá khớp CHÍNH XÁC → thêm EXACT vào đúng nhóm quảng cáo đã phục vụ nó.
  for (const tm of x.terms) {
    const c = camps.get(tm.campaignId)
    if (!c || tm.purchases < 1 || kwByCamp.get(tm.campaignId)?.has(norm(tm.term))) continue
    if ((existingNegatives[tm.campaignId] ?? []).some((n) => blocks(tm.term, { text: n, match: "PHRASE" }))) continue
    const cpa = tm.cost / tm.purchases
    const good = tm.purchases >= ADD_MIN_PURCHASES && (c.cpa == null || cpa <= c.cpa * 1.2)
    // Chiến dịch thương hiệu đã tách lượt tìm chung ra bản "· Chung" → KHÔNG thêm từ khoá chung ngược vào gốc (phá bản tách);
    // đề xuất thêm vào NHÓM CÙNG TÊN ở bản tách. Không tìm được nhóm tương ứng → bỏ.
    if (splitSources.has(tm.campaignId) && !BRAND_INTENTS.includes(intentOf(tm.term, lex))) {
      const tg = splitTargets.get(tm.campaignId), ag = tg?.adGroups.get(tm.adGroupId)
      if (!tg || !ag || kwByCamp.get(tg.campaignId)?.has(norm(tm.term))) continue
      const id = `add_${ag}_${norm(tm.term)}`
      if (ids.has(id)) continue
      ids.add(id)
      out.push({ id, kind: "add_keyword", campaignId: tg.campaignId, campaignName: tg.campaignName, adGroupId: ag, label: t("libgoogle.sc.addLabel", { term: tm.term }),
        why: t("libgoogle.sc.addWhySplit", { n: Math.round(tm.purchases * 10) / 10, cost: vnd(tm.cost), cpa: vnd(cpa), name: c.name }),
        defaultChecked: good, cost: tm.cost, payload: { text: tm.term, match: "EXACT" } })
      continue
    }
    const id = `add_${tm.adGroupId}_${norm(tm.term)}`
    if (ids.has(id)) continue
    ids.add(id)
    out.push({ id, kind: "add_keyword", campaignId: c.id, campaignName: c.name, adGroupId: tm.adGroupId, label: t("libgoogle.sc.addLabel", { term: tm.term }),
      why: t("libgoogle.sc.addWhy", { n: Math.round(tm.purchases * 10) / 10, cost: vnd(tm.cost), cpa: vnd(cpa), vs: c.cpa ? t("libgoogle.sc.addWhyVs", { cpa: vnd(c.cpa) }) : "" }),
      defaultChecked: good, cost: tm.cost, payload: { text: tm.term, match: "EXACT" } })
  }
  // 2. Từ khoá đốt tiền: chi ≥ 3× CPA chiến dịch (≥ ₫300k), 0 chuyển đổi nào. Không đụng từ khoá thương hiệu, và không đụng từ
  //    khoá mà CHÍNH lượt tìm đó đang ra đơn ở nơi khác (đo 29/09: vừa gợi ý thêm [mua ten mien] vừa gợi ý tạm dừng nó).
  const convertingTerms = new Set(x.terms.filter((tm) => tm.purchases > 0).map((tm) => norm(tm.term)))
  for (const k of x.keywords) {
    if (convertingTerms.has(norm(k.text))) continue
    const c = camps.get(k.campaignId)
    if (!c || k.purchases > 0 || k.conversions > 0) continue
    const cpa = c.cpa ?? accCpa
    if (!cpa || k.cost < Math.max(PAUSE_CPA_X * cpa, PAUSE_MIN_COST)) continue
    if (BRAND_INTENTS.includes(intentOf(k.text, lex))) continue
    out.push({ id: `pause_${k.criterion}`, kind: "pause_keyword", campaignId: c.id, campaignName: c.name, adGroupId: k.adGroupId, label: t("libgoogle.sc.pauseLabel", { text: k.text, match: k.match }),
      why: t("libgoogle.sc.pauseWhy", { cost: vnd(k.cost), x: (k.cost / cpa).toFixed(1) }), defaultChecked: false, cost: k.cost,
      warning: t("libgoogle.sc.pauseWarn"), payload: { criterion: k.criterion } })
  }
  // 3. Phủ định tên đối thủ / hỏi cách làm có bấm mà 0 chuyển đổi — không chặn nhầm lượt tìm đã ra đơn.
  const converting = x.terms.filter((tm) => tm.conversions > 0).map((tm) => tm.term)
  for (const tm of x.terms) {
    const c = camps.get(tm.campaignId)
    const it = intentOf(tm.term, lex)
    if (!c || !NEG_INTENTS.has(it) || tm.conversions > 0 || tm.clicks < 2) continue
    const text = tm.term.toLowerCase().trim()
    if ((existingNegatives[c.id] ?? []).includes(norm(text))) continue
    const neg: NegativeKw = { text, match: "PHRASE" }
    const hit = converting.filter((ct) => withAccentVariants([neg]).some((n) => blocks(ct, n)))
    if (hit.length) continue
    if (out.some((p) => p.kind === "neg_keyword" && p.campaignId === c.id && p.payload.text === text)) continue
    out.push({ id: `neg_${c.id}_${norm(text)}`, kind: "neg_keyword", campaignId: c.id, campaignName: c.name, label: t("libgoogle.sc.negLabel", { text }),
      why: t("libgoogle.sc.negWhy", { kind: it === "competitor" ? t("libgoogle.sc.negKindComp") : t("libgoogle.sc.negKindInfo"), clicks: tm.clicks, cost: vnd(tm.cost) }), defaultChecked: it === "competitor", cost: tm.cost, payload: { text, match: "PHRASE" } })
  }
  return out
}

export async function readSearchNegatives(company: Company): Promise<Record<string, string[]>> {
  const c = getGoogleAdsCustomer(company)
  const rows = (await c.query(`SELECT campaign.id, campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED' AND campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`)) as Row[]
  const m: Record<string, string[]> = {}
  for (const r of rows) (m[String(r.campaign.id)] ??= []).push(norm(String(r.campaign_criterion.keyword?.text ?? "")))
  return m
}

// ── Ghi ──
const FILE = path.join(process.cwd(), "data", "search-controls.json")
export interface SearchExecution {
  id: string; company: Company; at: string; by: string; mode: "validate" | "write"; status: "done" | "failed"
  applied: { proposalId: string; label: string; kind: SearchControlKind; resourceName?: string }[]
  errors: string[]; readback: { label: string; ok: boolean }[]; undoneAt?: string; undoReport?: string[]
}
function readLog(): SearchExecution[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SearchExecution[] } catch { return [] } }
function writeLog(l: SearchExecution[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-300), null, 1)) }
export const listSearchExecutions = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 30)
/** Đợt 15b: toàn bộ nhật ký (luồng ghi chung đo lại 7/14 ngày). */
export const allSearchExecutions = () => readLog()
export const MAX_SEARCH_OPS = 200

export async function runSearchControls(input: { company: Company; proposals: SearchProposal[]; ids: string[]; actor: string; validateOnly: boolean; confirmText?: string }, t: TFunction = viT): Promise<SearchExecution> {
  const sel = input.proposals.filter((p) => input.ids.includes(p.id))
  if (!sel.length) throw new PmaxControlError(t("libgoogle.sc.errNone"))
  if (sel.length > MAX_SEARCH_OPS) throw new PmaxControlError(t("libgoogle.sc.errMax", { max: MAX_SEARCH_OPS }))
  if (!input.validateOnly && input.confirmText?.trim() !== SEARCH_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sc.errConfirm", { text: SEARCH_CONFIRM_TEXT }))
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  const exec: SearchExecution = { id: `srch_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, mode: input.validateOnly ? "validate" : "write", status: "failed", applied: [], errors: [], readback: [] }
  const adds = sel.filter((p) => p.kind === "add_keyword")
  const pauses = sel.filter((p) => p.kind === "pause_keyword")
  const negs = sel.filter((p) => p.kind === "neg_keyword").flatMap((p) => withAccentVariants([{ text: p.payload.text!, match: "PHRASE" }]).map((n) => ({ p, n })))
  const MT = enums.KeywordMatchType as unknown as Record<string, number>
  const batches = (o: never | undefined) => [
    adds.length ? { label: t("libgoogle.sc.batchAdd"), ps: adds, run: () => c.adGroupCriteria.create(adds.map((p) => ({ ad_group: `customers/${cust}/adGroups/${p.adGroupId}`, status: enums.AdGroupCriterionStatus.ENABLED, keyword: { text: p.payload.text!, match_type: MT[p.payload.match ?? "EXACT"] } })) as never, o) } : null,
    pauses.length ? { label: t("libgoogle.sc.batchPause"), ps: pauses, run: () => c.adGroupCriteria.update(pauses.map((p) => ({ resource_name: p.payload.criterion!, status: enums.AdGroupCriterionStatus.PAUSED })) as never, o) } : null,
    negs.length ? { label: t("libgoogle.sc.batchNeg"), ps: negs.map((x) => x.p), run: () => c.campaignCriteria.create(negs.map(({ p, n }) => ({ campaign: `customers/${cust}/campaigns/${p.campaignId}`, negative: true, keyword: { text: n.text, match_type: MT.PHRASE } })) as never, o) } : null,
  ].filter((b): b is NonNullable<typeof b> => !!b)
  for (const b of batches({ validate_only: true } as never)) { try { await b.run() } catch (e) { exec.errors.push(t("libgoogle.sc.errValidate", { label: b.label, msg: googleAdsErrorMessage(e) })) } }
  if (input.validateOnly) { exec.status = exec.errors.length ? "failed" : "done"; exec.applied = exec.errors.length ? [] : sel.map((p) => ({ proposalId: p.id, label: p.label, kind: p.kind })); return exec }
  if (exec.errors.length) return exec
  return withFileLock(FILE, async () => {
    for (const b of batches(undefined)) {
      try {
        const res = (await b.run()) as { results?: { resource_name?: string }[] }
        b.ps.forEach((p, i) => exec.applied.push({ proposalId: p.id, label: p.label, kind: p.kind, resourceName: p.kind === "pause_keyword" ? p.payload.criterion : res?.results?.[i]?.resource_name }))
      } catch (e) { exec.errors.push(t("libgoogle.sc.errWrite", { label: b.label, msg: googleAdsErrorMessage(e) })) }
    }
    try {
      const names = exec.applied.map((a) => a.resourceName).filter(Boolean)
      const agc = names.filter((n) => n!.includes("/adGroupCriteria/")).map((n) => `'${n}'`)
      const cc = names.filter((n) => n!.includes("/campaignCriteria/")).map((n) => `'${n}'`)
      const state = new Map<string, string>()
      if (agc.length) for (const r of (await c.query(`SELECT ad_group_criterion.resource_name, ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.resource_name IN (${agc.join(",")})`)) as Row[]) state.set(String(r.ad_group_criterion.resource_name), inv(enums.AdGroupCriterionStatus)[r.ad_group_criterion.status])
      if (cc.length) for (const r of (await c.query(`SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign_criterion.resource_name IN (${cc.join(",")})`)) as Row[]) state.set(String(r.campaign_criterion.resource_name), "ENABLED")
      exec.readback = exec.applied.map((a) => ({ label: a.label, ok: !!a.resourceName && state.get(a.resourceName) === (a.kind === "pause_keyword" ? "PAUSED" : "ENABLED") }))
    } catch (e) { exec.errors.push(t("libgoogle.sc.errReadback", { msg: googleAdsErrorMessage(e) })) }
    exec.status = !exec.errors.length && exec.readback.every((r) => r.ok) ? "done" : "failed"
    writeLog([...readLog(), exec])
    return exec
  })
}
const inv = (e: unknown) => Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k])) as Record<number, string>

/** Hoàn tác: gỡ từ khoá/phủ định tool thêm, bật lại từ khoá tool tạm dừng. */
export async function undoSearchControls(company: Company, id: string, actor: string, t: TFunction = viT): Promise<SearchExecution> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === id && e.company === company)
    if (!ex || ex.mode !== "write") throw new PmaxControlError(t("libgoogle.sc.errNoRun"), 404)
    if (ex.undoneAt) throw new PmaxControlError(t("libgoogle.sc.errUndone"), 409)
    const c = getGoogleAdsCustomer(company)
    const report: string[] = []
    const added = ex.applied.filter((a) => a.kind === "add_keyword" && a.resourceName).map((a) => a.resourceName!)
    const negs = ex.applied.filter((a) => a.kind === "neg_keyword" && a.resourceName).map((a) => a.resourceName!)
    const paused = ex.applied.filter((a) => a.kind === "pause_keyword" && a.resourceName).map((a) => a.resourceName!)
    // MỘT lệnh nguyên khối — hỏng một dòng thì không đổi gì, bấm lại được (không có trạng thái nửa vời).
    const ops = [
      ...added.map((r) => ({ entity: "ad_group_criterion", operation: "remove", resource: r })),
      ...negs.map((r) => ({ entity: "campaign_criterion", operation: "remove", resource: r })),
      ...paused.map((r) => ({ entity: "ad_group_criterion", operation: "update", resource: { resource_name: r, status: enums.AdGroupCriterionStatus.ENABLED } })),
    ]
    if (!ops.length) throw new PmaxControlError(t("libgoogle.sc.errNothingUndo"))
    try { await c.mutateResources(ops as never) } catch (e) { throw new PmaxControlError(t("libgoogle.sc.errUndoGoogle", { msg: googleAdsErrorMessage(e) }), 502) }
    if (added.length) report.push(t("libgoogle.sc.undoAdded", { n: added.length }))
    if (negs.length) report.push(t("libgoogle.sc.undoNegs", { n: negs.length }))
    if (paused.length) report.push(t("libgoogle.sc.undoPaused", { n: paused.length }))
    ex.undoneAt = new Date().toISOString(); ex.undoReport = [`${actor}: ${report.join(", ")}`]
    writeLog(log)
    return ex
  })
}
