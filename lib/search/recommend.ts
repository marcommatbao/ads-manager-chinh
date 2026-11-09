// ============================================================
// Đợt 11b — "Việc nên làm" cho Search: từ X-quang + đề xuất → danh sách ưu tiên có nút làm (HÀM THUẦN)
// ============================================================
import type { SearchProposal } from "./controls"
import type { SearchXray } from "./xray"
import type { SplitRecord } from "./split"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, vndT, tk } from "@/lib/google-i18n"

export interface SearchRecommendation {
  id: string; priority: 1 | 2 | 3; title: string; why: string; moneyAtStake: number | null
  /** Mở luồng nào ở giao diện. */
  action: { type: "proposals"; ids: string[] } | { type: "split"; campaignId: string; split?: SplitStatus } | { type: "manual"; steps: string[] }
}
/** Bản tách ĐANG DÙNG của chiến dịch gốc — để thẻ "Tách lượt tìm chung" không hiện như việc chưa làm (user báo 01/10). */
export interface SplitStatus { id: string; name: string; step: "created" | "moved"; day: number | null; verdict: string | null }
const VERDICT_KEYS = ["tot", "theo_doi", "dung"]
const DAY = 86_400_000

/** Bản tách mới nhất còn dùng (đã tạo / đã chuyển) theo chiến dịch gốc — HÀM THUẦN. */
export function activeSplitsBySource(splits: Pick<SplitRecord, "id" | "sourceId" | "name" | "step" | "at" | "movedAt" | "checkpoints">[], now: Date, t: TFunction = viT): Map<string, SplitStatus> {
  const m = new Map<string, SplitStatus & { at: string }>()
  for (const r of splits) {
    if (r.step !== "created" && r.step !== "moved") continue
    const prev = m.get(r.sourceId)
    if (prev && prev.at >= r.at) continue
    const cp = r.checkpoints?.["14"] ?? r.checkpoints?.["7"]
    m.set(r.sourceId, { id: r.id, name: r.name, step: r.step, at: r.at, day: r.step === "moved" && r.movedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(r.movedAt)) / DAY)) : null, verdict: cp ? (VERDICT_KEYS.includes(cp.verdict) ? tk(t, `libgoogle.sr.verdict.${cp.verdict}`) : cp.verdict) : null })
  }
  return new Map([...m].map(([k, { at: _at, ...v }]) => [k, v])) // eslint-disable-line @typescript-eslint/no-unused-vars
}

export function recommendSearch(x: Pick<SearchXray, "warnings" | "campaigns">, proposals: SearchProposal[], splits: Map<string, SplitStatus> = new Map(), t: TFunction = viT): SearchRecommendation[] {
  const vnd = (n: number) => vndT(t, n)
  const out: SearchRecommendation[] = []
  for (const w of x.warnings.filter((w) => w.id === "brand_starved")) {
    const name = x.campaigns.find((c) => c.id === w.campaignId)?.name
    const sp = splits.get(w.campaignId!)
    // Đã tách: số trong cảnh báo là của kỳ đang xem (phần lớn TRƯỚC lúc tách) — hiện tiến độ bản tách thay vì việc chưa làm.
    if (sp?.step === "created") { out.push({ id: `rec_split_${w.campaignId}`, priority: 2, title: t("libgoogle.sr.splitCreatedTitle", { name: name ?? "", newName: sp.name }), why: t("libgoogle.sr.splitCreatedWhy", { text: w.text }), moneyAtStake: w.money ?? null, action: { type: "split", campaignId: w.campaignId!, split: sp } }); continue }
    if (sp?.step === "moved") { out.push({ id: `rec_split_${w.campaignId}`, priority: 3, title: t("libgoogle.sr.splitMovedTitle", { name: name ?? "", newName: sp.name, day: sp.day != null ? t("libgoogle.sr.splitDay", { d: sp.day }) : "" }), why: t("libgoogle.sr.splitMovedWhy", { verdict: sp.verdict ? t("libgoogle.sr.splitVerdict", { v: sp.verdict }) : t("libgoogle.sr.splitNoCheckpoint") }), moneyAtStake: null, action: { type: "split", campaignId: w.campaignId!, split: sp } }); continue }
    out.push({ id: `rec_split_${w.campaignId}`, priority: 1, title: t("libgoogle.sr.splitTitle", { name: x.campaigns.find((c) => c.id === w.campaignId)?.name ?? "undefined" }), why: w.text, moneyAtStake: w.money ?? null, action: { type: "split", campaignId: w.campaignId! } })
  }
  const of = (k: SearchProposal["kind"]) => proposals.filter((p) => p.kind === k)
  const sum = (ps: SearchProposal[]) => ps.reduce((s, p) => s + (p.cost ?? 0), 0)
  const negs = of("neg_keyword")
  if (negs.length) out.push({ id: "rec_neg", priority: sum(negs) > 1_000_000 ? 1 : 2, title: t("libgoogle.sr.negTitle", { n: negs.length }), why: t("libgoogle.sr.negWhy", { money: vnd(sum(negs)) }), moneyAtStake: sum(negs), action: { type: "proposals", ids: negs.map((p) => p.id) } })
  const adds = of("add_keyword")
  if (adds.length) { const good = adds.filter((p) => p.defaultChecked); out.push({ id: "rec_add", priority: 2, title: t("libgoogle.sr.addTitle", { n: good.length || adds.length }), why: t("libgoogle.sr.addWhy", { all: adds.length, good: good.length }), moneyAtStake: null, action: { type: "proposals", ids: adds.map((p) => p.id) } }) }
  const pauses = of("pause_keyword")
  if (pauses.length) out.push({ id: "rec_pause", priority: 3, title: t("libgoogle.sr.pauseTitle", { n: pauses.length }), why: t("libgoogle.sr.pauseWhy", { money: vnd(sum(pauses)) }), moneyAtStake: sum(pauses), action: { type: "proposals", ids: pauses.map((p) => p.id) } })
  for (const w of x.warnings.filter((w) => w.id === "lost_rank"))
    out.push({ id: `rec_rank_${w.campaignId}`, priority: 3, title: t("libgoogle.sr.rankTitle"), why: w.text, moneyAtStake: null, action: { type: "manual", steps: [t("libgoogle.sr.rankStep1"), t("libgoogle.sr.rankStep2"), t("libgoogle.sr.rankStep3")] } })
  for (const w of x.warnings.filter((w) => w.id === "competitor_spend"))
    if (!negs.some((p) => p.campaignId === w.campaignId)) out.push({ id: `rec_comp_${w.campaignId}`, priority: 2, title: t("libgoogle.sr.compTitle"), why: w.text, moneyAtStake: w.money ?? null, action: { type: "manual", steps: [t("libgoogle.sr.compStep1")] } })
  return out.sort((a, b) => a.priority - b.priority || (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0))
}
