// ============================================================
// Đợt 10d (E1) — Search theme theo lượt tìm thắng + asset group mới theo chủ đề (tạo ở trạng thái TẠM DỪNG)
// ============================================================
// Đo 28/09: asset group MBC gần hết đã đủ 50 search theme (trần — thêm nữa Google báo resource_count_limit_exceeded), có
// theme lạc đề ("Trò chơi", "Bất động sản", "Việt Nam" trong nhóm Tên miền). Google không cho số theo từng theme → tool
// coi theme "lạc đề" khi KHÔNG có lượt tìm nào (có bấm) trong 90 ngày của chiến dịch chứa đủ các từ của theme; gợi ý thay
// bằng lượt tìm PMax/Search ĐÃ RA ĐƠN (không phải thương hiệu/đối thủ) + cụm tìm kiếm thắng trong Sổ kinh nghiệm.
// Asset group mới: Gemini viết chữ tiếng Việt → kiểm luật; ảnh/video/logo MƯỢN từ asset group có sẵn cùng chiến dịch; tạo
// TẠM DỪNG trong MỘT lệnh (asset trước → asset group → liên kết → theme; đo 28/09 thứ tự khác bị từ chối). Bật do người dùng.

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
import { intentOf, type IntentLexicon } from "@/lib/case/intent"
import { lexiconFor } from "@/lib/case/targets"
import { stripDiacritics } from "@/lib/case/text"
import { addDays, vnDate } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { readPlaybook } from "@/lib/playbook/store"
import { productGroupOf } from "@/lib/case/product"
import { representativeQuery } from "@/lib/playbook/suggest"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "./controls"
import { vetOption, type TextType } from "./assets"
import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k]))
const FT = inv(enums.AssetFieldType as unknown as Record<string, unknown>)
export const MAX_THEMES = 50
const PM = "campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED'"
const tokens = (s: string) => stripDiacritics(s).replace(/[^a-z0-9 .]/g, " ").split(/\s+/).filter((w) => w.length > 1)

export interface ThemeGroup {
  campaignId: string; campaignName: string; assetGroupId: string; assetGroup: string; name: string
  themes: { text: string; resourceName: string; offTopic: boolean }[]
  suggestions: { text: string; why: string; source: "pmax" | "search" | "playbook" }[]
}

/** HÀM THUẦN: theme lạc đề + gợi ý. terms = lượt tìm (PMax chiến dịch này) có bấm; winners = lượt tìm đã ra đơn (PMax + Search cùng sản phẩm). */
export function planThemes(input: {
  themes: { text: string; resourceName: string }[]
  terms: { term: string; clicks: number }[]
  winners: { term: string; conversions: number; source: "pmax" | "search" }[]
  playbook: string[]
  lex: IntentLexicon
  limit?: number
  tr?: TFunction
}): { themes: ThemeGroup["themes"]; suggestions: ThemeGroup["suggestions"] } {
  // Lạc đề = KHÔNG lượt tìm có bấm nào chứa ≥ một nửa số từ của theme. Đo 28/09: đòi đủ MỌI từ thì "gia hạn microsoft
  // 365" cũng bị coi lạc đề (44/50 theme) — quá tay; nửa số từ vẫn bắt được "Bất động sản", "Trò chơi" trong nhóm Tên miền.
  const termToks = input.terms.filter((t) => t.clicks > 0).map((t) => new Set(tokens(t.term)))
  const themes = input.themes.map((t) => { const tk = tokens(t.text); const need = Math.ceil(tk.length / 2); return { ...t, offTopic: tk.length > 0 && !termToks.some((s) => tk.filter((w) => s.has(w)).length >= need) } })
  const have = new Set(themes.map((t) => stripDiacritics(t.text).trim()))
  const out: ThemeGroup["suggestions"] = []
  const push = (text: string, why: string, source: ThemeGroup["suggestions"][number]["source"]) => {
    const k = stripDiacritics(text).trim()
    if (!k || have.has(k) || text.length > 80) return
    const it = intentOf(text, input.lex)
    if (it === "own_brand" || it === "competitor" || it === "lookup" || it === "own_other") return
    have.add(k); out.push({ text, why, source })
  }
  const tr = input.tr ?? viT
  for (const w of [...input.winners].sort((a, b) => b.conversions - a.conversions)) push(w.term, tr("libgoogle.th.winWhy", { src: w.source === "pmax" ? tr("libgoogle.th.winPmax") : tr("libgoogle.th.winSearch"), n: Math.round(w.conversions * 10) / 10 }), w.source)
  for (const p of input.playbook) push(p, tr("libgoogle.th.playbookWhy"), "playbook")
  return { themes, suggestions: out.slice(0, input.limit ?? 30) }
}

