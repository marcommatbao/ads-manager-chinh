// ============================================================
// Đợt 18a–c — Bản tách mang theo TÀI SẢN của chiến dịch gốc (sitelink, ảnh, tên doanh nghiệp, logo, chú thích…)
// ============================================================
// User báo 01/10: bản tách "· Chung" không có sitelink, ảnh, ô Tên doanh nghiệp trống → phải vào Google Ads gắn tay. Nguyên nhân:
// split.ts không đọc campaign_asset / ad_group_asset. Tài sản Google Ads là đối tượng CẤP TÀI KHOẢN → chỉ cần tạo LIÊN KẾT mới tới
// đúng tài sản cũ (không chép nội dung, không cần duyệt lại). Tài sản cấp tài khoản (customer_asset) tự áp — không chép.
// Gắn theo TỪNG LOẠI một lô: một loại hỏng (vd Google không cho gắn tay tài sản tự tạo) không làm hỏng loại khác / cả lượt tách.

import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import type { Company } from "@/lib/case/types"
import { MAX_IMAGES_PER_CAMPAIGN } from "@/lib/google-image-asset"
import { MAX_SITELINKS_PER_CAMPAIGN } from "@/lib/google-sitelink-asset"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, tk } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: unknown) => Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k])) as Record<number, string>
const FIELD = inv(enums.AssetFieldType)

export const FIELD_LABEL: Record<string, string> = {
  SITELINK: "sitelink", CALLOUT: "chú thích", STRUCTURED_SNIPPET: "đoạn nội dung có cấu trúc", AD_IMAGE: "ảnh",
  BUSINESS_NAME: "tên doanh nghiệp", BUSINESS_LOGO: "logo", CALL: "số điện thoại", PRICE: "giá", PROMOTION: "khuyến mãi",
  LEAD_FORM: "biểu mẫu", MOBILE_APP: "ứng dụng", HOTEL_CALLOUT: "chú thích khách sạn",
}
export const fieldName = (t: number | string) => (typeof t === "string" ? t : FIELD[t] ?? String(t))
export const fieldLabel = (t: number | string) => FIELD_LABEL[fieldName(t)] ?? fieldName(t).toLowerCase()
/** Nhãn loại tài sản theo ngôn ngữ của tr (loại lạ → tên thường). */
export function labelOfType(ft: string, tr: TFunction = viT): string {
  const k = `libgoogle.fl.${ft}`
  const v = tk(tr, k)
  return v === k ? ft.toLowerCase() : v
}

export interface AssetLink { asset: string; fieldType: number; adGroupId?: string; text?: string }
export interface AssetCount { fieldType: string; label: string; count: number }

/** Đếm theo loại — HÀM THUẦN. */
export function countByType(links: Pick<AssetLink, "fieldType">[], tr: TFunction = viT): AssetCount[] {
  const m = new Map<string, number>()
  for (const l of links) m.set(fieldName(l.fieldType), (m.get(fieldName(l.fieldType)) ?? 0) + 1)
  return [...m].map(([fieldType, count]) => ({ fieldType, label: labelOfType(fieldType, tr), count })).sort((a, b) => b.count - a.count)
}
export const describeCounts = (c: AssetCount[], tr: TFunction = viT) => c.map((x) => `${x.count} ${x.label}`).join(" · ") || tr("libgoogle.sas.none")

/**
 * Trần liên kết cấp CHIẾN DỊCH của Google theo loại. Vượt trần → Google từ chối CẢ LÔ (resource_count_limit_exceeded) —
 * user 01/10: 11 ảnh hỏng vì chiến dịch mới đã có 12 ảnh. Chỉ gắn phần còn chỗ, theo thứ tự ở chiến dịch gốc.
 */
export const CAMPAIGN_CAPS: Record<string, number> = { AD_IMAGE: MAX_IMAGES_PER_CAMPAIGN, SITELINK: MAX_SITELINKS_PER_CAMPAIGN, CALLOUT: 20, STRUCTURED_SNIPPET: 20 }

export interface LinkPlan {
  campaign: { asset: string; fieldType: number }[]
  adGroup: { adGroup: string; asset: string; fieldType: number }[]
  /** Đã có ở chiến dịch mới — không gắn trùng. */
  alreadyThere: number
  /** Nhóm gốc không tìm được nhóm tương ứng ở chiến dịch mới. */
  unmappedAdGroups: string[]
  /** Bỏ vì chiến dịch mới đã chạm trần Google cho loại đó. */
  capped: { fieldType: string; label: string; count: number; cap: number; have: number }[]
}

/**
 * Liên kết CÒN THIẾU ở chiến dịch mới — HÀM THUẦN. `adGroupMap`: id nhóm gốc → resource nhóm mới (cùng tên).
 * Khoá trùng = tài sản + loại (+ nhóm). Gọi lại sau khi đã gắn → kế hoạch rỗng (chạy lại an toàn).
 */
