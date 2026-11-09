// ============================================================
// Đợt 11c — RSA của Search: số theo từng dòng · dòng yếu · Gemini viết bản thay · sửa có Kiểm trước + hoàn tác
// ============================================================
// Google đã bỏ nhãn hiệu suất theo dòng (đo 29/09: mọi dòng trả "7" = không áp dụng) nhưng vẫn cho số theo dòng qua
// ad_group_ad_asset_view (hiển thị, bấm, chuyển đổi) → chấm theo tỉ lệ bấm trong CÙNG quảng cáo (luật như asset PMax).
// Sửa: ads.update responsive_search_ad (validate_only QUA 29/09) — thay đúng dòng, GIỮ vị trí ghim; lưu mảng cũ để hoàn tác.
// Sửa chữ làm quảng cáo được duyệt lại (vài giờ) — ghi rõ ở giao diện. Nút sửa RSA cũ (/toolkit/rsa) ghi thẳng, không hoàn tác.

import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import { PmaxControlError } from "@/lib/pmax/controls"
import { geminiRewrite, vetOption, WEAK_CTR_X, WEAK_MIN_IMPR, WEAK_MIN_SHARE, type TextType } from "@/lib/pmax/assets"
import type { PolicyFinding } from "@/lib/google-ads-policy"
import { SEARCH_CONFIRM_TEXT } from "./controls"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, nfOf } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: unknown) => Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k])) as Record<number, string>
const FT = inv(enums.AssetFieldType), AS = inv(enums.AdStrength), APPROVAL = inv(enums.PolicyApprovalStatus)

export interface RsaLine { field: "HEADLINE" | "DESCRIPTION"; text: string; pinned?: number; impressions: number; clicks: number; conversions: number; ctr: number | null }
export interface RsaAd {
  ad: string; adGroupAd: string; campaignId: string; campaignName: string; adGroup: string; adStrength: string; approval: string; finalUrl: string
  cost: number; impressions: number; lines: RsaLine[]; weak: (RsaLine & { why: string })[]
}

/** Dòng yếu trong MỘT quảng cáo — HÀM THUẦN (cùng ngưỡng với asset PMax). */
export function weakLines(lines: RsaLine[], t: TFunction = viT): (RsaLine & { why: string })[] {
  const out: (RsaLine & { why: string })[] = []
  for (const f of ["HEADLINE", "DESCRIPTION"] as const) {
    const xs = lines.filter((l) => l.field === f && l.impressions > 0)
    const total = xs.reduce((s, l) => s + l.impressions, 0)
    const rated = xs.filter((l) => l.impressions >= WEAK_MIN_IMPR)
    if (rated.length < 3) continue
    const ctrs = rated.map((l) => l.clicks / l.impressions).sort((a, b) => a - b)
    const med = ctrs[Math.floor(ctrs.length / 2)]
    for (const l of rated) {
      const ctr = l.clicks / l.impressions
      if (ctr >= WEAK_CTR_X * med || l.impressions < WEAK_MIN_SHARE * total) continue
      out.push({ ...l, why: t("libgoogle.rsa.weakWhy", { kind: f === "HEADLINE" ? t("libgoogle.rsa.kindHeadline") : t("libgoogle.rsa.kindDesc"), impr: l.impressions.toLocaleString(nfOf(t)), ctr: (ctr * 100).toFixed(2), x: Math.round(WEAK_CTR_X * 100), med: (med * 100).toFixed(2) }) })
    }
  }
  return out.sort((a, b) => b.impressions - a.impressions)
}

