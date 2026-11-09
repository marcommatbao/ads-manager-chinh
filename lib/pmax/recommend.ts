// ============================================================
// Đợt 10b — "VIỆC NÊN LÀM" cho PMax: từ X-quang + đề xuất kiểm soát → danh sách ưu tiên có nút áp dụng
// ============================================================
// User 28/09: X-quang không chỉ chẩn đoán mà phải nói NÊN LÀM GÌ, làm được ngay (và tự động được). Mỗi việc gắn
// với các ControlProposal (áp dụng qua lib/pmax/controls.ts: Kiểm trước → XAC NHAN → ghi → đọc lại → hoàn tác).
// Việc Google API KHÔNG cho làm (đổi cửa sổ engaged-view) → ghi rõ bước làm tay + thí nghiệm ở 10c. Hàm thuần.

import type { ControlKind, ControlProposal } from "./controls"
import type { PmaxXray } from "./xray"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, vndT, tk } from "@/lib/google-i18n"

export interface Recommendation {
  id: string
  priority: 1 | 2 | 3
  title: string
  why: string
  /** Ước tính ₫/kỳ đang chảy vào chỗ việc này chặn (chỉ tính phần đo được). */
  moneyAtStake: number | null
  proposalIds: string[]
  /** Loại việc tự động được (bật ở "Tự động"). */
  autoKind: AutoKind | null
  manualSteps?: string[]
}
export type AutoKind = "neg_competitor" | "placement_apps" | "webpage_zero_conv"
export const AUTO_KIND_LABEL: Record<AutoKind, string> = {
  neg_competitor: "Phủ định lượt tìm tên đối thủ có bấm mà 0 đơn",
  placement_apps: "Loại app di động khỏi PMax (cấp tài khoản)",
  webpage_zero_conv: "Loại trang Google tự mở rộng tới mà 0 đơn",
}
export const autoKindLabel = (k: AutoKind, t: TFunction = viT): string => tk(t, `libgoogle.pr.auto.${k}`)
/** Việc nào thuộc loại tự động nào — chỉ các việc ít rủi ro; KHÔNG tự động loại thương hiệu / tắt mở rộng URL. */
export function autoKindOf(p: ControlProposal): AutoKind | null {
  if (p.kind === "neg_keyword" && (p.tag === "competitor" || p.why.startsWith("Tên đối thủ"))) return "neg_competitor"
  if (p.kind === "placement_exclusion" && p.payload.placementType === "MOBILE_APPLICATION") return "placement_apps"
  if (p.kind === "webpage_exclusion") return "webpage_zero_conv"
  return null
}

