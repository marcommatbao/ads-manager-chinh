// Dịch phiên xử lý khi ĐỌC (route API) — phiên lưu trong data/ nên chữ đã lưu có thể khác ngôn ngữ người xem.
//   - Chẩn đoán (nguyên nhân bước 4) là hàm THUẦN của bằng chứng + mục tiêu đã lưu → dựng lại theo ngôn ngữ người xem.
//   - Nhãn nguồn dữ liệu của bằng chứng → dịch theo id nguồn.
//   - Việc đề xuất / việc giao người / bảng đọc lại / báo cáo hoàn tác là chữ viết lúc ghi (theo ngôn ngữ người bấm) → giữ nguyên.
import type { MessageKey } from "@/lib/i18n/messages"
import type { TFunction } from "@/lib/i18n/translate"
import { diagnoseMeta } from "./causes-meta"
import { diagnoseSearch } from "./causes-search"
import { evidenceGoalKind } from "./goal-kind"
import type { CampaignCase } from "./store"
import { lexiconFor } from "./targets"

const SRC_IDS = new Set([
  "campaign", "convByAction", "goals", "searchTerms", "keywords", "negatives", "ads", "landing", "landingAccount", "network",
  "sharedSets", "sharedMembers", "campaignSharedSets", "structure", "insights", "placements", "odoo", "peers", "pixel",
])
const srcKey = (id: string) => `libcase.s.src.${id}` as MessageKey

/** Nhãn nguồn dữ liệu theo id; id lạ giữ nhãn đã lưu. */
export function sourceLabel(id: string, stored: string, t: TFunction): string {
  return SRC_IDS.has(id) ? t(srcKey(id)) : stored
}

export function localizeCase<T extends CampaignCase>(c: T, t: TFunction): T {
  let out: T = c
  if (c.evidence) {
    const ev = c.evidence
    const sources = ev.sources.map((s) => ({ ...s, label: sourceLabel(s.id, s.label, t) }))
    out = { ...out, evidence: { ...ev, sources } as typeof ev }
    if (c.goal && c.diagnosis) {
      try {
        const diagnosis = ev.kind === "meta"
          ? diagnoseMeta(ev, t)
          : diagnoseSearch(ev, { lexicon: lexiconFor(c.company), ceilingCpa: c.goal.basis === "roas" ? null : c.goal.ceiling, goalKind: evidenceGoalKind(ev) }, t)
        out = { ...out, diagnosis }
      } catch { /* giữ chẩn đoán đã lưu */ }
    }
  }
  return out
}