export async function readRsa(company: Company, range: { from: string; to: string }, t: TFunction = viT): Promise<{ ads: RsaAd[]; errors: string[] }> {
  const c = getGoogleAdsCustomer(company)
  const errors: string[] = []
  const q = async (label: string, g: string): Promise<Row[]> => { try { return (await c.query(g)) as Row[] } catch (e) { errors.push(`${label}: ${googleAdsErrorMessage(e)}`); return [] } }
  const B = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const S = "campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED'"
  const [ads, lines] = await Promise.all([
    q("quảng cáo", `SELECT campaign.id, campaign.name, ad_group.name, ad_group_ad.resource_name, ad_group_ad.ad.resource_name, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, metrics.cost_micros, metrics.impressions FROM ad_group_ad WHERE ${S} AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' AND ${B}`),
    q("số theo dòng", `SELECT ad_group_ad_asset_view.ad_group_ad, ad_group_ad_asset_view.field_type, asset.text_asset.text, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad_asset_view WHERE ${S} AND ${B}`),
  ])
  const m = new Map<string, { impressions: number; clicks: number; conversions: number }>()
  for (const r of lines) {
    const k = `${r.ad_group_ad_asset_view.ad_group_ad}|${FT[r.ad_group_ad_asset_view.field_type]}|${r.asset?.text_asset?.text}`
    const x = m.get(k) ?? { impressions: 0, clicks: 0, conversions: 0 }
    x.impressions += Number(r.metrics.impressions) || 0; x.clicks += Number(r.metrics.clicks) || 0; x.conversions += Number(r.metrics.conversions) || 0
    m.set(k, x)
  }
  const out = ads.map((r): RsaAd => {
    const aga = String(r.ad_group_ad.resource_name)
    const rsa = r.ad_group_ad.ad.responsive_search_ad ?? {}
    const mk = (f: "HEADLINE" | "DESCRIPTION", xs: Row[] = []): RsaLine[] => xs.map((h) => { const s = m.get(`${aga}|${f}|${h.text}`) ?? { impressions: 0, clicks: 0, conversions: 0 }; return { field: f, text: String(h.text), ...(h.pinned_field ? { pinned: Number(h.pinned_field) } : {}), ...s, ctr: s.impressions ? s.clicks / s.impressions : null } })
    const ls = [...mk("HEADLINE", rsa.headlines), ...mk("DESCRIPTION", rsa.descriptions)]
    return { ad: String(r.ad_group_ad.ad.resource_name), adGroupAd: aga, campaignId: String(r.campaign.id), campaignName: String(r.campaign.name), adGroup: String(r.ad_group.name),
      adStrength: AS[r.ad_group_ad.ad_strength] ?? String(r.ad_group_ad.ad_strength), approval: APPROVAL[r.ad_group_ad.policy_summary?.approval_status] ?? "", finalUrl: String(r.ad_group_ad.ad.final_urls?.[0] ?? ""),
      cost: (Number(r.metrics.cost_micros) || 0) / 1e6, impressions: Number(r.metrics.impressions) || 0, lines: ls, weak: weakLines(ls, t) }
  }).sort((a, b) => b.cost - a.cost)
  return { ads: out, errors }
}

export async function draftRsa(company: Company, ad: string, texts: { field: "HEADLINE" | "DESCRIPTION"; text: string }[], range: { from: string; to: string }, t: TFunction = viT): Promise<{ items: { field: TextType; oldText: string; options: { text: string; findings: PolicyFinding[] }[]; rejected: string[] }[] }> {
  const { ads } = await readRsa(company, range, t)
  const a = ads.find((x) => x.ad === ad)
  if (!a) throw new PmaxControlError(t("libgoogle.rsa.errNoAd"), 404)
  const targets = texts.filter((x) => a.lines.some((l) => l.field === x.field && l.text === x.text)).slice(0, 10)
  if (!targets.length) throw new PmaxControlError(t("libgoogle.rsa.errNoLine"))
  const strong = (f: "HEADLINE" | "DESCRIPTION") => a.lines.filter((l) => l.field === f && l.ctr != null && l.impressions >= WEAK_MIN_IMPR).sort((x, y) => (y.ctr ?? 0) - (x.ctr ?? 0)).slice(0, 5).map((l) => l.text)
  const r = await geminiRewrite({ company, kind: "Search (quảng cáo tìm kiếm thích ứng)", context: `Nhóm quảng cáo "${a.adGroup}" (chiến dịch "${a.campaignName}") — trang đích: ${a.finalUrl || "(không rõ)"}`,
    strong: { HEADLINE: strong("HEADLINE"), DESCRIPTION: strong("DESCRIPTION") }, targets: targets.map((t) => ({ field: t.field, text: t.text })), existing: a.lines.map((l) => l.text) })
  return { items: targets.map((t, i) => ({ field: t.field, oldText: t.text, ...r[i] })) }
}

// ── Sửa + hoàn tác ──
const FILE = path.join(process.cwd(), "data", "search-rsa-edits.json")
type TextAsset = { text: string; pinned_field?: number }
export interface RsaEdit { id: string; company: Company; at: string; by: string; ad: string; label: string; changes: { field: string; oldText: string; newText: string }[]; before: { headlines: TextAsset[]; descriptions: TextAsset[] }; status: "done" | "failed"; errors: string[]; undoneAt?: string }
function readLog(): RsaEdit[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as RsaEdit[] } catch { return [] } }
function writeLog(l: RsaEdit[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-300), null, 1)) }
export const listRsaEdits = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 30)