export async function readThemes(company: Company, tr: TFunction = viT): Promise<ThemeGroup[]> {
  const c = getGoogleAdsCustomer(company)
  const to = addDays(vnDate(), -1), from = addDays(to, -89)
  const between = `segments.date BETWEEN '${from}' AND '${to}'`
  const [ags, sig, terms, kws] = await Promise.all([
    c.query(`SELECT campaign.id, campaign.name, asset_group.id, asset_group.resource_name, asset_group.name FROM asset_group WHERE ${PM} AND asset_group.status = 'ENABLED'`) as Promise<Row[]>,
    c.query(`SELECT asset_group.id, asset_group_signal.resource_name, asset_group_signal.search_theme.text FROM asset_group_signal WHERE ${PM}`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, campaign_search_term_view.search_term, metrics.clicks, metrics.conversions FROM campaign_search_term_view WHERE ${PM} AND ${between} AND metrics.clicks > 0`) as Promise<Row[]>,
    c.query(`SELECT ad_group_criterion.keyword.text, campaign.name, metrics.conversions FROM keyword_view WHERE campaign.advertising_channel_type = 'SEARCH' AND ${between} AND metrics.conversions > 0`).catch(() => []) as Promise<Row[]>,
  ])
  const lex = lexiconFor(company)
  const pb = readPlaybook(company).entries.filter((e) => e.platform === "google" && e.kind === "search_theme" && (e.status === "auto" || e.status === "approved" || e.status === "suggested") && e.direction === "use")
  return ags.map((g) => {
    const cid = String(g.campaign.id)
    const camTerms = terms.filter((t) => String(t.campaign.id) === cid).map((t) => ({ term: String(t.campaign_search_term_view.search_term), clicks: Number(t.metrics.clicks) || 0, conversions: Number(t.metrics.conversions) || 0 }))
    // Search: chỉ từ khoá của chiến dịch CÙNG NHÓM SẢN PHẨM (đo 28/09: khớp theo từ trong tên thì "hoá đơn điện tử" lọt vào
    // asset group Nhân sự, "vibe host" lọt vào Cloud Hosting).
    const nameToks = new Set(tokens(`${g.asset_group.name} ${g.campaign.name}`).filter((w) => !["pmax", "mbc", "mbi"].includes(w) && !/^\d/.test(w)))
    const prod = productGroupOf(`${g.campaign.name} ${g.asset_group.name}`)
    const searchWins = kws.map((k) => ({ term: String(k.ad_group_criterion.keyword.text).replace(/[+"[\]]/g, "").trim(), conversions: Number(k.metrics.conversions) || 0, cn: String(k.campaign.name) }))
      .filter((k) => productGroupOf(k.cn) === prod && prod !== productGroupOf(""))
    const plan = planThemes({
      themes: sig.filter((s) => String(s.asset_group.id) === String(g.asset_group.id) && s.asset_group_signal.search_theme?.text).map((s) => ({ text: String(s.asset_group_signal.search_theme.text), resourceName: String(s.asset_group_signal.resource_name) })),
      terms: camTerms, lex, tr,
      winners: [...camTerms.filter((t) => t.conversions >= 1).map((t) => ({ term: t.term, conversions: t.conversions, source: "pmax" as const })), ...searchWins.map((k) => ({ term: k.term, conversions: k.conversions, source: "search" as const }))],
      // Chủ đề trong sổ là chữ KHÔNG dấu ("gia re") → lấy lượt tìm thật có dấu làm theme; không có thì bỏ, không đoán dấu.
      playbook: pb.filter((e) => [...tokens(e.value)].some((w) => nameToks.has(w))).map((e) => representativeQuery(e.value, e.evidence)).filter((x): x is string => !!x),
    })
    return { campaignId: cid, campaignName: String(g.campaign.name), assetGroupId: String(g.asset_group.id), assetGroup: String(g.asset_group.resource_name), name: String(g.asset_group.name), ...plan }
  })
}

// ── Ghi theme + hoàn tác ──

const FILE = path.join(process.cwd(), "data", "pmax-themes.json")
export interface ThemeExecution { id: string; company: Company; at: string; by: string; assetGroup: string; assetGroupName: string; added: { text: string; resourceName?: string }[]; removed: { text: string; resourceName: string }[]; status: "done" | "failed"; errors: string[]; undoneAt?: string }
function readLog(): ThemeExecution[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as ThemeExecution[] } catch { return [] } }
function writeLog(l: ThemeExecution[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-300), null, 1)) }
export const listThemeChanges = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 30)

export async function applyThemes(input: { company: Company; assetGroupId: string; add: string[]; remove: string[]; actor: string; validateOnly: boolean; confirmText?: string }, tr: TFunction = viT): Promise<ThemeExecution> {
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(tr("libgoogle.sc.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  const ag = `customers/${cust}/assetGroups/${Number(input.assetGroupId)}`
  const [g] = (await c.query(`SELECT asset_group.name FROM asset_group WHERE asset_group.resource_name = '${ag}' AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'`)) as Row[]
  if (!g) throw new PmaxControlError(tr("libgoogle.th.errNoGroup"), 404)
  const cur = (await c.query(`SELECT asset_group_signal.resource_name, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group.resource_name = '${ag}'`)) as Row[]
  const curThemes = cur.filter((r) => r.asset_group_signal.search_theme?.text).map((r) => ({ text: String(r.asset_group_signal.search_theme.text), resourceName: String(r.asset_group_signal.resource_name) }))
  const removed = curThemes.filter((t) => input.remove.includes(t.resourceName))
  const haveK = new Set(curThemes.filter((t) => !removed.includes(t)).map((t) => stripDiacritics(t.text).trim()))
  const added: { text: string; resourceName?: string }[] = [...new Set(input.add.map((t) => t.trim().replace(/\s+/g, " ")).filter((t) => t && t.length <= 80))].filter((t) => { const k = stripDiacritics(t); if (haveK.has(k)) return false; haveK.add(k); return true }).map((text) => ({ text }))
  const exec: ThemeExecution = { id: `pmaxth_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, assetGroup: ag, assetGroupName: String(g.asset_group.name), added, removed, status: "failed", errors: [] }
  if (!added.length && !removed.length) { exec.errors.push(tr("libgoogle.th.errNoChange")); return exec }
  if (curThemes.length - removed.length + added.length > MAX_THEMES) { exec.errors.push(tr("libgoogle.th.errCap", { max: MAX_THEMES, cur: curThemes.length, rm: removed.length, add: added.length })); return exec }
  const ops = [
    ...removed.map((t) => ({ entity: "asset_group_signal", operation: "remove", resource: t.resourceName })),
    ...added.map((t) => ({ entity: "asset_group_signal", operation: "create", resource: { asset_group: ag, search_theme: { text: t.text } } })),
  ]
  try { await c.mutateResources(ops as never, { validate_only: true } as never) } catch (e) { exec.errors.push(tr("libgoogle.pa.errValidate", { msg: googleAdsErrorMessage(e) })); return exec }
  if (input.validateOnly) { exec.status = "done"; return exec }
  return withFileLock(FILE, async () => {
    try {
      const res = (await c.mutateResources(ops as never)) as { mutate_operation_responses?: Row[] }
      const resp = res?.mutate_operation_responses ?? []
      added.forEach((t, i) => { t.resourceName = resp[removed.length + i]?.asset_group_signal_result?.resource_name })
      const after = (await c.query(`SELECT asset_group_signal.resource_name, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group.resource_name = '${ag}'`)) as Row[]
      const live = new Set(after.map((r) => stripDiacritics(String(r.asset_group_signal.search_theme?.text ?? ""))))
      const bad = [...added.filter((t) => !live.has(stripDiacritics(t.text))).map((t) => tr("libgoogle.th.badMissing", { text: t.text })), ...removed.filter((t) => live.has(stripDiacritics(t.text))).map((t) => tr("libgoogle.th.badStill", { text: t.text }))]
      if (bad.length) exec.errors.push(tr("libgoogle.th.errReadMismatch", { list: bad.join(", ") }))
    } catch (e) { exec.errors.push(tr("libgoogle.sg.errWrite", { msg: googleAdsErrorMessage(e) })) }
    exec.status = exec.errors.length ? "failed" : "done"
    writeLog([...readLog(), exec])
    return exec
  })
}

export async function undoThemes(company: Company, id: string, tr: TFunction = viT): Promise<ThemeExecution> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === id && e.company === company)
    if (!ex || ex.status !== "done") throw new PmaxControlError(tr("libgoogle.th.errNoThemeChange"), 404)
    if (ex.undoneAt) throw new PmaxControlError(tr("libgoogle.rsa.errUndone"), 409)
    const c = getGoogleAdsCustomer(company)
    const ops = [
      ...ex.added.filter((t) => t.resourceName).map((t) => ({ entity: "asset_group_signal", operation: "remove", resource: t.resourceName })),
      ...ex.removed.map((t) => ({ entity: "asset_group_signal", operation: "create", resource: { asset_group: ex.assetGroup, search_theme: { text: t.text } } })),
    ]
    try { await c.mutateResources(ops as never) } catch (e) { throw new PmaxControlError(tr("libgoogle.pa.errUndoGoogle", { msg: googleAdsErrorMessage(e) }), 502) }
    ex.undoneAt = new Date().toISOString()
    writeLog(log)
    return ex
  })
}

// ── Asset group mới (TẠM DỪNG) ──

export interface AssetGroupDraft {
  campaignId: string; sourceAssetGroupId: string; name: string; finalUrl: string; theme: string
  headlines: string[]; longHeadlines: string[]; descriptions: string[]
  searchThemes: string[]
  media: { field: string; asset: string; label: string }[]
  rejected: string[]
}
const MEDIA_FIELDS = ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE", "TALL_PORTRAIT_MARKETING_IMAGE", "LOGO", "LANDSCAPE_LOGO", "BUSINESS_NAME", "YOUTUBE_VIDEO"]

/** URL mới phải cùng tên miền với asset group nguồn — chặn gõ nhầm / trỏ ra site lạ. HÀM THUẦN. */
export function sameSite(url: string, sourceUrls: string[]): boolean {
  try { const h = new URL(url).hostname.replace(/^www\./, ""); return /^https?:$/.test(new URL(url).protocol) && sourceUrls.some((s) => { try { return new URL(s).hostname.replace(/^www\./, "") === h } catch { return false } }) } catch { return false }
}

export async function draftAssetGroup(company: Company, input: { campaignId: string; sourceAssetGroupId: string; theme: string; finalUrl: string }, tr: TFunction = viT): Promise<AssetGroupDraft> {
  const theme = input.theme.trim().slice(0, 80)
  if (theme.length < 3) throw new PmaxControlError(tr("libgoogle.th.errTopic"))
  const c = getGoogleAdsCustomer(company)
  const [src] = (await c.query(`SELECT asset_group.id, asset_group.name, asset_group.final_urls, campaign.id FROM asset_group WHERE ${PM} AND asset_group.id = ${Number(input.sourceAssetGroupId)} AND campaign.id = ${Number(input.campaignId)}`)) as Row[]
  if (!src) throw new PmaxControlError(tr("libgoogle.th.errNoSource"), 404)
  const srcUrls = (src.asset_group.final_urls ?? []).map(String)
  if (!sameSite(input.finalUrl, srcUrls)) throw new PmaxControlError(tr("libgoogle.th.errSameSite", { url: srcUrls[0] ?? "?" }))
  const links = (await c.query(`SELECT asset_group_asset.field_type, asset.resource_name, asset.name, asset.type, asset.text_asset.text, asset.youtube_video_asset.youtube_video_title FROM asset_group_asset WHERE asset_group.id = ${Number(input.sourceAssetGroupId)} AND asset_group_asset.status = 'ENABLED'`)) as Row[]
  const media = links.filter((l) => MEDIA_FIELDS.includes(FT[l.asset_group_asset.field_type])).map((l) => ({ field: FT[l.asset_group_asset.field_type], asset: String(l.asset.resource_name), label: String(l.asset.text_asset?.text || l.asset.youtube_video_asset?.youtube_video_title || l.asset.name || l.asset.resource_name.split("/").pop()) }))
  const sample = (f: string) => links.filter((l) => FT[l.asset_group_asset.field_type] === f).slice(0, 4).map((l) => l.asset.text_asset?.text).filter(Boolean).join(" | ")
  // Đợt 21 A3: hồ sơ doanh nghiệp (null = MBC/MBI chưa lưu hồ sơ → chuỗi cũ y nguyên).
  const bp = brandOverride(company)
  const prompt = `Viết asset chữ tiếng Việt cho MỘT asset group Google Performance Max mới.
Doanh nghiệp: ${bp ? `${bp.brandName}${bp.industry ? ` — ${bp.industry}` : ""}${brandPromptBlock(bp) ? `\n${brandPromptBlock(bp)}` : ""}` : company === "MBC" ? "Mắt Bão — tên miền, hosting, email, máy chủ, Microsoft 365, Google Workspace" : "Mắt Bão Invoice — hoá đơn điện tử, hợp đồng điện tử, chữ ký số"}.
Chủ đề asset group: "${theme}". Trang đích: ${input.finalUrl}.
Giọng văn tham khảo (asset group "${src.asset_group.name}", KHÔNG chép): tiêu đề: ${sample("HEADLINE")}; mô tả: ${sample("DESCRIPTION")}.
Yêu cầu: 7 tiêu đề (≤ 30 ký tự), 3 tiêu đề dài (≤ 90), 4 mô tả (≤ 90, trong đó ít nhất 1 mô tả ≤ 60), 15 search theme (cụm người mua hay gõ khi tìm đúng chủ đề này, không chứa tên thương hiệu ${bp ? bp.brandName : "Mắt Bão"} hay đối thủ). Tiếng Việt có dấu, nêu lợi ích cụ thể, không viết hoa toàn bộ, không "!!", không số điện thoại, không "số 1"/"rẻ nhất"/"100%".
Trả JSON: {"headlines":[],"longHeadlines":[],"descriptions":[],"searchThemes":[]}`
  const res = await callGemini(prompt, { temperature: 0.7, maxOutputTokens: 2000, responseMimeType: "application/json", thinkingBudget: 0, timeoutMs: 40000 })
  const j = (extractJSON(res.text) ?? {}) as Record<string, unknown>
  const rejected: string[] = []
  const pick = (arr: unknown, field: TextType, max: number) => {
    const ok: string[] = []
    for (const x of Array.isArray(arr) ? arr : []) {
      const t = String(x ?? "").trim().replace(/\s+/g, " ")
      const v = vetOption(t, field, ok, tr)
      if (v.ok && ok.length < max) ok.push(t); else if (t && !v.ok) rejected.push(`"${t}" — ${v.reason}`)
    }
    return ok
  }
  const lex = lexiconFor(company)
  const searchThemes = [...new Set((Array.isArray(j.searchThemes) ? j.searchThemes : []).map((x) => String(x ?? "").trim()).filter((t) => t && t.length <= 80 && !["own_brand", "competitor", "own_other"].includes(intentOf(t, lex))))].slice(0, 25)
  return { campaignId: input.campaignId, sourceAssetGroupId: input.sourceAssetGroupId, name: `${theme} · AdsCommand`.slice(0, 120), finalUrl: input.finalUrl, theme,
    headlines: pick(j.headlines, "HEADLINE", 15), longHeadlines: pick(j.longHeadlines, "LONG_HEADLINE", 5), descriptions: pick(j.descriptions, "DESCRIPTION", 5), searchThemes, media, rejected }
}

/** Kiểm đủ tối thiểu trước khi gửi Google. HÀM THUẦN. */
export function draftProblems(d: Pick<AssetGroupDraft, "headlines" | "longHeadlines" | "descriptions" | "media">, tr: TFunction = viT): string[] {
  const p: string[] = []
  if (d.headlines.length < 3) p.push(tr("libgoogle.th.p.headlines"))
  if (d.longHeadlines.length < 1) p.push(tr("libgoogle.th.p.long"))
  if (d.descriptions.length < 2) p.push(tr("libgoogle.th.p.desc"))
  if (!d.descriptions.some((x) => [...x].length <= 60)) p.push(tr("libgoogle.th.p.desc60"))
  if (!d.media.some((m) => m.field === "MARKETING_IMAGE")) p.push(tr("libgoogle.th.p.landscape"))
  if (!d.media.some((m) => m.field === "SQUARE_MARKETING_IMAGE")) p.push(tr("libgoogle.th.p.square"))
  return p
}

const AG_FILE = path.join(process.cwd(), "data", "pmax-new-asset-groups.json")
export interface NewAssetGroupRecord { id: string; company: Company; at: string; by: string; campaignId: string; name: string; resourceName?: string; status: "done" | "failed"; errors: string[]; enabledAt?: string; removedAt?: string; draft: Omit<AssetGroupDraft, "rejected"> }
function readAg(): NewAssetGroupRecord[] { try { return JSON.parse(fs.readFileSync(AG_FILE, "utf-8")) as NewAssetGroupRecord[] } catch { return [] } }
function writeAg(l: NewAssetGroupRecord[]) { fs.mkdirSync(path.dirname(AG_FILE), { recursive: true }); writeFileAtomicSync(AG_FILE, JSON.stringify(l.slice(-200), null, 1)) }
export const listNewAssetGroups = (co: Company) => readAg().filter((e) => e.company === co).reverse().slice(0, 30)

export async function createAssetGroup(input: { company: Company; draft: Omit<AssetGroupDraft, "rejected">; actor: string; validateOnly: boolean; confirmText?: string }, tr: TFunction = viT): Promise<NewAssetGroupRecord> {
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(tr("libgoogle.th.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  const d = input.draft
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  // Kiểm lại MỌI thứ client gửi: chữ (độ dài, luật), URL cùng site, ảnh đúng là của asset group nguồn.
  const [src] = (await c.query(`SELECT asset_group.final_urls FROM asset_group WHERE ${PM} AND asset_group.id = ${Number(d.sourceAssetGroupId)} AND campaign.id = ${Number(d.campaignId)}`)) as Row[]
  if (!src) throw new PmaxControlError(tr("libgoogle.th.errNoSource2"), 404)
  if (!sameSite(d.finalUrl, (src.asset_group.final_urls ?? []).map(String))) throw new PmaxControlError(tr("libgoogle.th.errSameSite2"))
  const srcMedia = new Set(((await c.query(`SELECT asset.resource_name FROM asset_group_asset WHERE asset_group.id = ${Number(d.sourceAssetGroupId)} AND asset_group_asset.status = 'ENABLED'`)) as Row[]).map((r) => String(r.asset.resource_name)))
  const media = d.media.filter((m) => srcMedia.has(m.asset) && MEDIA_FIELDS.includes(m.field))
  const clean = (xs: string[], f: TextType, max: number) => xs.map((t) => t.trim().replace(/\s+/g, " ")).filter((t, i, a) => vetOption(t, f, a.slice(0, i), tr).ok).slice(0, max)
  const draft = { ...d, headlines: clean(d.headlines, "HEADLINE", 15), longHeadlines: clean(d.longHeadlines, "LONG_HEADLINE", 5), descriptions: clean(d.descriptions, "DESCRIPTION", 5), media, searchThemes: [...new Set(d.searchThemes.map((t) => t.trim()).filter((t) => t && t.length <= 80))].slice(0, MAX_THEMES), name: d.name.trim().slice(0, 120) || "AdsCommand" }
  const rec: NewAssetGroupRecord = { id: `pmaxag_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, campaignId: d.campaignId, name: draft.name, status: "failed", errors: draftProblems(draft, tr), draft }
  if (rec.errors.length) return rec
  const AG = `customers/${cust}/assetGroups/-1`
  let t = -2
  const ops: object[] = [], links: object[] = []
  const fieldNo = (f: string) => (enums.AssetFieldType as unknown as Record<string, number>)[f]
  const text = (s: string, f: TextType) => { const id = `customers/${cust}/assets/${t--}`; ops.push({ entity: "asset", operation: "create", resource: { resource_name: id, text_asset: { text: s } } }); links.push({ entity: "asset_group_asset", operation: "create", resource: { asset_group: AG, asset: id, field_type: fieldNo(f) } }) }
  draft.headlines.forEach((s) => text(s, "HEADLINE")); draft.longHeadlines.forEach((s) => text(s, "LONG_HEADLINE")); draft.descriptions.forEach((s) => text(s, "DESCRIPTION"))
  for (const m of draft.media) links.push({ entity: "asset_group_asset", operation: "create", resource: { asset_group: AG, asset: m.asset, field_type: fieldNo(m.field) } })
  const all = [
    ...ops,
    { entity: "asset_group", operation: "create", resource: { resource_name: AG, campaign: `customers/${cust}/campaigns/${Number(d.campaignId)}`, name: draft.name, status: (enums.AssetGroupStatus as unknown as Record<string, number>).PAUSED, final_urls: [draft.finalUrl] } },
    ...links,
    ...draft.searchThemes.map((s) => ({ entity: "asset_group_signal", operation: "create", resource: { asset_group: AG, search_theme: { text: s } } })),
  ]
  try { await c.mutateResources(all as never, { validate_only: true } as never) } catch (e) { rec.errors.push(tr("libgoogle.th.errValidateCreate", { msg: googleAdsErrorMessage(e) })); return rec }
  if (input.validateOnly) { rec.status = "done"; return rec }
  return withFileLock(AG_FILE, async () => {
    try {
      const res = (await c.mutateResources(all as never)) as { mutate_operation_responses?: Row[] }
      rec.resourceName = res?.mutate_operation_responses?.[ops.length]?.asset_group_result?.resource_name
      const [chk] = rec.resourceName ? (await c.query(`SELECT asset_group.status FROM asset_group WHERE asset_group.resource_name = '${rec.resourceName}'`)) as Row[] : []
      if (!chk) rec.errors.push(tr("libgoogle.th.errReadNone"))
      else if (inv(enums.AssetGroupStatus as unknown as Record<string, unknown>)[chk.asset_group.status] !== "PAUSED") rec.errors.push(tr("libgoogle.th.errNotPaused"))
    } catch (e) { rec.errors.push(tr("libgoogle.th.errCreate", { msg: googleAdsErrorMessage(e) })) }
    rec.status = rec.errors.length ? "failed" : "done"
    writeAg([...readAg(), rec])
    return rec
  })
}

/** Bật / tạm dừng / gỡ asset group DO TOOL TẠO (không đụng asset group khác). */
export async function setAssetGroupState(company: Company, id: string, action: "enable" | "pause" | "remove", actor: string, confirmText?: string, tr: TFunction = viT): Promise<NewAssetGroupRecord> {
  if (confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(tr("libgoogle.sc.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  return withFileLock(AG_FILE, async () => {
    const l = readAg()
    const r = l.find((x) => x.id === id && x.company === company)
    if (!r?.resourceName || r.status !== "done" || r.removedAt) throw new PmaxControlError(tr("libgoogle.th.errNoToolGroup"), 404)
    const c = getGoogleAdsCustomer(company)
    try {
      if (action === "remove") await c.assetGroups.remove([r.resourceName])
      else await c.assetGroups.update([{ resource_name: r.resourceName, status: (enums.AssetGroupStatus as unknown as Record<string, number>)[action === "enable" ? "ENABLED" : "PAUSED"] }] as never)
    } catch (e) { throw new PmaxControlError(tr("libgoogle.th.errGoogle", { msg: googleAdsErrorMessage(e) }), 502) }
    if (action === "remove") r.removedAt = new Date().toISOString()
    else r.enabledAt = action === "enable" ? new Date().toISOString() : undefined
    r.errors = [...r.errors.filter((e) => !e.startsWith("[")), `[${actor} · ${action} · ${new Date().toISOString().slice(0, 16)}]`].slice(-10)
    writeAg(l)
    return r
  })
}
