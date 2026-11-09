// ============================================================
// Đợt 10d — A5 sức khoẻ asset PMax + E2 thay asset chữ yếu (Gemini viết bản tiếng Việt → kiểm luật → thay 1-1)
// ============================================================
// Google bỏ nhãn chất lượng asset (performance_label) → tool tự chấm từ số theo asset (asset_group_asset có
// impressions/clicks/cost/conversions — đo 28/09) + tổ hợp thắng (asset_group_top_combination_view) + ad strength.
// Đơn theo asset GỒM cả đơn sau lượt xem (Google không cho tách) → chấm asset CHỮ theo tỉ lệ bấm (CTR) là chính.
// Thay asset: MỘT lệnh nguyên khối/lần (tạo asset chữ mới → gắn vào asset group → gỡ liên kết cũ); đo 28/09 validate_only
// QUA. Số lượng mỗi loại giữ nguyên (1 đổi 1) nên không vi phạm tối thiểu/tối đa. Hoàn tác = gắn lại asset cũ + gỡ asset mới.

import { brandPromptBlock } from "@/lib/brand/types"
import { brandOverride } from "@/lib/brand/store"
import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { callGemini, extractJSON } from "@/lib/gemini"
import { checkAdTextPolicy, type PolicyFinding } from "@/lib/google-ads-policy"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "./controls"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, nfOf, tk } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k]))
const FT = inv(enums.AssetFieldType as unknown as Record<string, unknown>)
const AS = inv(enums.AdStrength as unknown as Record<string, unknown>)
const AGPS = inv(enums.AssetGroupPrimaryStatus as unknown as Record<string, unknown>)
const AGPSR = inv(enums.AssetGroupPrimaryStatusReason as unknown as Record<string, unknown>)
const APPROVAL = inv(enums.PolicyApprovalStatus as unknown as Record<string, unknown>)
const name = (m: Record<number, string>, v: unknown) => (typeof v === "number" ? m[v] ?? String(v) : String(v ?? ""))
const PM = "campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED'"

export const TEXT_TYPES = ["HEADLINE", "LONG_HEADLINE", "DESCRIPTION"] as const
export type TextType = (typeof TEXT_TYPES)[number]
export const TEXT_LIMIT: Record<TextType, number> = { HEADLINE: 30, LONG_HEADLINE: 90, DESCRIPTION: 90 }
export const FIELD_LABEL: Record<string, string> = {
  HEADLINE: "Tiêu đề", LONG_HEADLINE: "Tiêu đề dài", DESCRIPTION: "Mô tả", BUSINESS_NAME: "Tên doanh nghiệp", LOGO: "Logo", LANDSCAPE_LOGO: "Logo ngang",
  MARKETING_IMAGE: "Ảnh ngang", SQUARE_MARKETING_IMAGE: "Ảnh vuông", PORTRAIT_MARKETING_IMAGE: "Ảnh dọc", TALL_PORTRAIT_MARKETING_IMAGE: "Ảnh dọc cao", YOUTUBE_VIDEO: "Video YouTube",
}
export const fieldLabelT = (f: string, t: TFunction = viT): string => { const k = `libgoogle.pa.fl.${f}`; const v = tk(t, k); return v === k ? f : v }
/** Tối thiểu / khuyên dùng theo hướng dẫn PMax (09/2026). Logo + tên DN có thể ở cấp chiến dịch (nguyên tắc thương hiệu). */
export const REQUIRE: { field: string; min: number; recommended: number; brand?: boolean }[] = [
  { field: "HEADLINE", min: 3, recommended: 11 }, { field: "LONG_HEADLINE", min: 1, recommended: 4 }, { field: "DESCRIPTION", min: 2, recommended: 4 },
  { field: "MARKETING_IMAGE", min: 1, recommended: 4 }, { field: "SQUARE_MARKETING_IMAGE", min: 1, recommended: 4 }, { field: "PORTRAIT_MARKETING_IMAGE", min: 0, recommended: 1 },
  { field: "LOGO", min: 1, recommended: 1, brand: true }, { field: "BUSINESS_NAME", min: 1, recommended: 1, brand: true }, { field: "YOUTUBE_VIDEO", min: 0, recommended: 1 },
]
export const WEAK_CTR_X = 0.6
export const WEAK_MIN_IMPR = 1000
export const WEAK_MIN_SHARE = 0.03

