// ============================================================
// Đợt 26a — So sánh tệp đối tượng giữa các nhóm quảng cáo Meta (HÀM THUẦN, không gọi mạng)
// ============================================================
// Tệp đối tượng nằm ở NHÓM quảng cáo → chọn 2–3 chiến dịch, so mọi nhóm bên trong theo CHI PHÍ MỖI KẾT QUẢ (mua hoặc lead
// Meta ghi — user chốt 06/10), cùng khoảng ngày. Không kết luận khi chưa đủ số, và nói rõ khi hai nhóm KHÔNG so được
// (khác sự kiện tối ưu / khác mẫu quảng cáo / tệp gần trùng / đang học) — "thắng" lúc đó có thể do thứ khác chứ không phải tệp.
import { computeTargetingSimilarity } from "@/lib/audience-overlap"
import type { GoalKind } from "@/lib/case/goal-kind"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

/** "Kết quả" chỉ-xem chiếm từ tỉ lệ này (và ≥ 10 lượt) → gắn cờ: Meta báo cao hơn nhiều so với số người bấm rồi mua. */
export const VIEW_HEAVY_SHARE = 0.6
const GOAL_VI: Record<string, string> = {
  OFFSITE_CONVERSIONS: "chuyển đổi trên web", VALUE: "giá trị đơn (ROAS)", LINK_CLICKS: "click liên kết", LANDING_PAGE_VIEWS: "xem trang đích",
  LEAD_GENERATION: "form trên Meta", QUALITY_LEAD: "lead chất lượng", REACH: "tiếp cận", IMPRESSIONS: "hiển thị", CONVERSATIONS: "tin nhắn", THRUPLAY: "xem video",
}
const goalText = (g?: string, t?: TFunction) => (g ? (t && g in GOAL_VI ? t(`libmeta.ac.goal.${g}` as MessageKey) : GOAL_VI[g] ?? g) : t ? t("libmeta.ac.goalUnknown") : "không rõ")
/** Câu nói rõ hai nhóm khác sự kiện tối ưu Ở ĐÂU (cùng nhãn sự kiện thì là khác cách tối ưu). */
export function optEventDiff(r: Pick<CompareAdset, "optEventLabel" | "optimizationGoal">, best: Pick<CompareAdset, "optEventLabel" | "optimizationGoal">, t: TFunction = makeT("vi")): string {
  if (r.optEventLabel === best.optEventLabel) return t("libmeta.ac.diffSameEvent", { label: r.optEventLabel, a: goalText(r.optimizationGoal, t), b: goalText(best.optimizationGoal, t) })
  return t("libmeta.ac.diffEvent", { a: r.optEventLabel, b: best.optEventLabel })
}

/** Dưới ngần này kết quả: chưa đủ để xếp hạng (vài lượt lẻ là may rủi). */
export const MIN_RESULTS_TO_RANK = 10
/** Hai nhóm dùng chung dưới tỉ lệ mẫu quảng cáo này = khác mẫu quảng cáo. */
export const MIN_SHARED_CREATIVES = 0.5
/** Cùng thang với lib/audience-overlap.ts (đo thật 117 nhóm: trên 75% mới là gần trùng). */
export const NEAR_DUPLICATE_PCT = 75
const Z95 = 1.96

export interface CompareAdset {
  id: string
  name: string
  campaignId: string
  campaignName: string
  goalKind: GoalKind
  status: string
  optEventKey: string
  optEventLabel: string
  /** optimization_goal của nhóm (OFFSITE_CONVERSIONS, VALUE, LINK_CLICKS…) — để nói rõ hai nhóm khác nhau ở đâu. */
  optimizationGoal?: string
  learning: string | null
  targeting: Record<string, unknown>
  creativeIds: string[]
  spend: number
  impressions: number
  reach: number
  frequency: number | null
  linkClicks: number
  /** Kết quả từ lượt BẤM (7 ngày) — số dùng để chấm. Đợt 12 đo: ~90% "lượt mua" Meta báo là người CHỈ XEM rồi mua trong 1 ngày. */
  results: number
  /** Meta báo tổng (bấm 7 ngày + chỉ xem 1 ngày) — chỉ để đối chiếu. Thiếu = như results. */
  resultsAll?: number
  resultsView?: number
  value: number
}

export interface RankedAdset extends CompareAdset {
  costPerResult: number | null
  /** Khoảng tin cậy 95% của chi phí mỗi kết quả (Poisson). null khi 0 kết quả. */
  cprLow: number | null
  cprHigh: number | null
  ctr: number | null
  clickToResult: number | null
  enough: boolean
  rank: number | null
  flags: string[]
  /** 26d: kém rõ rệt so với đầu XẤU khoảng tin cậy của nhóm dẫn đầu (Poisson, p < CLEARLY_WORSE_P) — chỉ những dòng này có nút Tạm dừng. */
  clearlyWorse: boolean
}

export type CompareVerdict = "winner" | "leaning" | "undecided" | "not_enough"

