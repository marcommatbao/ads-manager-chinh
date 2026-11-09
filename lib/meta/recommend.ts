// ============================================================
// Đợt 12 (D) — "Việc nên làm" Meta: từ X-quang → mở phiên xử lý đúng chiến dịch / sửa đo lường (HÀM THUẦN)
// ============================================================
// Việc GHI đi qua phiên /xu-ly có sẵn (Kiểm trước → xác nhận → đọc lại → hoàn tác): nguyên nhân "view-through-heavy" →
// tạo nhóm mới CHỈ tính lượt bấm 7 ngày; "opt-event-not-purchase" → nhóm mới tối ưu Mua hàng (Meta cấm sửa cả hai trên nhóm cũ).
import type { MetaXray } from "./xray"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export interface MetaRecommendation {
  id: string; priority: 1 | 2 | 3; title: string; why: string; moneyAtStake: number | null
  action: { type: "open_case"; campaignId: string; campaignName: string } | { type: "link"; href: string; label: string } | { type: "manual"; steps: string[] }
}
const vnd = (n: number, t: TFunction) => `₫${Math.round(n).toLocaleString(t("libmeta.numLocale"))}`
export const CASE_MIN_SPEND = 1_000_000

export function recommendMeta(x: Pick<MetaXray, "campaigns" | "warnings" | "totals">, t: TFunction = makeT("vi")): MetaRecommendation[] {
  const out: MetaRecommendation[] = []
  for (const c of x.campaigns.filter((c) => c.flags.length && c.spend >= CASE_MIN_SPEND)) {
    const view = c.viewShare != null && c.purchases >= 10 && c.viewShare >= 0.6
    const opt = !!c.optEvent && c.optEvent !== "PURCHASE" && c.optEvent !== "LEAD"
    if (!view && !opt) continue
    out.push({ id: `rec_case_${c.id}`, priority: view ? 1 : 2, moneyAtStake: c.spend,
      title: view ? t("libmeta.rec.caseTitleView", { name: c.name, pct: Math.round((c.viewShare ?? 0) * 100) }) : t("libmeta.rec.caseTitleOpt", { name: c.name, label: c.optEventLabel ?? "" }),
      why: t("libmeta.rec.caseWhy", { flags: c.flags.join(" · "), opt: opt ? t("libmeta.rec.caseWhyOpt") : "", view: view && c.includesView ? t("libmeta.rec.caseWhyView") : "" }),
      action: { type: "open_case", campaignId: c.id, campaignName: c.name } })
  }
  if (x.warnings.some((w) => w.id === "utm_source_chaos") || x.campaigns.some((c) => !c.utm.length && c.spend >= CASE_MIN_SPEND))
    out.push({ id: "rec_utm", priority: 2, moneyAtStake: null, title: t("libmeta.rec.utmTitle"), why: t("libmeta.rec.utmWhy", { warn: x.warnings.find((w) => w.id === "utm_source_chaos")?.text ?? "" }).trim(), action: { type: "link", href: "/do-luong?tab=tags", label: t("libmeta.rec.utmLabel") } })
  if (x.totals.purchases >= 20 && x.totals.view / Math.max(x.totals.purchases, 1) >= 0.6)
    out.push({ id: "rec_report", priority: 3, moneyAtStake: null, title: t("libmeta.rec.reportTitle"), why: t("libmeta.rec.reportWhy", { cpaAll: vnd(x.totals.spend / Math.max(x.totals.purchases, 1), t), cpaClick: x.totals.click ? vnd(x.totals.spend / x.totals.click, t) : "—" }),
      action: { type: "manual", steps: [t("libmeta.rec.step1"), t("libmeta.rec.step2"), t("libmeta.rec.step3")] } })
  return out.sort((a, b) => a.priority - b.priority || (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0))
}
