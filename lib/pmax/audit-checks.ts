// Đợt 10a · F2 — kiểm tra PMax trong Google Audit, dùng CHUNG dữ liệu X-quang (hàm thuần).
// Trước đây audit engine chỉ chấm Search; PMax chỉ có điểm riêng trong PMax Insights → hai nơi có thể nói trái nhau.
import type { AuditCheck } from "@/lib/google-audit-engine"
import type { PmaxXray } from "./xray"
import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

type Status = AuditCheck["status"]
const pct = (x: number) => `${Math.round(x * 100)}%`

export function pmaxAuditChecks(x: PmaxXray | null, readError: string | null, t: TFunction = viT): AuditCheck[] {
  const base = { fixable: false }
  if (!x) return ["pmax_engaged_view", "pmax_brand_share", "pmax_asset_groups"].map((id) => ({
    ...base, id, name: id, description: "PMax", score: 0, status: "WARNING" as Status, recommendation: t("libgoogle.pac.noData"), dataStatus: "UNREADABLE" as const, dataNote: readError ?? undefined,
  }))
  if (!x.account.totals.cost && !x.assetGroups.length) return [] // tài khoản không chạy PMax → không chấm
  const partial = x.errors.length ? { dataStatus: "PARTIAL" as const, dataNote: x.errors.join(" · ") } : { dataStatus: "OK" as const }
  const out: AuditCheck[] = []

  // 1. Kênh ăn tiền nhờ đơn sau lượt xem
  {
    const bad = x.account.warnings.filter((w) => w.level === "bad")
    const tot = x.account.totals, conv = tot.convClick + tot.convEngaged
    const engaged = conv ? tot.convEngaged / conv : 0
    let score = 9, status: Status = "PASS", rec = t("libgoogle.pac.engagedOk", { pct: pct(1 - engaged) })
    if (bad.length) { score = 3; status = "FAIL"; rec = bad.map((w) => w.text).join(" ") }
    else if (engaged >= 0.5) { score = 6; status = "WARNING"; rec = t("libgoogle.pac.engagedWarn", { pct: pct(engaged) }) }
    out.push({ ...base, ...partial, id: "pmax_engaged_view", name: t("libgoogle.pac.engagedName"), description: t("libgoogle.pac.engagedDesc"), score, status, recommendation: rec })
  }
  // 2. PMax ăn lượt tìm thương hiệu / trùng Search
  {
    const c = x.cannibalization
    let score = 9, status: Status = "PASS", rec = t("libgoogle.pac.brandOk", { pct: pct(c.brandShare) })
    if (c.pmaxClicks < 30) { score = 7; status = "PASS"; rec = t("libgoogle.pac.brandFew") }
    else if (c.brandShare >= 0.4) { score = 4; status = "FAIL"; rec = t("libgoogle.pac.brandFail", { pct: pct(c.brandShare), ov: c.overlapClicks, all: c.pmaxClicks }) }
    else if (c.brandShare >= 0.2) { score = 6; status = "WARNING"; rec = t("libgoogle.pac.brandWarn", { pct: pct(c.brandShare) }) }
    out.push({ ...base, ...partial, id: "pmax_brand_share", name: t("libgoogle.pac.brandName"), description: t("libgoogle.pac.brandDesc"), score, status, recommendation: rec })
  }
  // 3. Asset group
  {
    const ags = x.assetGroups
    const weak = ags.filter((a) => a.adStrength === "POOR" || a.adStrength === "AVERAGE")
    const blocked = ags.filter((a) => a.status === "NOT_ELIGIBLE" || a.status === "LIMITED")
    let score = 9, status: Status = "PASS", rec = t("libgoogle.pac.agOk", { n: ags.length })
    if (!ags.length) { score = 5; status = "WARNING"; rec = t("libgoogle.pac.agNone") }
    else if (blocked.length) { score = 4; status = "FAIL"; rec = t("libgoogle.pac.agBlocked", { n: blocked.length, list: blocked.slice(0, 4).map((a) => `${a.campaignName} › ${a.name} (${a.status})`).join("; ") }) }
    else if (weak.length) { score = 6; status = "WARNING"; rec = t("libgoogle.pac.agWeak", { n: weak.length, all: ags.length, list: weak.slice(0, 4).map((a) => `${a.name} (${a.adStrength})`).join("; ") }) }
    out.push({ ...base, ...partial, id: "pmax_asset_groups", name: t("libgoogle.pac.agName"), description: t("libgoogle.pac.agDesc"), score, status, recommendation: rec })
  }
  return out
}