export interface CompareGroup {
  goalKind: GoalKind
  verdict: CompareVerdict
  winnerId: string | null
  summary: string
  rows: RankedAdset[]
}

/** P(X ≤ k) với X ~ Poisson(λ) — HÀM THUẦN. Cộng trong thang LOG (soát 07/10: e^-λ tràn về 0 khi λ > ~745 → mọi nhóm chi lớn
 *  bị gắn "Kém rõ rệt" oan). */
export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return 1
  if (k < 0) return 0
  let logTerm = -lambda, maxLog = logTerm
  const logs = [logTerm]
  for (let i = 1; i <= k; i++) { logTerm += Math.log(lambda) - Math.log(i); logs.push(logTerm); if (logTerm > maxLog) maxLog = logTerm }
  const sum = logs.reduce((s, l) => s + Math.exp(l - maxLog), 0)
  return Math.min(1, Math.exp(maxLog) * sum)
}
/** Kém rõ rệt so với nhóm dẫn đầu: với số tiền đã chi, nếu tệp tốt NGANG nhóm dẫn đầu thì xác suất ra ít kết quả như vậy < mức này. */
export const CLEARLY_WORSE_P = 0.025

/** Khoảng tin cậy 95% của một số đếm Poisson (Wilson–Hilferty) — HÀM THUẦN. */
export function poissonInterval(n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 3.689 } // cận trên chính xác cho n=0
  const lo = n * Math.pow(1 - 1 / (9 * n) - Z95 / (3 * Math.sqrt(n)), 3)
  const m = n + 1
  const hi = m * Math.pow(1 - 1 / (9 * m) + Z95 / (3 * Math.sqrt(m)), 3)
  return { low: Math.max(0, lo), high: hi }
}

const jaccard = (a: string[], b: string[]) => {
  if (!a.length && !b.length) return 1
  const B = new Set(b)
  const inter = a.filter((x) => B.has(x)).length
  return inter / new Set([...a, ...b]).size
}
const vnd = (n: number, t: TFunction) => `₫${Math.round(n).toLocaleString(t("libmeta.numLocale"))}`

export function rankAdsets(rows: CompareAdset[]): RankedAdset[] {
  return rows.map((r) => {
    const ci = poissonInterval(r.results)
    return {
      ...r,
      costPerResult: r.results > 0 ? r.spend / r.results : null,
      cprLow: r.results > 0 ? r.spend / ci.high : null,
      cprHigh: r.results > 0 && ci.low > 0 ? r.spend / ci.low : null,
      ctr: r.impressions > 0 ? r.linkClicks / r.impressions : null,
      clickToResult: r.linkClicks > 0 ? r.results / r.linkClicks : null,
      enough: r.results >= MIN_RESULTS_TO_RANK && !(r.learning === "LEARNING"),
      rank: null,
      flags: [],
      clearlyWorse: false,
    }
  })
}