async function readAd(company: Company, ad: string, tr: TFunction = viT) {
  const [r] = (await getGoogleAdsCustomer(company).query(`SELECT ad_group.name, ad_group_ad.ad.resource_name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.ad.resource_name = '${ad.replace(/'/g, "")}' AND campaign.advertising_channel_type = 'SEARCH'`)) as Row[]
  if (!r) throw new PmaxControlError(tr("libgoogle.rsa.errNoAdSearch"), 404)
  const t = (xs: Row[] = []): TextAsset[] => xs.map((h) => ({ text: String(h.text), ...(h.pinned_field ? { pinned_field: Number(h.pinned_field) } : {}) }))
  return { name: String(r.ad_group.name), headlines: t(r.ad_group_ad.ad.responsive_search_ad?.headlines), descriptions: t(r.ad_group_ad.ad.responsive_search_ad?.descriptions) }
}

/** Thay đúng dòng, GIỮ ghim — HÀM THUẦN. Dòng cũ không còn (người khác đã sửa) → lỗi, không đoán. */
export function applyChanges(cur: { headlines: TextAsset[]; descriptions: TextAsset[] }, changes: { field: string; oldText: string; newText: string }[], t: TFunction = viT): { headlines: TextAsset[]; descriptions: TextAsset[]; errors: string[] } {
  const h = cur.headlines.map((x) => ({ ...x })), d = cur.descriptions.map((x) => ({ ...x })), errors: string[] = []
  for (const ch of changes) {
    const arr = ch.field === "HEADLINE" ? h : d
    const i = arr.findIndex((x) => x.text === ch.oldText)
    if (i < 0) { errors.push(t("libgoogle.rsa.errLineGone", { text: ch.oldText })); continue }
    const v = vetOption(ch.newText, ch.field as TextType, arr.filter((_, j) => j !== i).map((x) => x.text), t)
    if (!v.ok) { errors.push(`"${ch.newText}": ${v.reason}`); continue }
    arr[i] = { ...arr[i], text: ch.newText.trim().replace(/\s+/g, " ") }
  }
  return { headlines: h, descriptions: d, errors }
}

export async function editRsa(input: { company: Company; ad: string; changes: { field: string; oldText: string; newText: string }[]; actor: string; validateOnly: boolean; confirmText?: string }, t: TFunction = viT): Promise<RsaEdit> {
  if (!input.validateOnly && input.confirmText?.trim() !== SEARCH_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sc.errConfirm", { text: SEARCH_CONFIRM_TEXT }))
  if (!input.changes.length || input.changes.length > 10) throw new PmaxControlError(t("libgoogle.rsa.errRange"))
  const c = getGoogleAdsCustomer(input.company)
  const cur = await readAd(input.company, input.ad, t)
  const next = applyChanges(cur, input.changes, t)
  const rec: RsaEdit = { id: `rsa_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, ad: input.ad, label: cur.name, changes: input.changes, before: { headlines: cur.headlines, descriptions: cur.descriptions }, status: "failed", errors: next.errors }
  if (rec.errors.length) return rec
  const op = [{ resource_name: input.ad, responsive_search_ad: { headlines: next.headlines, descriptions: next.descriptions } }]
  try { await c.ads.update(op as never, { validate_only: true } as never) } catch (e) { rec.errors.push(t("libgoogle.rsa.errValidate", { msg: googleAdsErrorMessage(e) })); return rec }
  if (input.validateOnly) { rec.status = "done"; return rec }
  return withFileLock(FILE, async () => {
    try {
      await c.ads.update(op as never)
      const after = await readAd(input.company, input.ad, t)
      const miss = input.changes.filter((ch) => !(ch.field === "HEADLINE" ? after.headlines : after.descriptions).some((x) => x.text === ch.newText.trim().replace(/\s+/g, " ")))
      if (miss.length) rec.errors.push(t("libgoogle.rsa.errReadback", { list: miss.map((m) => m.newText).join(", ") }))
    } catch (e) { rec.errors.push(t("libgoogle.rsa.errEdit", { msg: googleAdsErrorMessage(e) })) }
    rec.status = rec.errors.length ? "failed" : "done"
    writeLog([...readLog(), rec])
    return rec
  })
}

export async function undoRsa(company: Company, id: string, t: TFunction = viT): Promise<RsaEdit> {
  return withFileLock(FILE, async () => {
    const l = readLog()
    const r = l.find((x) => x.id === id && x.company === company)
    if (!r || r.status !== "done") throw new PmaxControlError(t("libgoogle.rsa.errNoEdit"), 404)
    if (r.undoneAt) throw new PmaxControlError(t("libgoogle.rsa.errUndone"), 409)
    try { await getGoogleAdsCustomer(company).ads.update([{ resource_name: r.ad, responsive_search_ad: r.before }] as never) } catch (e) { throw new PmaxControlError(t("libgoogle.rsa.errUndoGoogle", { msg: googleAdsErrorMessage(e) }), 502) }
    r.undoneAt = new Date().toISOString()
    writeLog(l)
    return r
  })
}
