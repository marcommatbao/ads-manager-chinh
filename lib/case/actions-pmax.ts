// ============================================================
// Bước 5 cho Pmax — ba việc tool ghi được (chốt với user 26/09)
// ============================================================
//   1. Thêm từ đối thủ / tra cứu / sản phẩm khác CÒN THIẾU vào danh sách phủ
//      định dùng chung (mặc định "Blacklist") — list dùng chung nên Search gắn
//      list sau này cũng hưởng.
//   2. Gắn danh sách đó vào chiến dịch Pmax (đo 26/09: "Blacklist" 241 từ chỉ
//      từng gắn vào 14 chiến dịch Search ĐÃ DỪNG, không Pmax nào dùng).
//   3. Phủ định THƯƠNG HIỆU chỉ ở cấp chiến dịch Pmax — KHÔNG đưa vào list dùng
//      chung, để không chặn nhầm nếu sau này có chiến dịch Search thương hiệu.
// Việc nào mô phỏng thấy chặn đơn mua → không chọn sẵn.

import { negativePacksFor } from "./actions-search"
import { mentionsBrand, type IntentLexicon } from "./intent"
import { blocks, simulateNegatives, withAccentVariants, type NegativeKw, type NegMatch } from "./simulate-negatives"
import type { CaseAction, ManualTask } from "./store"
import { tokens } from "./text"
import type { Diagnosis, SearchEvidence, SharedNegativeList } from "./types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

/** Thương hiệu mình — chỉ dùng làm phủ định cấp chiến dịch Pmax. */
export const BRAND_PACK = ["matbao", "mắt bão", "mắt bảo", "mắt bao", "mat bão", "matbao in", "mifi"]
/** Tên danh sách dùng chung ưu tiên; không có thì lấy list nhiều từ nhất. */
export const PREFERRED_LIST = "Blacklist"