export function recommend(x: Pick<PmaxXray, "account" | "campaigns" | "terms" | "cannibalization" | "assetGroups">, proposals: ControlProposal[], t: TFunction = viT): Recommendation[] {
  const vnd = (n: number) => vndT(t, n)
  const out: Recommendation[] = []
  const of = (k: ControlKind, f: (p: ControlProposal) => boolean = () => true) => proposals.filter((p) => p.kind === k && f(p))
  const sumCost = (ps: ControlProposal[]) => ps.reduce((s, p) => s + (p.cost ?? 0), 0)

  // 1. Kênh ăn tiền nhờ đơn sau lượt xem (YouTube MBC) — API không cho đổi → làm tay + thí nghiệm.
  for (const w of x.account.warnings.filter((w) => w.level === "bad" && w.id.startsWith("engaged_"))) {
    const ch = x.account.channels.find((c) => `engaged_${c.network}` === w.id)
    out.push({ id: `rec_${w.id}`, priority: 1, title: t("libgoogle.pr.engagedTitle", { label: ch?.label ?? t("libgoogle.pr.channelFallback"), share: Math.round((ch?.costShare ?? 0) * 100) }),
      why: w.text, moneyAtStake: ch?.cost ?? null, proposalIds: [], autoKind: null,
      manualSteps: [
        t("libgoogle.pr.engagedStep1"),
        t("libgoogle.pr.engagedStep2"),
        t("libgoogle.pr.engagedStep3"),
        t("libgoogle.pr.engagedStep4"),
      ] })
  }

  // 2. Phủ định đối thủ / tra cứu / hỏi cách làm
  const negs = of("neg_keyword")
  if (negs.length) {
    const money = sumCost(negs)
    const comp = negs.filter((p) => p.tag === "competitor" || p.why.startsWith("Tên đối thủ")).length
    out.push({ id: "rec_negatives", priority: money > 1_000_000 ? 1 : 2, title: t("libgoogle.pr.negTitle", { n: negs.length, comp }),
      why: t("libgoogle.pr.negWhy", { money: vnd(money) }),
      moneyAtStake: money, proposalIds: negs.map((p) => p.id), autoKind: comp ? "neg_competitor" : null })
  }

  // 3. Thương hiệu
  const brand = of("brand_negative")
  if (brand.length) {
    // Mỗi chiến dịch có nhiều dòng thương hiệu cùng một chi phí → chỉ cộng một lần/chiến dịch.
    const money = [...new Map(brand.map((b) => [b.campaignId, b.cost ?? 0])).values()].reduce((s, v) => s + v, 0)
    out.push({ id: "rec_brand", priority: brand.some((b) => b.defaultChecked) ? 1 : 3, title: t("libgoogle.pr.brandTitle", { n: new Set(brand.map((b) => b.campaignId)).size }),
      why: t("libgoogle.pr.brandWhy", { share: Math.round(x.cannibalization.brandShare * 100), money: vnd(money), warning: brand[0].warning ?? t("libgoogle.pr.brandWarnDefault") }),
      moneyAtStake: money, proposalIds: brand.map((p) => p.id), autoKind: null })
  }

  // 4. Trang Google tự mở rộng tới, 0 đơn
  const pages = of("webpage_exclusion")
  if (pages.length) {
    const money = sumCost(pages)
    out.push({ id: "rec_pages", priority: money > 1_000_000 ? 1 : 2, title: t("libgoogle.pr.pagesTitle", { n: pages.length }),
      why: t("libgoogle.pr.pagesWhy", { money: vnd(money) }), moneyAtStake: money, proposalIds: pages.map((p) => p.id), autoKind: "webpage_zero_conv" })
  }
  const urlOff = of("url_expansion_off")
  if (urlOff.length) out.push({ id: "rec_urlexp", priority: 2, title: t("libgoogle.pr.urlTitle", { n: urlOff.length }), why: urlOff.map((p) => `${p.campaignName}: ${p.why}`).join(" · "), moneyAtStake: null, proposalIds: urlOff.map((p) => p.id), autoKind: null })

  // 5. Vị trí
  const apps = of("placement_exclusion", (p) => p.payload.placementType === "MOBILE_APPLICATION")
  const others = of("placement_exclusion", (p) => p.payload.placementType !== "MOBILE_APPLICATION")
  if (apps.length) out.push({ id: "rec_apps", priority: 2, title: t("libgoogle.pr.appsTitle", { n: apps.length }),
    why: t("libgoogle.pr.appsWhy"), moneyAtStake: null, proposalIds: apps.map((p) => p.id), autoKind: "placement_apps" })
  if (others.length) out.push({ id: "rec_places", priority: 3, title: t("libgoogle.pr.placesTitle", { n: others.length }), why: t("libgoogle.pr.placesWhy"), moneyAtStake: null, proposalIds: others.map((p) => p.id), autoKind: null })

  // 5b. Độ tuổi (B5) — chỉ khi có bằng chứng rõ; không tự động.
  const ages = of("age_exclusion")
  if (ages.length) out.push({ id: "rec_age", priority: 3, title: t("libgoogle.pr.ageTitle", { n: new Set(ages.map((p) => p.payload.ageRange)).size }), why: ages[0].why, moneyAtStake: null, proposalIds: ages.map((p) => p.id), autoKind: null })

  // 6. Asset group bị hạn chế / yếu → việc làm tay (sáng tạo ở 10d)
  const limited = x.assetGroups.filter((a) => a.status === "LIMITED" || a.status === "NOT_ELIGIBLE")
  if (limited.length) out.push({ id: "rec_assets", priority: 2, title: t("libgoogle.pr.assetsTitle", { n: limited.length }), why: limited.map((a) => `${a.campaignName} › ${a.name} (${a.status})`).join(" · "), moneyAtStake: null, proposalIds: [], autoKind: null,
    manualSteps: [t("libgoogle.pr.assetsStep1"), t("libgoogle.pr.assetsStep2")] })

  return out.sort((a, b) => a.priority - b.priority || (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0))
}
