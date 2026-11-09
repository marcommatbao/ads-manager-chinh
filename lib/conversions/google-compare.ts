// ============================================================
// Đợt 19b — Google học theo đơn thật: kiểm sẵn sàng + so sánh "đơn Google tự báo" ↔ "đơn thật Google khớp được"
// ============================================================
// Đơn thật (nguồn đơn 19-0) vào hành động PHỤ "AdsCommand · Lead chốt đơn" (Đợt 10c/16) → Google gán về chiến dịch có lượt
// bấm khớp (gclid hoặc email/SĐT băm). Hành động phụ nằm trong all_conversions, KHÔNG trong conversions → chưa đổi đặt giá.
// Chạy song song ≥ 14 ngày rồi tool ĐỀ XUẤT (không tự làm) đưa hành động lên mục tiêu chính cho chiến dịch đủ số.
// Khớp bằng email/SĐT cần: đã chấp nhận Điều khoản dữ liệu khách hàng + bật Chuyển đổi nâng cao cho lead — thiếu thì Google
// nhận tệp nhưng không gán được đơn nào (0 âm thầm).

import { enums } from "google-ads-api"
import type { Company } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const PARALLEL_DAYS = 14
export const MIN_REAL_FOR_PRIMARY = 15

export interface Readiness {
  /** exists null = KHÔNG ĐỌC ĐƯỢC (khác "chưa có" — đừng để người dùng đi tạo trùng). */
  action: { exists: boolean | null; primary: boolean | null; status: string | null; resourceName: string | null }
  errors?: string[]
  customerDataTerms: boolean | null; ecForLeads: boolean | null
  /** Việc còn thiếu, theo thứ tự làm. Rỗng = sẵn sàng. */
  todo: string[]
}

/** HÀM THUẦN. */
export function readinessTodo(r: Omit<Readiness, "todo">, googleOn: boolean, tr: TFunction = makeT("vi")): string[] {
  const t: string[] = []
  if (r.action.exists === null) t.push(tr("libmeta.cv.g.todoCantRead"))
  else if (!r.action.exists) t.push(tr("libmeta.cv.g.todoCreate"))
  else if (r.action.primary) t.push(tr("libmeta.cv.g.todoPrimary"))
  if (r.customerDataTerms === false) t.push(tr("libmeta.cv.g.todoTerms"))
  if (r.ecForLeads === false) t.push(tr("libmeta.cv.g.todoEc"))
  if (!googleOn) t.push(tr("libmeta.cv.g.todoSend"))
  return t
}

export interface CampaignCompare {
  id: string; name: string; cost: number
  googleConv: number; realOrders: number; realValue: number
  cpaGoogle: number | null; cpaReal: number | null
  verdict: "gathering" | "no_match" | "ready" | "few"; note: string
}

/**
 * Ghép số theo chiến dịch + kết luận — HÀM THUẦN.
 * daysOn = số ngày từ lúc bật gửi Google; uploaded = số đơn Google đã NHẬN trong kỳ (toàn tài khoản).
 */
export function compareCampaigns(
  base: { id: string; name: string; cost: number; conv: number }[], real: Map<string, { n: number; v: number }>,
  opts: { daysOn: number | null; uploaded: number },
  t: TFunction = makeT("vi"),
): CampaignCompare[] {
  const totalReal = [...real.values()].reduce((s, x) => s + x.n, 0)
  return base.filter((c) => c.cost > 0 || real.has(c.id)).map((c) => {
    const r = real.get(c.id) ?? { n: 0, v: 0 }
    const days = opts.daysOn ?? 0
    let verdict: CampaignCompare["verdict"], note: string
    if (days < PARALLEL_DAYS) { verdict = "gathering"; note = t("libmeta.cv.g.noteGathering", { days, max: PARALLEL_DAYS }) }
    else if (r.n === 0 && totalReal === 0 && opts.uploaded > 0) { verdict = "no_match"; note = t("libmeta.cv.g.noteNoMatch") }
    else if (r.n >= MIN_REAL_FOR_PRIMARY) { verdict = "ready"; note = t("libmeta.cv.g.noteReady", { n: r.n }) }
    else { verdict = "few"; note = t("libmeta.cv.g.noteFew", { n: r.n, min: MIN_REAL_FOR_PRIMARY }) }
    return { id: c.id, name: c.name, cost: c.cost, googleConv: c.conv, realOrders: r.n, realValue: r.v, cpaGoogle: c.conv > 0 ? c.cost / c.conv : null, cpaReal: r.n > 0 ? c.cost / r.n : null, verdict, note }
  }).sort((a, b) => b.cost - a.cost)
}

