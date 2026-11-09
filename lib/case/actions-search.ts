// ============================================================
// Bước 5 — từ nguyên nhân ra việc cụ thể (Google Search)
// ============================================================
// Chỉ đề xuất việc tool GHI ĐƯỢC (danh mục trong store.ts). Việc ngoài danh
// mục → việc giao người, không dựng nút "Áp ngay" giả (luật đúc 23/09).
// Mặc định an toàn: thêm phủ định được chọn sẵn (đã mô phỏng); bỏ phủ định và
// dừng chiến dịch KHÔNG chọn sẵn — người duyệt phải tự tick.

import { intentOf, type IntentLexicon } from "./intent"
import { stripDiacritics, tokens } from "./text"
import { asNeg, pickSharedList, riskyMembers } from "./actions-pmax"
import { blocks, simulateNegatives, withAccentVariants, type NegativeKw, type SplitRoute } from "./simulate-negatives"
import { isBrandCampaign } from "./causes-search"
import type { CaseAction, ManualTask } from "./store"
import type { Diagnosis, SearchEvidence } from "./types"
import type { Verdict } from "./verdict"
import { makeT, type TFunction } from "@/lib/i18n/translate"

/** Gói phủ định mặc định (bản cũ, viết cho hoá đơn điện tử — matbao.in). Đã duyệt 25/09.
 *  Gói Mắt Bão nay lấy theo công ty: `negativePacksFor` (MBC KHÔNG được phủ định "tên miền"/"tra cứu"). */
export const NEGATIVE_PACKS: Record<"competitor" | "lookup" | "own_other", string[]> = {
  competitor: ["misa", "meinvoice", "easyinvoice", "easy invoice", "viettel", "sinvoice", "vinvoice", "bkav", "ehoadon", "e hoadon", "vnpt", "minvoice", "m invoice", "fpt", "cyberbill", "htinvoice", "goinvoice", "sapo", "trungnguyen", "kiotviet", "softdreams", "wininvoice", "win hóa đơn", "vininvoice", "safeinvoice", "saveinvoice", "save invoice", "hilo", "vĩnh hy", "ihoadon", "ihoadondientu", "ehoadondientu", "laphoadon", "evan", "smartca", "ica"],
  lookup: ["tra cứu", "tracuu", "tracuuhoadon", "hoadondientu", "gdt", "https", "http", "www", "com vn", "tổng đài", "đăng nhập", "login"],
  own_other: ["domain", "tên miền", "google workspace", "hosting"],
}

export type PackName = keyof typeof NEGATIVE_PACKS

/** Gói phủ định theo công ty của chiến dịch (bảng sản phẩm); không có bảng → gói cũ. */
export function negativePacksFor(lex: IntentLexicon): Record<PackName, string[]> {
  return lex.catalog?.negatives ?? NEGATIVE_PACKS
}

const packLabel = (p: PackName, lex: IntentLexicon, t: TFunction) =>
  p === "competitor" ? t("libcase.c.as.packCompetitor") : p === "lookup" ? t("libcase.c.as.packLookup") : t("libcase.c.as.packOther", { site: lex.catalog?.sibling.site ?? t("libcase.c.as.otherCompany") })

/**
 * Bỏ phủ định sẽ chặn (1) từ khoá ĐANG BẬT của chính chiến dịch (trừ tên đối thủ), (2) ở chiến dịch thương hiệu:
 * lượt tìm có tên thương hiệu. Đo 19/10: gói cũ phủ định "tên miền" trong chiến dịch tên miền. HÀM THUẦN.
 */
export function guardNegatives(negatives: NegativeKw[], ev: Pick<SearchEvidence, "campaign" | "keywords" | "searchTerms">, lex: IntentLexicon, t: TFunction = makeT("vi")): { kept: NegativeKw[]; dropped: { text: string; why: string }[] } {
  // Chỉ bảo vệ từ khoá SẢN PHẨM (+ từ khoá thương hiệu ở chiến dịch thương hiệu). Từ khoá tra cứu / thương hiệu nằm trong
  // chiến dịch sản phẩm ("matbao login" trong Search HĐĐT) là đúng thứ gói phủ định muốn chặn — phương án duyệt 25/09.
  const brandCamp = isBrandCampaign(ev.campaign.name)
  const ownKws = ev.keywords.filter((k) => {
    if (k.status !== "ENABLED") return false
    const it = intentOf(k.text, lex)
    return it === "own_brand" ? brandCamp : !["competitor", "lookup", "own_other"].includes(it)
  })
  const brandTerms = brandCamp ? ev.searchTerms.filter((t) => intentOf(t.term, lex) === "own_brand") : []
  const kept: NegativeKw[] = []
  const dropped: { text: string; why: string }[] = []
  for (const n of negatives) {
    // So trên chữ bỏ dấu: phủ định "ten mien" vẫn chặn lượt tìm không dấu mà từ khoá "tên miền" đang nhận.
    const kw = ownKws.find((k) => blocks(stripDiacritics(k.text), { text: stripDiacritics(n.text), match: "PHRASE" }))
    if (kw) { dropped.push({ text: n.text, why: t("libcase.c.as.dropKw", { kw: kw.text }) }); continue }
    const bt = brandTerms.find((t) => blocks(t.term, n))
    if (bt) { dropped.push({ text: n.text, why: t("libcase.c.as.dropBrand", { term: bt.term }) }); continue }
    kept.push(n)
  }
  return { kept, dropped }
}

/**
 * Phủ định có thể đang chặn người MUA: có chữ "mua" và không mang nghĩa gian lận.
 * Cố ý hẹp — đề xuất bỏ phủ định mà sai (vd bỏ "hóa đơn giả") là mở cửa cho đúng
 * loại lượt tìm cần chặn. Đo 26/09: luật rộng hơn (theo intentOf) từng chọn nhầm "hóa đơn giả".
 */