export interface AssetRow {
  link: string; asset: string; assetId: string; field: string; text: string | null; label: string
  approval: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number | null; inTop: boolean
}
export interface GroupHealth {
  campaignId: string; campaignName: string; id: string; resourceName: string; name: string; finalUrls: string[]
  adStrength: string; status: string; statusReasons: string[]
  counts: Record<string, number>
  missing: { field: string; label: string; have: number; need: number; required: boolean }[]
  disapproved: AssetRow[]
  weak: (AssetRow & { why: string })[]
  assets: AssetRow[]
}

/** Chấm một asset group — HÀM THUẦN. */
export function assessGroup(g: Omit<GroupHealth, "missing" | "disapproved" | "weak" | "counts">, brandAtCampaign: Set<string>, t: TFunction = viT): GroupHealth {
  const counts: Record<string, number> = {}
  for (const a of g.assets) counts[a.field] = (counts[a.field] ?? 0) + 1
  const missing = REQUIRE.flatMap((r) => {
    const have = (counts[r.field] ?? 0) + (r.field === "LOGO" ? counts.LANDSCAPE_LOGO ?? 0 : 0)
    if (r.brand && brandAtCampaign.has(r.field)) return []
    if (have >= r.recommended) return []
    return [{ field: r.field, label: fieldLabelT(r.field, t), have, need: have < r.min ? r.min : r.recommended, required: have < r.min }]
  })
  const disapproved = g.assets.filter((a) => a.approval === "DISAPPROVED" || a.approval === "AREA_OF_INTEREST_ONLY" || a.approval === "APPROVED_LIMITED")
  const weak: GroupHealth["weak"] = []
  for (const tt of TEXT_TYPES) {
    const xs = g.assets.filter((a) => a.field === tt && a.impressions > 0)
    const total = xs.reduce((s, a) => s + a.impressions, 0)
    const rated = xs.filter((a) => a.impressions >= WEAK_MIN_IMPR)
    if (rated.length < 3) continue
    const ctrs = rated.map((a) => a.clicks / a.impressions).sort((a, b) => a - b)
    const med = ctrs[Math.floor(ctrs.length / 2)]
    for (const a of rated) {
      const ctr = a.clicks / a.impressions
      if (a.inTop || ctr >= WEAK_CTR_X * med || a.impressions < WEAK_MIN_SHARE * total) continue
      weak.push({ ...a, why: t("libgoogle.pa.weakWhy", { kind: fieldLabelT(tt, t), impr: a.impressions.toLocaleString(nfOf(t)), ctr: (ctr * 100).toFixed(2), x: Math.round(WEAK_CTR_X * 100), med: (med * 100).toFixed(2) }) })
    }
  }
  weak.sort((a, b) => b.impressions - a.impressions)
  return { ...g, counts, missing, disapproved, weak }
}