let seq = 0
const aid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`
const norm = (t: string) => tokens(t).join(" ")
export const asNeg = (m: { text: string; match: string }): NegativeKw => ({ text: m.text, match: (m.match === "EXACT" || m.match === "BROAD" ? m.match : "PHRASE") as NegMatch })

export function pickSharedList(lists: SharedNegativeList[] | undefined): SharedNegativeList | null {
  if (!lists?.length) return null
  return lists.find((l) => l.name.trim().toLowerCase() === PREFERRED_LIST.toLowerCase())
    ?? [...lists].sort((a, b) => b.members.length - a.members.length)[0]
}

/**
 * Câu tìm điển hình của NGƯỜI MUA (hoá đơn / chữ ký số / hợp đồng điện tử).
 * Một từ trong list dùng chung chặn được câu nào ở đây → gắn cờ cho người duyệt.
 * Cách cũ (đoán theo ý định của chính từ đó) đo 26/09 gắn cờ nhầm cả tên riêng
 * như "vinaphone", "vinamilk".
 */
export const BUYER_PROBES = [
  "mua hóa đơn điện tử", "bảng giá hóa đơn điện tử", "giá hóa đơn điện tử", "phần mềm hóa đơn điện tử",
  "dịch vụ hóa đơn điện tử", "đăng ký hóa đơn điện tử", "thủ tục đăng ký hóa đơn điện tử",
  "tìm nhà cung cấp hóa đơn điện tử", "tìm hiểu hóa đơn điện tử cho doanh nghiệp", "thông tin hóa đơn điện tử",
  "triển khai hóa đơn điện tử", "hóa đơn điện tử cho hộ kinh doanh", "xuất hóa đơn điện tử",
  "mua chữ ký số", "bảng giá chữ ký số", "đăng ký chữ ký số", "gia hạn chữ ký số", "thời hạn chữ ký số",
  "chữ ký số cá nhân", "chữ ký số doanh nghiệp", "hợp đồng điện tử", "phần mềm hợp đồng điện tử",
  "ký hợp đồng điện tử", "thiết kế mẫu hóa đơn điện tử", "thông báo phát hành hóa đơn điện tử",
  "mua hoa don dien tu", "bang gia chu ky so", "dang ky hoa don dien tu", "tim nha cung cap hoa don dien tu",
]

/** Từ (không phải EXACT) trong list chặn được câu tìm của người mua — kèm câu bị chặn làm bằng chứng. */
export function riskyMembersDetailed(list: SharedNegativeList): { text: string; match: string; probe: string }[] {
  const out: { text: string; match: string; probe: string }[] = []
  for (const m of list.members) {
    if (m.match === "EXACT") continue
    const hit = BUYER_PROBES.find((q) => blocks(q, asNeg(m)))
    if (hit) out.push({ text: m.text, match: m.match, probe: hit })
  }
  return out
}

export function riskyMembers(list: SharedNegativeList, t: TFunction = makeT("vi")): string[] {
  return riskyMembersDetailed(list).map((r) => t("libcase.c.ap.risky", { text: r.text, probe: r.probe }))
}

export function proposePmaxActions(input: {
  evidence: SearchEvidence
  diagnosis: Diagnosis
  lexicon: IntentLexicon
}, t: TFunction = makeT("vi")): { actions: CaseAction[]; manualTasks: Omit<ManualTask, "id" | "createdAt">[] } {
  const { evidence: ev, diagnosis: dx, lexicon } = input
  const actions: CaseAction[] = []
  const manualTasks: Omit<ManualTask, "id" | "createdAt">[] = []
  const campaignNegs = new Set(ev.negatives.map((n) => norm(n.text)))
  const list = pickSharedList(ev.sharedLists)
  // 19/10: gói theo công ty — PMax tên miền (MBC) không được phủ định "tên miền" / "tra cứu".
  const PACKS = negativePacksFor(lexicon)
  const otherLabel = t("libcase.c.ap.other", { site: lexicon.catalog?.sibling.site ?? t("libcase.c.as.otherCompany") })

  // 1 + 2: danh sách dùng chung (0: bỏ từ rủi ro trước — user chốt 26/09 phương án "bỏ 7 từ rồi mới gắn")
  if (list) {
    const risky = riskyMembersDetailed(list)
    const riskyKeys = new Set(risky.map((r) => `${r.match}|${norm(r.text)}`))
    if (risky.length) {
      actions.push({
        id: aid("shrm"), type: "REMOVE_FROM_SHARED_LIST", sharedSetId: list.id, sharedSetName: list.name, selected: true,
        words: risky.map(({ text, match }) => ({ text, match })),
        reasons: risky.map((r) => t("libcase.c.ap.risky", { text: r.text, probe: r.probe })),
        label: t("libcase.c.ap.shrm", { n: risky.length, name: list.name }),
      })
    }
    const inList = new Set(list.members.map((m) => norm(m.text)))
    const packWords = withAccentVariants([...PACKS.competitor, ...PACKS.lookup, ...PACKS.own_other]
      .map((text) => ({ text, match: "PHRASE" as const })))
      .filter((n) => !inList.has(norm(n.text)))
    if (packWords.length) {
      const simulation = simulateNegatives(ev.searchTerms, packWords)
      actions.push({
        id: aid("shadd"), type: "ADD_TO_SHARED_LIST", sharedSetId: list.id, sharedSetName: list.name,
        selected: simulation.blockedConversions === 0, negatives: packWords, simulation,
        label: t("libcase.c.ap.shadd", { n: packWords.length, other: otherLabel, name: list.name }),
      })
    }
    if (!list.attached) {
      // Mô phỏng list SAU khi bỏ từ rủi ro + bổ sung từ thiếu — đó mới là thứ sẽ chặn.
      const kept = list.members.filter((m) => !riskyKeys.has(`${m.match}|${norm(m.text)}`))
      const simulation = simulateNegatives(ev.searchTerms, [...kept.map(asNeg), ...packWords])
      actions.push({
        id: aid("attach"), type: "ATTACH_SHARED_LIST", campaignId: ev.campaign.id, sharedSetId: list.id, sharedSetName: list.name,
        // Từ rủi ro đã có việc "bỏ" chọn sẵn phía trên → gắn được chọn sẵn; `flagged` vẫn giữ để
        // người duyệt thấy nếu bỏ tick việc kia.
        selected: simulation.blockedConversions === 0, simulation, flagged: risky.map((r) => t("libcase.c.ap.risky", { text: r.text, probe: r.probe })),
        label: t("libcase.c.ap.attach", { name: list.name, n: kept.length + packWords.length, after: risky.length ? t("libcase.c.ap.attachAfter", { n: risky.length }) : "" }),
      })
    }
  } else {
    // Không có list dùng chung → thêm thẳng vào chiến dịch như Đợt 1.
    const negatives = withAccentVariants([...PACKS.competitor, ...PACKS.lookup, ...PACKS.own_other]
      .map((text) => ({ text, match: "PHRASE" as const }))).filter((n) => !campaignNegs.has(norm(n.text)))
    if (negatives.length) {
      const simulation = simulateNegatives(ev.searchTerms, negatives)
      actions.push({ id: aid("neg"), type: "ADD_NEGATIVES", campaignIds: [ev.campaign.id], negatives, simulation, selected: simulation.blockedConversions === 0,
        label: t("libcase.c.ap.neg", { n: negatives.length, other: otherLabel }) })
    }
  }

  // 3: thương hiệu — chỉ cấp chiến dịch, chỉ khi Pmax thật sự tốn tiền cho lượt tìm thương hiệu.
  const brandSpend = ev.searchTerms.filter((t) => mentionsBrand(t.term, lexicon)).reduce((s, t) => s + t.cost, 0)
  if (brandSpend > 0) {
    const brand = withAccentVariants(BRAND_PACK.map((text) => ({ text, match: "PHRASE" as const }))).filter((n) => !campaignNegs.has(norm(n.text)))
    if (brand.length) {
      const simulation = simulateNegatives(ev.searchTerms, brand)
      actions.push({
        id: aid("brand"), type: "ADD_NEGATIVES", campaignIds: [ev.campaign.id], negatives: brand, simulation,
        selected: simulation.blockedConversions === 0,
        label: t("libcase.c.ap.brand", { n: brand.length }),
      })
    }
  }

  if (dx.causes.some((c) => c.id === "pmax-search-no-orders")) {
    manualTasks.push({
      title: t("libcase.c.ap.task.title"),
      detail: t("libcase.c.ap.task.detail"),
      assignee: null, status: "open",
    })
  }
  return { actions, manualTasks }
}
