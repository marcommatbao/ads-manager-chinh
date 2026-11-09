// ============================================================
// Đợt 19c — Facebook học theo đơn thật: sẵn sàng + so sánh "mua hàng Meta tự báo" ↔ "đơn thật Meta khớp (7 ngày sau bấm)"
// ============================================================
// Đơn thật (nguồn đơn 19-0) đi CAPI thành sự kiện riêng META_EVENT_NAME (Đợt 16). Muốn Meta tối ưu / báo cáo theo nó phải có
// CHUYỂN ĐỔI TUỲ CHỈNH dựng từ sự kiện đó (Đợt 17 cũng cần). Tool tạo được (Kiểm trước → XAC NHAN), hoặc user tạo tay.
// So theo chiến dịch: Meta tự báo (gồm lượt chỉ-xem) vs đơn thật khớp lượt BẤM 7 ngày — chênh lớn = Meta đang "nhận vơ".

import type { Company } from "@/lib/case/types"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { makeT, type TFunction } from "@/lib/i18n/translate"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const REAL_CC_NAME = "AdsCommand · Đơn đã thanh toán"
export const MIN_REAL_META = 15
export const VIEW_HEAVY = 0.6

export interface MetaReadiness {
  pixelId: string | null; sending: boolean; test: boolean; sent: number
  conversion: { id: string; name: string } | null
  todo: string[]
}

/** HÀM THUẦN. */
export function metaTodo(x: Omit<MetaReadiness, "todo">, eventName: string, tr: TFunction = makeT("vi")): string[] {
  const t: string[] = []
  if (!x.pixelId) t.push(tr("libmeta.cv.m.todoNoPixel"))
  if (!x.sending) t.push(tr("libmeta.cv.m.todoSending"))
  else if (x.test) t.push(tr("libmeta.cv.m.todoTest"))
  if (!x.conversion) t.push(tr("libmeta.cv.m.todoConv", { event: eventName }))
  return t
}

export interface MetaCampaignCompare {
  id: string; name: string; spend: number
  metaPurchases: number; viewShare: number | null; realOrders: number; realValue: number
  cpaMeta: number | null; cpaReal: number | null
  verdict: "no_conversion" | "few" | "ready" | "view_heavy"; note: string
}

/** HÀM THUẦN. rows: mỗi chiến dịch đã gộp số. */
export function compareMetaCampaigns(rows: { id: string; name: string; spend: number; meta: number; click: number; view: number; real: number | null; realValue: number }[], t: TFunction = makeT("vi")): MetaCampaignCompare[] {
  return rows.filter((r) => r.spend > 0).map((r) => {
    const vs = r.click + r.view > 0 ? r.view / (r.click + r.view) : null
    let verdict: MetaCampaignCompare["verdict"], note: string
    if (r.real == null) { verdict = "no_conversion"; note = t("libmeta.cv.m.noteNoConv") }
    else if (vs != null && vs >= VIEW_HEAVY && r.meta >= 5) { verdict = "view_heavy"; note = t("libmeta.cv.m.noteViewHeavy", { pct: Math.round(vs * 100) }) }
    else if ((r.real ?? 0) >= MIN_REAL_META) { verdict = "ready"; note = t("libmeta.cv.m.noteReady", { n: Math.round(r.real!), name: REAL_CC_NAME }) }
    else { verdict = "few"; note = t("libmeta.cv.m.noteFew", { n: Math.round(r.real ?? 0), min: MIN_REAL_META }) }
    return { id: r.id, name: r.name, spend: r.spend, metaPurchases: r.meta, viewShare: vs, realOrders: r.real ?? 0, realValue: r.realValue, cpaMeta: r.meta > 0 ? r.spend / r.meta : null, cpaReal: (r.real ?? 0) > 0 ? r.spend / r.real! : null, verdict, note }
  }).sort((a, b) => b.spend - a.spend)
}

// ── Đọc / ghi Meta ──

async function findConversion(co: Company): Promise<{ id: string; name: string; actionType: string } | null> {
  const { metaGetAll, adAccountId } = await import("@/lib/case/meta-graph")
  const { findOdooConversion } = await import("@/lib/meta/creative-truth")
  const { metaAccountIds } = await import("@/lib/meta-accounts")
  const cc = await metaGetAll<Row>(`act_${adAccountId()}/customconversions`, { fields: "id,name,rule,event_source_id,is_archived", limit: "200" }, 2)
  return findOdooConversion(cc, metaAccountIds(co).pixelId || null)
}