export async function readAssetHealth(company: Company, range: { from: string; to: string }, t: TFunction = viT): Promise<{ groups: GroupHealth[]; errors: string[] }> {
  const c = getGoogleAdsCustomer(company)
  const errors: string[] = []
  const q = async (label: string, g: string): Promise<Row[]> => { try { return (await c.query(g)) as Row[] } catch (e) { errors.push(`${label}: ${googleAdsErrorMessage(e)}`); return [] } }
  const between = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const [groups, links, mets, tops, brand] = await Promise.all([
    q("asset group", `SELECT campaign.id, campaign.name, asset_group.id, asset_group.resource_name, asset_group.name, asset_group.ad_strength, asset_group.primary_status, asset_group.primary_status_reasons, asset_group.final_urls FROM asset_group WHERE ${PM} AND asset_group.status = 'ENABLED'`),
    q("asset", `SELECT asset_group.id, asset_group_asset.resource_name, asset_group_asset.field_type, asset_group_asset.policy_summary.approval_status, asset.id, asset.resource_name, asset.type, asset.name, asset.text_asset.text, asset.youtube_video_asset.youtube_video_title FROM asset_group_asset WHERE ${PM} AND asset_group.status = 'ENABLED' AND asset_group_asset.status = 'ENABLED'`),
    q("số theo asset", `SELECT asset_group.id, asset.id, asset_group_asset.field_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM asset_group_asset WHERE ${PM} AND asset_group_asset.status = 'ENABLED' AND ${between}`),
    q("tổ hợp thắng", `SELECT asset_group.id, asset_group_top_combination_view.asset_group_top_combinations FROM asset_group_top_combination_view WHERE ${PM}`),
    q("thương hiệu cấp chiến dịch", `SELECT campaign.id, campaign.advertising_channel_type, campaign.status, campaign_asset.field_type FROM campaign_asset WHERE ${PM} AND campaign_asset.status = 'ENABLED' AND campaign_asset.field_type IN ('LOGO', 'BUSINESS_NAME', 'LANDSCAPE_LOGO')`),
  ])
  const m = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>()
  for (const r of mets) {
    const k = `${r.asset_group.id}|${r.asset.id}|${name(FT, r.asset_group_asset.field_type)}`
    const x = m.get(k) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    x.impressions += Number(r.metrics.impressions) || 0; x.clicks += Number(r.metrics.clicks) || 0; x.cost += (Number(r.metrics.cost_micros) || 0) / 1e6; x.conversions += Number(r.metrics.conversions) || 0
    m.set(k, x)
  }
  const top = new Map<string, Set<string>>()
  for (const r of tops) {
    const s = top.get(String(r.asset_group.id)) ?? new Set<string>()
    for (const comb of (r.asset_group_top_combination_view?.asset_group_top_combinations ?? []) as Row[]) for (const a of (comb.asset_combination_served_assets ?? []) as Row[]) s.add(String(a.asset ?? "").split("/").pop()!)
    top.set(String(r.asset_group.id), s)
  }
  const brandBy = new Map<string, Set<string>>()
  for (const r of brand) { const s = brandBy.get(String(r.campaign.id)) ?? new Set<string>(); const f = name(FT, r.campaign_asset.field_type); s.add(f === "LANDSCAPE_LOGO" ? "LOGO" : f); brandBy.set(String(r.campaign.id), s) }
  const out = groups.map((g) => {
    const gid = String(g.asset_group.id)
    const assets: AssetRow[] = links.filter((l) => String(l.asset_group.id) === gid).map((l) => {
      const field = name(FT, l.asset_group_asset.field_type)
      const mm = m.get(`${gid}|${l.asset.id}|${field}`) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
      const text = l.asset.text_asset?.text ? String(l.asset.text_asset.text) : null
      return { link: String(l.asset_group_asset.resource_name), asset: String(l.asset.resource_name), assetId: String(l.asset.id), field, text,
        label: text ?? String(l.asset.youtube_video_asset?.youtube_video_title || l.asset.name || `#${l.asset.id}`),
        approval: name(APPROVAL, l.asset_group_asset.policy_summary?.approval_status), ...mm, cost: Math.round(mm.cost),
        ctr: mm.impressions ? mm.clicks / mm.impressions : null, inTop: top.get(gid)?.has(String(l.asset.id)) ?? false }
    })
    return assessGroup({ campaignId: String(g.campaign.id), campaignName: String(g.campaign.name), id: gid, resourceName: String(g.asset_group.resource_name), name: String(g.asset_group.name),
      finalUrls: (g.asset_group.final_urls ?? []).map(String), adStrength: name(AS, g.asset_group.ad_strength), status: name(AGPS, g.asset_group.primary_status),
      statusReasons: ((g.asset_group.primary_status_reasons ?? []) as unknown[]).map((v) => name(AGPSR, v)), assets }, brandBy.get(String(g.campaign.id)) ?? new Set(), t)
  })
  return { groups: out, errors }
}

// ── E2: bản thay do Gemini viết ──

export interface Replacement { link: string; field: TextType; oldText: string; options: { text: string; findings: PolicyFinding[] }[]; rejected: string[] }

