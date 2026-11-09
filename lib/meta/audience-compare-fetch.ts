// Đợt 26a — đọc số Meta cho trang So sánh tệp đối tượng. Ngân sách lượt gọi (app Meta bậc development ~60 lượt/giờ):
// mỗi chiến dịch 1 lượt (cấu trúc nhóm + mẫu quảng cáo) + 1 lượt số liệu theo nhóm cho CẢ các chiến dịch; đệm 10 phút.
import { detectCompany } from "@/lib/company-detect"
import { adAccountId, metaGet, metaGetAll } from "@/lib/case/meta-graph"
import { optEventOf, pickAction, pickActionWindow, PURCHASE_TYPES } from "@/lib/case/meta-evidence"
import { META_LEAD_TYPES, metaGoalKind, type GoalKind } from "@/lib/case/goal-kind"
import { compareGroup, type CompareAdset, type CompareGroup } from "./audience-compare"
import { setCapped } from "@/lib/cost-guard"
import { makeT, type TFunction } from "@/lib/i18n/translate"

/** Lỗi do đầu vào (chọn sai chiến dịch) → route trả 400. Route dò bằng instanceof, KHÔNG dò chữ (chữ đổi theo ngôn ngữ). */
export class CompareInputError extends Error {}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const MAX_COMPARE_CAMPAIGNS = 3

export interface CompareResult {
  company: string
  range: { from: string; to: string }
  campaigns: { id: string; name: string; objective: string; goalKind: GoalKind; status: string }[]
  groups: CompareGroup[]
  /** Chiến dịch khác loại kết quả (mua vs lead) — so riêng từng nhóm, không trộn. */
  mixedKinds: boolean
  fetchedAt: string
}

/** Một dòng so sánh từ nhóm quảng cáo + số liệu insights — dùng chung cho So sánh tệp và A/B test tệp (cùng cách chấm). */
export function adsetRow(a: Row, r: Row, camp: { id: string; name: string }, kind: GoalKind, creativeIds: string[]): CompareAdset {
  const types = kind === "leads" ? META_LEAD_TYPES : PURCHASE_TYPES
  const ev = optEventOf(a.promoted_object, String(a.optimization_goal ?? ""))
  return {
    id: String(a.id), name: String(a.name ?? ""), campaignId: camp.id, campaignName: camp.name, goalKind: kind,
    optimizationGoal: String(a.optimization_goal ?? ""),
    status: String(a.status ?? ""), optEventKey: `${a.optimization_goal ?? ""}|${ev.type}|${ev.customName ?? ""}`, optEventLabel: ev.label,
    learning: a.learning_stage_info?.status ? String(a.learning_stage_info.status) : null,
    targeting: (a.targeting ?? {}) as Record<string, unknown>, creativeIds,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, reach: Number(r.reach) || 0,
    frequency: r.frequency != null ? Number(r.frequency) : null, linkClicks: Number(r.inline_link_clicks) || 0,
    results: pickActionWindow(r.actions, types, "7d_click") ?? 0,
    resultsAll: pickAction(r.actions, types), resultsView: pickActionWindow(r.actions, types, "1d_view") ?? 0,
    value: kind === "leads" ? 0 : pickActionWindow(r.action_values, PURCHASE_TYPES, "7d_click") ?? 0,
  }
}
/** Trường insights cấp nhóm + cửa sổ ghi nhận (bấm 7 ngày / chỉ xem 1 ngày) — dùng chung. */
export const ADSET_INSIGHT_FIELDS = "adset_id,campaign_id,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values"
export const ATTRIBUTION_WINDOWS = JSON.stringify(["7d_click", "1d_view"])

const memo = new Map<string, { at: number; v: CompareResult }>()
/** 26d: sau khi ghi (tạm dừng nhóm) → bỏ đệm của công ty để lần so sau đọc trạng thái mới. */
export function forgetCompare(company: string): void {
  for (const k of [...memo.keys()]) if (k.startsWith(`${company}|`)) memo.delete(k)
}

export async function compareAudiences(company: string, campaignIds: string[], range: { from: string; to: string }, opts: { force?: boolean } = {}, t: TFunction = makeT("vi")): Promise<CompareResult> {
  const ids = [...new Set(campaignIds)].filter((x) => /^\d{5,25}$/.test(x))
  if (ids.length < 2 || ids.length > MAX_COMPARE_CAMPAIGNS) throw new CompareInputError(t("libmeta.acf.pick", { max: MAX_COMPARE_CAMPAIGNS }))
  // Cờ/tóm tắt sinh theo ngôn ngữ → khoá có ngôn ngữ ở CUỐI (forgetCompare dò tiền tố công ty).
  const key = `${company}|${[...ids].sort().join(",")}|${range.from}|${range.to}|${t("libmeta.localeTag")}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < 600_000) return hit.v

  const camps: Row[] = []
  for (const id of ids) {
    const c = await metaGet<Row>(id, {
      fields: "id,name,objective,status,adsets.limit(100){id,name,status,optimization_goal,promoted_object,learning_stage_info,targeting},ads.limit(300){adset_id,status,creative{id}}",
    })
    // Công ty lấy từ TÊN chiến dịch phía Meta — không tin danh sách client gửi (cùng luật các route ghi Meta).
    if (detectCompany(String(c.name ?? "")) !== company) throw new CompareInputError(t("libmeta.acf.notCompany", { name: String(c.name ?? id) }))
    camps.push(c)
  }
  const ins = await metaGetAll<Row>(`act_${adAccountId()}/insights`, {
    level: "adset", time_range: JSON.stringify({ since: range.from, until: range.to }),
    filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]),
    fields: "adset_id,campaign_id,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values", limit: "500",
    // Tách lượt BẤM (7 ngày) và CHỈ XEM (1 ngày) — chấm theo lượt bấm (Đợt 12: ~90% "lượt mua" MBC là chỉ xem).
    action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
  })
  const insBy = new Map(ins.map((r) => [String(r.adset_id), r]))

  const rows: CompareAdset[] = []
  for (const c of camps) {
    const kind = metaGoalKind(String(c.objective ?? ""))
    const creatives = new Map<string, Set<string>>()
    for (const ad of (c.ads?.data ?? []) as Row[]) {
      if (!ad.creative?.id) continue
      const s = creatives.get(String(ad.adset_id)) ?? new Set<string>()
      s.add(String(ad.creative.id)); creatives.set(String(ad.adset_id), s)
    }
    for (const a of (c.adsets?.data ?? []) as Row[]) {
      rows.push(adsetRow(a, insBy.get(String(a.id)) ?? {}, { id: String(c.id), name: String(c.name ?? "") }, kind, [...(creatives.get(String(a.id)) ?? [])]))
    }
  }
  const kinds = [...new Set(rows.map((r) => r.goalKind))]
  const v: CompareResult = {
    company, range,
    campaigns: camps.map((c) => ({ id: String(c.id), name: String(c.name ?? ""), objective: String(c.objective ?? ""), goalKind: metaGoalKind(String(c.objective ?? "")), status: String(c.status ?? "") })),
    groups: kinds.map((k) => compareGroup(k, rows.filter((r) => r.goalKind === k), t)),
    mixedKinds: kinds.length > 1, fetchedAt: new Date().toISOString(),
  }
  setCapped(memo, key, { at: Date.now(), v })
  return v
}