// ── Đọc Google Ads ──

const CS = Object.fromEntries(Object.entries(enums.ConversionActionStatus).filter(([, v]) => typeof v === "number").map(([k, v]) => [v, k])) as Record<number, string>

export async function googleReadiness(co: Company, googleOn: boolean, t: TFunction = makeT("vi")): Promise<Readiness> {
  const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
  const { readActions } = await import("@/lib/leads/quality")
  const c = getGoogleAdsCustomer(co)
  const errors: string[] = []
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)
  const [actions, cust] = await Promise.all([
    readActions(co).catch((e: unknown) => { errors.push(t("libmeta.cv.g.errActions", { msg: msg(e) })); return null }),
    (c.query(`SELECT customer.id, customer.conversion_tracking_setting.accepted_customer_data_terms, customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled FROM customer LIMIT 1`) as Promise<Row[]>).catch((e: unknown) => { errors.push(t("libmeta.cv.g.errSettings", { msg: msg(e) })); return [] as Row[] }),
  ])
  const won = actions?.find((a) => a.stage === "won")
  const s = cust[0]?.customer?.conversion_tracking_setting
  const base = {
    action: { exists: actions === null ? null : !!won?.resourceName, primary: won?.primary ?? null, status: won?.status ? CS[Number(won.status)] ?? won.status : null, resourceName: won?.resourceName ?? null },
    customerDataTerms: s ? !!s.accepted_customer_data_terms : null, ecForLeads: s ? !!s.enhanced_conversions_for_leads_enabled : null,
  }
  return { ...base, todo: readinessTodo(base, googleOn, t), ...(errors.length ? { errors } : {}) }
}

export async function googleCompare(co: Company, range: { from: string; to: string }, opts: { daysOn: number | null; uploaded: number; action: string | null }, t: TFunction = makeT("vi")): Promise<CampaignCompare[]> {
  const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
  const c = getGoogleAdsCustomer(co)
  const B = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const [base, real] = await Promise.all([
    c.query(`SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.conversions FROM campaign WHERE ${B} AND campaign.status != 'REMOVED'`) as Promise<Row[]>,
    opts.action && /^customers\/\d+\/conversionActions\/\d+$/.test(opts.action)
      ? (c.query(`SELECT campaign.id, segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value FROM campaign WHERE ${B} AND segments.conversion_action = '${opts.action}'`) as Promise<Row[]>)
      : Promise.resolve([] as Row[]),
  ])
  const sum = new Map<string, { id: string; name: string; cost: number; conv: number }>()
  for (const r of base) {
    const id = String(r.campaign.id), x = sum.get(id) ?? { id, name: String(r.campaign.name), cost: 0, conv: 0 }
    x.cost += (Number(r.metrics.cost_micros) || 0) / 1e6; x.conv += Number(r.metrics.conversions) || 0; sum.set(id, x)
  }
  const rm = new Map<string, { n: number; v: number }>()
  for (const r of real) { const id = String(r.campaign.id), x = rm.get(id) ?? { n: 0, v: 0 }; x.n += Number(r.metrics.all_conversions) || 0; x.v += Number(r.metrics.all_conversions_value) || 0; rm.set(id, x) }
  return compareCampaigns([...sum.values()], rm, opts, t)
}