/** So các nhóm CÙNG loại kết quả (mua với mua, lead với lead) — HÀM THUẦN. */
export function compareGroup(goalKind: GoalKind, input: CompareAdset[], t: TFunction = makeT("vi")): CompareGroup {
  const word = goalKind === "leads" ? t("libmeta.ac.wordLead") : t("libmeta.ac.wordBuy")
  // Nhóm không so thẳng được (khác sự kiện / khác mẫu) — theo dõi bằng tập, KHÔNG dò chữ trong cờ (chữ đổi theo ngôn ngữ).
  const incomparable = new Set<RankedAdset>()
  const rows = rankAdsets(input.filter((r) => r.spend > 0))
  const eligible = rows.filter((r) => r.enough && r.costPerResult !== null).sort((a, b) => a.costPerResult! - b.costPerResult!)
  eligible.forEach((r, i) => { r.rank = i + 1 })
  for (const r of rows) {
    if (r.learning === "LEARNING") r.flags.push(t("libmeta.ac.flagLearning"))
    else if (r.results < MIN_RESULTS_TO_RANK) r.flags.push(t("libmeta.ac.flagFew", { n: r.results, word, min: MIN_RESULTS_TO_RANK }))
    if (r.learning === "FAIL") r.flags.push(t("libmeta.ac.flagLearnFail"))
    const all = r.resultsAll ?? r.results, view = r.resultsView ?? 0
    if (all >= MIN_RESULTS_TO_RANK && view / all >= VIEW_HEAVY_SHARE) r.flags.push(t("libmeta.ac.flagViewOnly", { pct: Math.round((view / all) * 100), word, all, n: r.results }))
  }
  const best = eligible[0]
  if (best) {
    for (const r of rows) {
      if (r === best) continue
      if (r.optEventKey !== best.optEventKey) { r.flags.push(optEventDiff(r, best, t)); incomparable.add(r) }
      if (jaccard(r.creativeIds, best.creativeIds) < MIN_SHARED_CREATIVES) { r.flags.push(t("libmeta.ac.flagCreative")); incomparable.add(r) }
      const sim = computeTargetingSimilarity({ targeting: r.targeting } as never, { targeting: best.targeting } as never).overall * 100
      if (sim >= NEAR_DUPLICATE_PCT) r.flags.push(t("libmeta.ac.flagNearDup", { pct: Math.round(sim) }))
    }
  }
  const zeroBurn = rows.filter((r) => r.results === 0 && best?.costPerResult && r.spend >= 2 * best.costPerResult)
  const refZ = best ? best.cprHigh ?? best.costPerResult : null
  for (const r of zeroBurn) {
    // 26d: 0 kết quả mà chi đủ lớn để, kể cả nhóm dẫn đầu chỉ tốt ở mức thấp nhất, xác suất 0 lượt < 2,5% → kém rõ rệt.
    const worse = !!refZ && poissonCdf(0, r.spend / refZ) < CLEARLY_WORSE_P
    if (worse) r.clearlyWorse = true
    r.flags.push(t("libmeta.ac.flagZeroBurn", { spend: vnd(r.spend, t), word, worse: worse ? t("libmeta.ac.flagZeroWorse") : "" }))
  }
  // Ít số vẫn kết luận được KÉM: chi đủ để nhóm dẫn đầu ra ≥ 3 kết quả mà thực tế ra quá ít (Poisson) — dùng 06/10: chi ₫1,72tr,
  // theo mức nhóm dẫn đầu lẽ ra ~21 lượt mua, thực tế 2. Không gắn khi đã có cờ "0 kết quả" (trùng ý).
  // Nhóm dẫn đầu cũng chỉ có ít kết quả → so với ĐẦU XẤU của khoảng tin cậy của nó (chi phí/kết quả cao nhất còn hợp lý),
  // để không tuyên "kém" oan chỉ vì nhóm dẫn đầu gặp may.
  const ref = best?.cprHigh ?? null
  if (best && ref) {
    for (const r of rows) {
      if (r === best || r.results === 0) continue
      const expected = r.spend / ref
      if (expected >= 3 && r.results < expected && poissonCdf(r.results, expected) < CLEARLY_WORSE_P) {
        r.clearlyWorse = true
        r.flags.push(t("libmeta.ac.flagClearlyWorse", { spend: vnd(r.spend, t), ref: vnd(ref, t), word, expected: Math.round(expected), n: r.results }))
      }
    }
  }

  if (eligible.length === 0) return { goalKind, verdict: "not_enough", winnerId: null, rows, summary: t("libmeta.ac.sumNone", { min: MIN_RESULTS_TO_RANK, word }) }
  if (eligible.length === 1) {
    // Soát 07/10: "chi gấp đôi mà 0" chưa đủ để tuyên thắng (nếu tốt ngang nhau, 0 kết quả khi chi gấp đôi vẫn có ~13,5% khả năng).
    // Thắng chỉ khi nhóm kia KÉM RÕ RỆT so với đầu XẤU khoảng tin cậy của nhóm dẫn đầu (cùng tiêu chí cờ "Kém rõ rệt"), và so được.
    const ref = best.cprHigh ?? best.costPerResult!
    const losers = rows.filter((r) => r !== best && r.results === 0 && poissonCdf(0, r.spend / ref) < CLEARLY_WORSE_P
      && !incomparable.has(r))
    return {
      goalKind, verdict: losers.length ? "winner" : "not_enough", winnerId: losers.length ? best.id : null, rows,
      summary: losers.length
        ? t("libmeta.ac.sumOneWin", { name: best.name, cpr: vnd(best.costPerResult!, t), word, n: losers.length })
        : t("libmeta.ac.sumOneOnly", { name: best.name, cpr: vnd(best.costPerResult!, t), word }),
    }
  }
  const second = eligible[1]
  const clean = best.cprHigh !== null && eligible.slice(1).every((r) => r.cprLow !== null && best.cprHigh! < r.cprLow!)
  // Soát 07/10: MỌI nhóm còn lại phải so được (trước chỉ soi nhóm thứ 2 → nhóm thứ 3 khác mẫu vẫn ra "thắng").
  const comparable = eligible.slice(1).every((r) => !incomparable.has(r))
  const gap = Math.round((second.costPerResult! / best.costPerResult! - 1) * 100)
  if (clean && comparable) return { goalKind, verdict: "winner", winnerId: best.id, rows, summary: t("libmeta.ac.sumWinner", { name: best.name, cpr: vnd(best.costPerResult!, t), word, gap }) }
  if (clean) return { goalKind, verdict: "leaning", winnerId: best.id, rows, summary: t("libmeta.ac.sumLeanClean", { name: best.name, cpr: vnd(best.costPerResult!, t), word, gap }) }
  return { goalKind, verdict: "leaning", winnerId: best.id, rows, summary: t("libmeta.ac.sumLean", { name: best.name, cpr: vnd(best.costPerResult!, t), word, gap }) }
}