/** Kiểm một phương án: độ dài, trùng chữ đang có, luật Google máy kiểm được. HÀM THUẦN. */
export function vetOption(text: string, field: TextType, existing: string[], tr: TFunction = viT): { ok: boolean; reason?: string; findings: PolicyFinding[] } {
  const t = text.trim().replace(/\s+/g, " ")
  if (!t) return { ok: false, reason: tr("libgoogle.pa.reasonEmpty"), findings: [] }
  if ([...t].length > TEXT_LIMIT[field]) return { ok: false, reason: tr("libgoogle.pa.reasonLong", { n: [...t].length, max: TEXT_LIMIT[field] }), findings: [] }
  const k = stripDiacritics(t)
  if (existing.some((e) => stripDiacritics(e) === k)) return { ok: false, reason: tr("libgoogle.pa.reasonDup"), findings: [] }
  const r = checkAdTextPolicy(field === "DESCRIPTION" ? { headlines: [], descriptions: [t] } : { headlines: [t], descriptions: [] })
  if (r.findings.some((f) => f.severity === "block")) return { ok: false, reason: r.findings.filter((f) => f.severity === "block").map((f) => f.rule).join(", "), findings: r.findings }
  return { ok: true, findings: r.findings }
}

export async function draftReplacements(company: Company, groupId: string, links: string[], range: { from: string; to: string }, t: TFunction = viT): Promise<{ group: string; items: Replacement[] }> {
  const { groups } = await readAssetHealth(company, range, t)
  const g = groups.find((x) => x.id === groupId)
  if (!g) throw new PmaxControlError(t("libgoogle.pa.errNoGroup"), 404)
  const targets = g.assets.filter((a) => links.includes(a.link) && (TEXT_TYPES as readonly string[]).includes(a.field) && a.text)
  if (!targets.length) throw new PmaxControlError(t("libgoogle.pa.errNoText"))
  if (targets.length > 10) throw new PmaxControlError(t("libgoogle.pa.errMax10"))
  const strong = (f: string) => g.assets.filter((a) => a.field === f && a.text && a.ctr != null && a.impressions >= WEAK_MIN_IMPR).sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0)).slice(0, 5).map((a) => a.text)
  const existing = g.assets.filter((a) => a.text).map((a) => a.text!)
  const r = await geminiRewrite({ company, kind: "Performance Max", context: `Asset group: "${g.name}" — trang đích: ${g.finalUrls[0] ?? "(không rõ)"}`,
    strong: { HEADLINE: strong("HEADLINE"), LONG_HEADLINE: strong("LONG_HEADLINE"), DESCRIPTION: strong("DESCRIPTION") } as Record<TextType, string[]>,
    targets: targets.map((a) => ({ field: a.field as TextType, text: a.text! })), existing, t })
  const items: Replacement[] = targets.map((a, idx) => ({ link: a.link, field: a.field as TextType, oldText: a.text!, ...r[idx] }))
  return { group: g.name, items }
}

/** Gemini viết 3 phương án/dòng theo giọng các dòng đang được bấm nhiều → kiểm độ dài, trùng, luật. Dùng chung PMax + Search RSA. */
export async function geminiRewrite(input: { company: Company; kind: string; context: string; strong: Partial<Record<TextType, string[]>>; targets: { field: TextType; text: string }[]; existing: string[]; t?: TFunction }): Promise<{ options: { text: string; findings: PolicyFinding[] }[]; rejected: string[] }[]> {
  const L: Record<TextType, string> = { HEADLINE: "Tiêu đề", LONG_HEADLINE: "Tiêu đề dài", DESCRIPTION: "Mô tả" }
  // Đợt 21 A3: hồ sơ doanh nghiệp (null = MBC/MBI chưa lưu hồ sơ → chuỗi cũ y nguyên).
  const bp = brandOverride(input.company)
  const prompt = `Bạn viết quảng cáo Google ${input.kind} bằng tiếng Việt cho ${bp ? `${bp.brandName}${bp.industry ? ` (${bp.industry})` : ""}` : input.company === "MBC" ? "Mắt Bão (tên miền, hosting, email, máy chủ, Microsoft 365, Google Workspace)" : "Mắt Bão Invoice (hoá đơn điện tử, hợp đồng điện tử, chữ ký số cho doanh nghiệp)"}.
${bp && brandPromptBlock(bp) ? `${brandPromptBlock(bp)}\n` : ""}${input.context}.
Các dòng đang được bấm nhiều nhất (học giọng văn, KHÔNG chép lại):
${(Object.keys(input.strong) as TextType[]).filter((f) => input.strong[f]?.length).map((f) => `- ${L[f]}: ${input.strong[f]!.join(" | ")}`).join("\n") || "(chưa có)"}
Viết 3 phương án THAY cho từng dòng yếu dưới đây. Luật: đúng giới hạn ký tự (tính cả dấu cách), tiếng Việt có dấu chuẩn, không viết hoa toàn bộ, không "!!", không số điện thoại, không hứa hẹn tuyệt đối ("số 1", "rẻ nhất", "100%") trừ khi có trong dòng đang chạy, không trùng các dòng đang có, nêu lợi ích cụ thể.
${input.targets.map((a, i) => `${i + 1}. [${a.field}, tối đa ${TEXT_LIMIT[a.field]} ký tự] "${a.text}"`).join("\n")}
Trả JSON: {"items":[{"i":1,"options":["...","...","..."]}]}`
  const res = await callGemini(prompt, { temperature: 0.7, maxOutputTokens: 1500, responseMimeType: "application/json", thinkingBudget: 0, timeoutMs: 30000 })
  const j = extractJSON(res.text) as { items?: { i?: number; options?: unknown[] }[] } | null
  return input.targets.map((a, idx) => {
    const raw = (j?.items ?? []).find((x) => Number(x.i) === idx + 1)?.options ?? []
    const options: { text: string; findings: PolicyFinding[] }[] = [], rejected: string[] = []
    for (const o of raw) {
      const t = String(o ?? "").trim().replace(/\s+/g, " ")
      const v = vetOption(t, a.field, [...input.existing, ...options.map((x) => x.text)], input.t ?? viT)
      if (v.ok) options.push({ text: t, findings: v.findings }); else if (t) rejected.push(`"${t}" — ${v.reason}`)
    }
    return { options, rejected }
  })
}