export function planLinks(input: { source: AssetLink[]; existing: AssetLink[]; adGroupMap: Map<string, string>; newAdGroupIdOf: (res: string) => string; caps?: Record<string, number>; t?: TFunction }): LinkPlan {
  const have = new Set(input.existing.map((l) => `${l.adGroupId ?? "-"}|${l.asset}|${l.fieldType}`))
  const plan: LinkPlan = { campaign: [], adGroup: [], alreadyThere: 0, unmappedAdGroups: [], capped: [] }
  const caps = input.caps ?? CAMPAIGN_CAPS
  const used = new Map<string, number>()
  for (const l of input.existing) if (!l.adGroupId) used.set(fieldName(l.fieldType), (used.get(fieldName(l.fieldType)) ?? 0) + 1)
  const haveAtStart = new Map(used)
  const skipped = new Map<string, number>()
  for (const l of input.source) {
    if (!l.adGroupId) {
      const k = `-|${l.asset}|${l.fieldType}`
      if (have.has(k)) { plan.alreadyThere++; continue }
      const t = fieldName(l.fieldType), cap = caps[t]
      if (cap != null && (used.get(t) ?? 0) >= cap) { skipped.set(t, (skipped.get(t) ?? 0) + 1); continue }
      used.set(t, (used.get(t) ?? 0) + 1)
      have.add(k); plan.campaign.push({ asset: l.asset, fieldType: l.fieldType })
      continue
    }
    const target = input.adGroupMap.get(l.adGroupId)
    if (!target) { if (!plan.unmappedAdGroups.includes(l.adGroupId)) plan.unmappedAdGroups.push(l.adGroupId); continue }
    const k = `${input.newAdGroupIdOf(target)}|${l.asset}|${l.fieldType}`
    if (have.has(k)) { plan.alreadyThere++; continue }
    have.add(k); plan.adGroup.push({ adGroup: target, asset: l.asset, fieldType: l.fieldType })
  }
  plan.capped = [...skipped].map(([t, count]) => ({ fieldType: t, label: labelOfType(t, input.t ?? viT), count, cap: caps[t], have: haveAtStart.get(t) ?? 0 }))
  return plan
}

/** Chia theo loại để gắn từng lô — HÀM THUẦN. */
export function groupByType<T extends { fieldType: number }>(xs: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = fieldName(x.fieldType); (m.get(k) ?? m.set(k, []).get(k)!).push(x) }
  return m
}