export function blocksBuyers(negText: string): boolean {
  const t = tokens(negText)
  return t.includes("mua") && !t.some((w) => ["khống", "giả", "lậu", "bán", "khong", "gia", "lau", "ban"].includes(w))
}

let seq = 0
const aid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`

export function proposeSearchActions(input: {
  evidence: SearchEvidence
  diagnosis: Diagnosis
  verdict: Verdict
  lexicon: IntentLexicon
  /** Chiến dịch này là gốc của một bản tách "· Chung" — lượt tìm chung bị chặn ở đây sẽ CHUYỂN sang đó, không mất. */
  split?: SplitRoute
}, t: TFunction = makeT("vi")): { actions: CaseAction[]; manualTasks: Omit<ManualTask, "id" | "createdAt">[] } {
  const { evidence: ev, diagnosis: dx, lexicon, split } = input
  const has = (id: string) => dx.causes.some((c) => c.id === id)
  const PACKS = negativePacksFor(lexicon)
  const actions: CaseAction[] = []
  const manualTasks: Omit<ManualTask, "id" | "createdAt">[] = []

  // Phủ định: chỉ lấy gói ứng với nguyên nhân thật sự có mặt.
  const packs: PackName[] = []
  if (has("competitor-spend") || ev.keywords.some((k) => k.status === "ENABLED" && intentOf(k.text, lexicon) === "competitor")) packs.push("competitor")
  if (has("lookup") || has("existing-customer")) packs.push("lookup")
  if (has("other-product")) packs.push("own_other")
  if (packs.length) {
    const present = new Set(ev.negatives.map((n) => n.text.toLowerCase()))
    const { kept: negatives, dropped } = guardNegatives(
      withAccentVariants(packs.flatMap((p) => PACKS[p]).map((text) => ({ text, match: "PHRASE" as const }))).filter((n) => !present.has(n.text)),
      ev, lexicon, t)
    if (negatives.length) {
      const simulation = simulateNegatives(ev.searchTerms, negatives, ev.keywords, split && { ...split, lexicon })
      actions.push({
        // Bản "· Chung" chưa nhận lượt tìm (chưa chuyển từ khoá) → phần "chuyển" chưa chắc → không chọn sẵn.
        id: aid("neg"), type: "ADD_NEGATIVES", selected: simulation.blockedConversions === 0 && (!simulation.moved?.conversions || simulation.moved.live),
        label: t("libcase.c.as.negLabel", { n: negatives.length, packs: packs.map((p) => packLabel(p, lexicon, t)).join(", ") }),
        campaignIds: [ev.campaign.id], negatives, simulation, ...(dropped.length ? { dropped } : {}),
      })
    }
  }

  // Danh sách dùng chung chưa gắn → đề xuất gắn (mô phỏng cả từ khoá đang bật bị chặn theo).
  const list = pickSharedList(ev.sharedLists)
  if (list && !list.attached && list.members.length) {
    const simulation = simulateNegatives(ev.searchTerms, list.members.map(asNeg), ev.keywords, split && { ...split, lexicon })
    // Từ khoá ĐANG BẬT của chính chiến dịch (không phải tên đối thủ) bị list chặn theo → cũng là cờ.
    // Đo 27/09: gắn "Blacklist" vào Search HĐĐT Phần 2 chặn theo “hóa đơn điện tử thông tư 78” (bởi “thông tư”).
    const ownHit = simulation.ownKeywordsBlocked.filter((k) => intentOf(k.text, lexicon) !== "competitor")
    const flagged = [...riskyMembers(list, t), ...ownHit.map((k) => t("libcase.c.as.flagOwn", { by: k.by, kw: k.text }))]
    actions.push({
      id: aid("attach"), type: "ATTACH_SHARED_LIST", campaignId: ev.campaign.id, sharedSetId: list.id, sharedSetName: list.name,
      selected: simulation.blockedConversions === 0 && flagged.length === 0, simulation, flagged,
      label: t("libcase.c.as.attachLabel", { name: list.name, n: list.members.length }),
    })
  }

  // Phủ định đang chặn nhầm người có ý định mua.
  for (const n of ev.negatives) {
    if (!blocksBuyers(n.text)) continue
    actions.push({
      id: aid("rmneg"), type: "REMOVE_NEGATIVE", selected: false, campaignId: ev.campaign.id, text: n.text, match: n.match,
      label: t("libcase.c.as.rmNeg", { text: n.text }),
    })
  }

  // Dừng: chỉ đề xuất khi đỏ vì 0 đơn; không chọn sẵn.
  if (input.verdict.status === "red" && ev.campaign.orders === 0 && ev.campaign.status === "ENABLED") {
    actions.push({ id: aid("pause"), type: "PAUSE_CAMPAIGN", selected: false, campaignId: ev.campaign.id, label: t("libcase.c.as.pause", { name: ev.campaign.name }) })
  }

  const lowqs = dx.causes.find((c) => c.id === "broad-lowqs")
  if (lowqs) {
    manualTasks.push({ title: t("libcase.c.as.task1.title"), detail: t("libcase.c.as.task1.detail", { title: lowqs.title, ev: lowqs.evidence.map((e) => e.label).join("; "), detail: lowqs.detail }), assignee: null, status: "open" })
  }
  if (dx.causes.some((c) => c.id === "measurement-unverified" || c.id === "goal-not-purchase")) {
    manualTasks.push({ title: t("libcase.c.as.task2.title"), detail: t("libcase.c.as.task2.detail"), assignee: null, status: "open" })
  }
  return { actions, manualTasks }
}