export async function metaReadiness(co: Company, t: TFunction = makeT("vi")): Promise<MetaReadiness & { error?: string }> {
  const { realOrderSettings } = await import("@/lib/conversions/sync")
  const { metaQueueStats, META_EVENT_NAME } = await import("@/lib/conversions/meta-capi")
  const { metaAccountIds } = await import("@/lib/meta-accounts")
  const s = realOrderSettings(co)
  let conversion: MetaReadiness["conversion"] = null, error: string | undefined
  try { const c = await findConversion(co); conversion = c ? { id: c.id, name: c.name } : null } catch (e) { error = e instanceof Error ? e.message.slice(0, 200) : String(e) }
  const base = { pixelId: s.meta?.pixelId || metaAccountIds(co).pixelId || null, sending: !!s.meta?.enabled, test: !!s.meta?.testEventCode, sent: metaQueueStats(co).byStatus.sent, conversion }
  return { ...base, todo: metaTodo(base, META_EVENT_NAME, t), ...(error ? { error } : {}) }
}

/** Tạo chuyển đổi tuỳ chỉnh từ sự kiện đơn thật. validateOnly = Meta chỉ kiểm dữ liệu (KHÔNG kiểm quyền ghi — đo 21/09). */
export async function createRealOrderConversion(co: Company, opts: { validateOnly: boolean; confirmText?: string }, t: TFunction = makeT("vi")): Promise<{ id?: string; validated: boolean }> {
  if (!opts.validateOnly && opts.confirmText !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(t("libmeta.cv.m.typeConfirm", { text: PMAX_CONFIRM_TEXT }), 428)
  const { metaPost, adAccountId } = await import("@/lib/case/meta-graph")
  const { META_EVENT_NAME } = await import("@/lib/conversions/meta-capi")
  const r = await metaReadiness(co)
  if (r.conversion) throw new PmaxControlError(t("libmeta.cv.m.exists", { name: r.conversion.name }), 409)
  if (!r.pixelId) throw new PmaxControlError(t("libmeta.cv.m.noPixel"), 400)
  const res = await metaPost(`act_${adAccountId()}/customconversions`, {
    name: `${REAL_CC_NAME} (${co})`, event_source_id: r.pixelId, custom_event_type: "PURCHASE",
    rule: JSON.stringify({ and: [{ event: { eq: META_EVENT_NAME } }] }), default_conversion_value: 0,
  }, opts.validateOnly)
  return { id: typeof res.id === "string" ? res.id : undefined, validated: opts.validateOnly }
}

export async function metaCompare(co: Company, range: { from: string; to: string }, t: TFunction = makeT("vi")): Promise<MetaCampaignCompare[]> {
  const { metaGetAll, adAccountId } = await import("@/lib/case/meta-graph")
  const { PURCHASE_TYPES, pickAction, pickActionWindow } = await import("@/lib/case/meta-evidence")
  const { detectCompany } = await import("@/lib/company-detect")
  // Đợt 20c: lỗi đọc chuyển đổi tuỳ chỉnh KHÔNG được biến thành "chưa có" — để lỗi nổi lên (route hiện compareError).
  const conv = await findConversion(co)
  const ins = await metaGetAll<Row>(`act_${adAccountId()}/insights`, {
    level: "campaign", time_range: JSON.stringify({ since: range.from, until: range.to }),
    fields: "campaign_id,campaign_name,spend,actions,action_values", action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]), limit: "500",
  }, 3)
  return compareMetaCampaigns(ins.filter((r) => detectCompany(String(r.campaign_name)) === co).map((r) => ({
    id: String(r.campaign_id), name: String(r.campaign_name ?? ""), spend: Number(r.spend) || 0,
    meta: pickAction(r.actions, PURCHASE_TYPES), click: pickActionWindow(r.actions, PURCHASE_TYPES, "7d_click") ?? 0, view: pickActionWindow(r.actions, PURCHASE_TYPES, "1d_view") ?? 0,
    real: conv ? pickActionWindow(r.actions, [conv.actionType], "7d_click") ?? 0 : null, realValue: conv ? pickActionWindow(r.action_values, [conv.actionType], "7d_click") ?? 0 : 0,
  })), t)
}