// ── E2: áp dụng thay + hoàn tác ──

const FILE = path.join(process.cwd(), "data", "pmax-asset-swaps.json")
export interface SwapItem { assetGroup: string; field: TextType; oldLink: string; oldAsset: string; oldText: string; newText: string; newAsset?: string; newLink?: string }
export interface SwapExecution { id: string; company: Company; at: string; by: string; mode: "validate" | "write"; status: "done" | "failed"; items: SwapItem[]; errors: string[]; readback: { label: string; ok: boolean }[]; undoneAt?: string; undoReport?: string[] }
function readLog(): SwapExecution[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SwapExecution[] } catch { return [] } }
function writeLog(l: SwapExecution[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-300), null, 1)) }
export const listSwaps = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 30)

export async function applySwaps(input: { company: Company; swaps: { link: string; newText: string }[]; actor: string; validateOnly: boolean; confirmText?: string }, t: TFunction = viT): Promise<SwapExecution> {
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sc.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  if (!input.swaps.length || input.swaps.length > 20) throw new PmaxControlError(t("libgoogle.pa.errRange"))
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  // Đọc lại liên kết TƯƠI từ Google (không tin client): còn bật, đúng loại chữ, đúng tài khoản.
  const names = input.swaps.map((s) => `'${s.link.replace(/'/g, "")}'`).join(",")
  const rows = (await c.query(`SELECT asset_group_asset.resource_name, asset_group_asset.asset_group, asset_group_asset.field_type, asset_group_asset.status, asset.resource_name, asset.text_asset.text FROM asset_group_asset WHERE asset_group_asset.resource_name IN (${names})`)) as Row[]
  const exec: SwapExecution = { id: `pmaxas_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, mode: input.validateOnly ? "validate" : "write", status: "failed", items: [], errors: [], readback: [] }
  for (const s of input.swaps) {
    const r = rows.find((x) => x.asset_group_asset.resource_name === s.link)
    const field = r ? name(FT, r.asset_group_asset.field_type) : ""
    if (!r || name(inv(enums.AssetLinkStatus as unknown as Record<string, unknown>), r.asset_group_asset.status) !== "ENABLED") { exec.errors.push(t("libgoogle.pa.errLinkOff", { id: String(s.link.split("/").pop()) })); continue }
    if (!(TEXT_TYPES as readonly string[]).includes(field)) { exec.errors.push(t("libgoogle.pa.errTextOnly", { id: String(s.link.split("/").pop()) })); continue }
    const v = vetOption(s.newText, field as TextType, [], t)
    if (!v.ok) { exec.errors.push(`"${s.newText}": ${v.reason}`); continue }
    exec.items.push({ assetGroup: String(r.asset_group_asset.asset_group), field: field as TextType, oldLink: s.link, oldAsset: String(r.asset.resource_name), oldText: String(r.asset.text_asset?.text ?? ""), newText: s.newText.trim().replace(/\s+/g, " ") })
  }
  if (exec.errors.length) return exec
  const ops = exec.items.flatMap((it, i) => [
    { entity: "asset", operation: "create", resource: { resource_name: `customers/${cust}/assets/${-(i + 1)}`, text_asset: { text: it.newText } } },
    { entity: "asset_group_asset", operation: "create", resource: { asset_group: it.assetGroup, asset: `customers/${cust}/assets/${-(i + 1)}`, field_type: (enums.AssetFieldType as unknown as Record<string, number>)[it.field] } },
    { entity: "asset_group_asset", operation: "remove", resource: it.oldLink },
  ])
  try { await c.mutateResources(ops as never, { validate_only: true } as never) } catch (e) { exec.errors.push(t("libgoogle.pa.errValidate", { msg: googleAdsErrorMessage(e) })); return exec }
  if (input.validateOnly) { exec.status = "done"; return exec }
  return withFileLock(FILE, async () => {
    try {
      const res = (await c.mutateResources(ops as never)) as { mutate_operation_responses?: Row[] }
      const resp = res?.mutate_operation_responses ?? []
      exec.items.forEach((it, i) => {
        it.newAsset = resp[i * 3]?.asset_result?.resource_name
        it.newLink = resp[i * 3 + 1]?.asset_group_asset_result?.resource_name
      })
    } catch (e) { exec.errors.push(t("libgoogle.pa.errWrite", { msg: googleAdsErrorMessage(e) })) }
    if (!exec.errors.length) {
      try {
        const agNames = [...new Set(exec.items.map((i) => `'${i.assetGroup}'`))].join(",")
        const now = (await c.query(`SELECT asset_group_asset.resource_name, asset_group_asset.status, asset.text_asset.text FROM asset_group_asset WHERE asset_group_asset.asset_group IN (${agNames}) AND asset_group_asset.status = 'ENABLED'`)) as Row[]
        const live = new Set(now.map((r) => String(r.asset_group_asset.resource_name)))
        exec.readback = exec.items.map((it) => ({ label: `“${it.oldText}” → “${it.newText}”`, ok: !live.has(it.oldLink) && !!it.newLink && live.has(it.newLink) }))
      } catch (e) { exec.errors.push(t("libgoogle.sc.errReadback", { msg: googleAdsErrorMessage(e) })) }
    }
    exec.status = !exec.errors.length && exec.readback.every((r) => r.ok) ? "done" : "failed"
    writeLog([...readLog(), exec])
    return exec
  })
}

/** Hoàn tác: gắn lại asset cũ (asset vẫn còn trong tài khoản) + gỡ asset mới — một lệnh. */
export async function undoSwaps(company: Company, id: string, actor: string, t: TFunction = viT): Promise<SwapExecution> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === id && e.company === company)
    if (!ex || ex.mode !== "write") throw new PmaxControlError(t("libgoogle.pa.errNoSwap"), 404)
    if (ex.undoneAt) throw new PmaxControlError(t("libgoogle.rsa.errUndone"), 409)
    const c = getGoogleAdsCustomer(company)
    const items = ex.items.filter((i) => i.newLink)
    const ops = items.flatMap((it) => [
      { entity: "asset_group_asset", operation: "remove", resource: it.newLink },
      { entity: "asset_group_asset", operation: "create", resource: { asset_group: it.assetGroup, asset: it.oldAsset, field_type: (enums.AssetFieldType as unknown as Record<string, number>)[it.field] } },
    ])
    if (!ops.length) throw new PmaxControlError(t("libgoogle.sc.errNothingUndo"))
    try { await c.mutateResources(ops as never) } catch (e) { throw new PmaxControlError(t("libgoogle.pa.errUndoGoogle", { msg: googleAdsErrorMessage(e) }), 502) }
    ex.undoneAt = new Date().toISOString(); ex.undoReport = [t("libgoogle.pa.undoReport", { actor, n: items.length })]
    writeLog(log)
    return ex
  })
}