/** Lỗi gắn một lô → câu dễ hiểu (Google lặp lại cùng câu cho TỪNG thao tác, bị cắt giữa chừng trên thẻ). */
export function friendlyLinkError(msg: string, tr: TFunction = viT): string {
  if (/resource_count_limit_exceeded/.test(msg)) return tr("libgoogle.sas.errLimit")
  const first = msg.split(" · ")[0].replace(/\s*\(trường:.*$/, "").trim()
  const n = (msg.match(/ · /g)?.length ?? 0) + 1
  return `${first.slice(0, 200)}${n > 1 ? ` (×${n})` : ""}`
}

// ── Đọc Google Ads ──

/** includePaused: đọc chiến dịch ĐÍCH — liên kết đang tạm dừng vẫn là "đã có" (gắn lại = Google từ chối trùng, hỏng cả lô). */
export async function readCampaignAssets(company: Company, campaignId: string, opts: { includePaused?: boolean } = {}): Promise<AssetLink[]> {
  const st = (f: string) => (opts.includePaused ? `${f}.status != 'REMOVED'` : `${f}.status = 'ENABLED'`)
  const c = getGoogleAdsCustomer(company)
  const id = Number(campaignId)
  const [camp, groups] = await Promise.all([
    c.query(`SELECT campaign.id, campaign_asset.asset, campaign_asset.field_type, asset.sitelink_asset.link_text, asset.callout_asset.callout_text FROM campaign_asset WHERE campaign.id = ${id} AND ${st("campaign_asset")}`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, ad_group.id, ad_group_asset.asset, ad_group_asset.field_type FROM ad_group_asset WHERE campaign.id = ${id} AND ${st("ad_group_asset")}`) as Promise<Row[]>,
  ])
  return [
    ...camp.map((r) => ({ asset: String(r.campaign_asset.asset), fieldType: Number(r.campaign_asset.field_type), text: r.asset?.sitelink_asset?.link_text ?? r.asset?.callout_asset?.callout_text ?? undefined })),
    ...groups.map((r) => ({ asset: String(r.ad_group_asset.asset), fieldType: Number(r.ad_group_asset.field_type), adGroupId: String(r.ad_group.id) })),
  ]
}

export interface AssetReport {
  at: string; by: string; validateOnly: boolean
  source: AssetCount[]; before: AssetCount[]; planned: AssetCount[]; added: AssetCount[]; after: AssetCount[] | null
  alreadyThere: number; failed: { fieldType: string; label: string; count: number; error: string }[]; notes: string[]
}

/**
 * Gắn tài sản còn thiếu từ chiến dịch gốc sang chiến dịch mới (bản tách). validateOnly = Kiểm trước (Google kiểm, không ghi).
 * Dùng cho 18b (ngay sau khi tách) và 18c (bổ sung cho bản tách đã tạo). Đọc lại sau khi gắn để báo số thật.
 */
export async function linkSourceAssets(input: { company: Company; sourceCampaignId: string; newCampaign: string; sourceAdGroups: { sourceId: string; name: string }[]; validateOnly: boolean; actor: string }, tr: TFunction = viT): Promise<AssetReport> {
  const c = getGoogleAdsCustomer(input.company)
  const newId = input.newCampaign.split("/").pop()!
  const [source, existing, newGroups] = await Promise.all([
    readCampaignAssets(input.company, input.sourceCampaignId),
    readCampaignAssets(input.company, newId, { includePaused: true }),
    c.query(`SELECT campaign.id, ad_group.id, ad_group.name, ad_group.resource_name FROM ad_group WHERE campaign.id = ${Number(newId)} AND ad_group.status != 'REMOVED'`) as Promise<Row[]>,
  ])
  const byName = new Map(newGroups.map((g) => [String(g.ad_group.name), String(g.ad_group.resource_name)]))
  const adGroupMap = new Map<string, string>()
  for (const g of input.sourceAdGroups) { const t = byName.get(g.name.slice(0, 250)); if (t) adGroupMap.set(g.sourceId, t) }
  // Tài sản cấp nhóm gốc thuộc nhóm KHÔNG được chuyển (chỉ có từ khoá thương hiệu) → không có nhóm mới tương ứng, bỏ qua đúng.
  const moved = new Set(input.sourceAdGroups.map((g) => g.sourceId))
  const plan = planLinks({ source: source.filter((l) => !l.adGroupId || moved.has(l.adGroupId)), existing, adGroupMap, newAdGroupIdOf: (res) => res.split("/").pop()!, t: tr })
  const report: AssetReport = {
    at: new Date().toISOString(), by: input.actor, validateOnly: input.validateOnly,
    source: countByType(source.filter((l) => !l.adGroupId || moved.has(l.adGroupId)), tr), before: countByType(existing, tr),
    planned: countByType([...plan.campaign, ...plan.adGroup], tr), added: [], after: null, alreadyThere: plan.alreadyThere, failed: [], notes: [],
  }
  for (const x of plan.capped) report.notes.push(tr("libgoogle.sas.noteCapped", { n: x.count, label: x.label, cap: x.cap, have: x.have, more: x.cap - x.have > 0 ? tr("libgoogle.sas.noteCappedMore", { n: x.cap - x.have }) : "" }))
  if (plan.unmappedAdGroups.length) report.notes.push(tr("libgoogle.sas.noteUnmapped", { n: plan.unmappedAdGroups.length }))
  if (!plan.campaign.length && !plan.adGroup.length) { report.notes.push(source.length ? tr("libgoogle.sas.noteComplete") : tr("libgoogle.sas.noteNoAssets")); return report }

  const added: { fieldType: number }[] = []
  const batches: { type: string; ops: object[]; n: number; fts: number[] }[] = []
  for (const [type, xs] of groupByType(plan.campaign)) batches.push({ type, n: xs.length, fts: xs.map((x) => x.fieldType), ops: xs.map((x) => ({ entity: "campaign_asset", operation: "create", resource: { campaign: input.newCampaign, asset: x.asset, field_type: x.fieldType } })) })
  for (const [type, xs] of groupByType(plan.adGroup)) batches.push({ type: `${type}@adgroup`, n: xs.length, fts: xs.map((x) => x.fieldType), ops: xs.map((x) => ({ entity: "ad_group_asset", operation: "create", resource: { ad_group: x.adGroup, asset: x.asset, field_type: x.fieldType } })) })
  for (const b of batches) {
    const ft = b.type.replace("@adgroup", "")
    try {
      await c.mutateResources(b.ops as never, (input.validateOnly ? { validate_only: true } : undefined) as never)
      for (const fieldType of b.fts) added.push({ fieldType })
    } catch (e) {
      report.failed.push({ fieldType: ft, label: `${labelOfType(ft, tr)}${b.type.endsWith("@adgroup") ? tr("libgoogle.sas.adGroupLevel") : ""}`, count: b.n, error: friendlyLinkError(googleAdsErrorMessage(e), tr) })
    }
  }
  report.added = countByType(added, tr)
  if (!input.validateOnly) {
    try { report.after = countByType(await readCampaignAssets(input.company, newId), tr) } catch (e) { report.notes.push(tr("libgoogle.sas.noteReadback", { msg: googleAdsErrorMessage(e).slice(0, 200) })) }
  }
  return report
}
