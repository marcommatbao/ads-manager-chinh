// ============================================================
// Sổ kinh nghiệm · 7b — đổi dòng trong Sổ thành GỢI Ý cho màn tạo chiến dịch
// ============================================================
// User chốt 27/09: dòng tin cậy CAO (và dòng người đã duyệt) → tool TỰ ĐIỀN;
// dòng trung bình → gợi ý có nút Thêm; "Nên tránh" → cảnh báo khi chọn trúng.
// Người dùng luôn sửa được — tool chỉ điền sẵn, không khoá.
//
// Wizard dùng mã sản phẩm kebab-case (ten-mien, hosting…) còn Sổ dùng nhãn
// PRODUCT_LABEL suy từ tên chiến dịch — hai hệ không có cầu nối (khảo sát
// 28/09) → bảng nối tường minh ở đây, không dựa vào đoán từ tên.

import type { Company } from "@/lib/case/types"
import { placementTarget, POSITION_FIELDS, type Targeting } from "@/lib/case/meta-placements"
import { stripDiacritics } from "@/lib/case/text"
import { resolveMatchType } from "@/lib/google-ads-helpers"
import type { Platform } from "./engine"
import { readPlaybook, type PlaybookEntry } from "./store"
import { withOutcomes } from "./outcomes"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { localizeEntryLabel, localizePlaybookNote } from "./localize"

export { PRODUCT_KEY_TO_LABEL, productLabelOf } from "./products"
import { productLabelOf } from "./products"

/** Sự kiện chuẩn mà ConversionEventPicker chọn được (pixelEvent = enum custom_event_type). */
const STANDARD_EVENTS = new Set(["PURCHASE", "ADD_PAYMENT_INFO", "INITIATED_CHECKOUT", "ADD_TO_CART", "LEAD", "COMPLETE_REGISTRATION", "CONTENT_VIEW", "CONTACT", "SUBMIT_APPLICATION", "SEARCH"])

export interface SuggestItem { entryId: string; label: string; why: string; confidence: "high" | "medium"; status: PlaybookEntry["status"]; note?: string }
export interface MetaSuggestions {
  /** Dải tuổi gộp từ các dòng tuổi đang dùng. */
  age: (SuggestItem & { min: number; max: number }) | null
  interests: (SuggestItem & { interests: { id: string; name: string }[] })[]
  /** pixelEvent = enum chuẩn (PURCHASE…); customEventName = sự kiện tự đặt (OTHER). */
  optEvent: (SuggestItem & { pixelEvent?: string; customEventName?: string }) | null
  placements: (SuggestItem & { key: string })[]
  content: (SuggestItem & { kind: string; text: string })[]
  budgetTier: (SuggestItem & { tier: string }) | null
}
export interface GoogleSuggestions {
  /** text = lượt tìm đầy đủ đại diện (dùng làm từ khoá PHRASE); theme = cụm gốc trong Sổ. */
  themes: (SuggestItem & { text: string; theme: string })[]
  keywords: (SuggestItem & { text: string; matchType: string })[]
  landings: (SuggestItem & { url: string })[]
  timing: (SuggestItem & { kind: string; value: string })[]
}
export interface Suggestions {
  company: Company; platform: Platform; product: string
  updatedAt: string | null
  /** Tự điền (auto + approved). */
  apply: { meta: MetaSuggestions; google: GoogleSuggestions }
  /** Gợi ý có nút Thêm (suggested). */
  suggest: { meta: MetaSuggestions; google: GoogleSuggestions }
  /** Nên tránh (mọi trạng thái trừ đã bỏ/hết hạn) — cảnh báo + phủ định Google. */
  avoid: SuggestItem[]
  /** Vị trí nên tránh — status auto/approved thì mặc định BỎ khi tạo; suggested thì chỉ cảnh báo. */
  avoidPlacements: { key: string; label: string; entryId: string; status: PlaybookEntry["status"]; why: string }[]
  /** Sự kiện tối ưu nên tránh — value là enum (PURCHASE…) hoặc "OTHER:<tên>". */
  avoidOptEvents: { value: string; label: string; entryId: string; status: PlaybookEntry["status"]; why: string }[]
  negatives: { entryId: string; text: string; why: string; status: PlaybookEntry["status"] }[]
  /** Số dòng tìm thương hiệu/khách cũ bị ẩn khỏi màn tạo chiến dịch. */
  hiddenNonIncremental: number
  /** Số dòng gộp bóc trước 7b bị bỏ qua (tự hết sau lượt bóc kế tiếp). */
  hiddenLegacyMerged: number
}

const vnd = (n: number | null, t: TFunction = makeT("vi")) => (n === null ? "—" : `₫${Math.round(n).toLocaleString(t("libcase.w.numLocale"))}`)
const METRIC_KEYS = { purchase: "libcase.w.why.metric.purchase", initiate_checkout: "libcase.w.why.metric.initiate_checkout", landing_view: "libcase.w.why.metric.landing_view" } as const
export function whyOf(e: PlaybookEntry, t: TFunction = makeT("vi")): string {
  const s = e.stat
  const metric = t(METRIC_KEYS[e.metric as keyof typeof METRIC_KEYS] ?? "libcase.w.why.metric.none")
  if (e.direction === "avoid") return t("libcase.w.why.avoid", { lose: s.loseUnits, cost: vnd(s.cost, t), metric })
  return t("libcase.w.why.use", { cpr: vnd(s.cpr, t), metric, lift: s.lift ?? "?", win: s.winUnits, camps: s.campaigns, agree: s.halvesAgree ? t("libcase.w.why.agree") : "" })
}
const item = (e: PlaybookEntry, t: TFunction = makeT("vi")): SuggestItem => ({ entryId: e.id, label: localizeEntryLabel(e.label, t), why: whyOf(e, t), confidence: e.confidence, status: e.status, ...(e.note ? { note: localizePlaybookNote(e.note, t) } : {}) })
const byStrength = (a: PlaybookEntry, b: PlaybookEntry) => (b.stat.lift ?? 0) - (a.stat.lift ?? 0)

/** Các đặc điểm con của một dòng (dòng gộp "a+b" có `parts`; dòng đơn thì chính nó). */
export const partsOf = (e: PlaybookEntry) => e.parts?.length ? e.parts : isLegacyMerged(e) ? [] : [{ value: e.value, label: e.label }]
/** Dòng gộp bóc TRƯỚC 7b (chưa có `parts`): mã đã sắp lại nên không ghép đúng mã ↔ tên được →
 *  bỏ qua cho tới lượt bóc kế tiếp (job hằng tuần) thay vì điền sở thích "600…+600…" hỏng. */
export const isLegacyMerged = (e: PlaybookEntry) => !e.parts?.length && (e.label.startsWith("Bộ sở thích") || e.label.includes(" + "))

/** Cụm tìm kiếm lưu KHÔNG dấu ("ten mien") — tìm lại bản có dấu trong các lượt tìm làm bằng chứng.
 *  Quan trọng cho từ PHỦ ĐỊNH: Google không khớp biến thể cho phủ định, "viec lam" không chặn "việc làm". */
export function accentedForm(theme: string, names: string[]): string | null {
  const n = theme.split(" ").length
  for (const name of names) {
    const w = name.split(/\s+/).filter(Boolean)
    for (let i = 0; i + n <= w.length; i++) {
      const cand = w.slice(i, i + n).join(" ")
      if (stripDiacritics(cand).replace(/[^a-z0-9 .]/g, "") === theme && cand.toLowerCase() !== theme) return cand.toLowerCase()
    }
  }
  return null
}
/** Lượt tìm thật đại diện cho một cụm: trong bằng chứng chứa cụm, ưu tiên THẮNG → nhiều kết quả → ngắn. */
export function representativeQuery(theme: string, evidence: PlaybookEntry["evidence"]): string | null {
  const norm = (x: string) => stripDiacritics(x).replace(/[^a-z0-9 .]/g, " ").replace(/\s+/g, " ").trim()
  const hits = evidence.filter((x) => ` ${norm(x.unitName)} `.includes(` ${theme} `))
  if (!hits.length) return null
  hits.sort((a, b) => Number(b.verdict === "win") - Number(a.verdict === "win") || b.results - a.results || a.unitName.length - b.unitName.length)
  return hits[0].unitName.toLowerCase().trim()
}
const dedupeText = <T extends { text: string }>(xs: T[]) => { const seen = new Set<string>(); return xs.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true))) }
const unquote = (label: string) => (/“(.*)”/.exec(label)?.[1] ?? label)

/** Hàm thuần: các dòng (đã lọc công ty + sản phẩm + nền tảng) → gợi ý theo đúng trường của wizard. */
export function buildMeta(entries: PlaybookEntry[], t: TFunction = makeT("vi")): MetaSuggestions {
  const use = entries.filter((e) => e.direction === "use").sort(byStrength)
  // Tuổi: dòng cấu hình nhóm ("25-44") ưu tiên; không có thì dải lát cắt ("band:25-34") —
  // chỉ nối các dải LIỀN nhau quanh dải mạnh nhất, không kéo dải thua ở giữa vào.
  const ages = use.filter((e) => e.kind === "age")
  const cfg = ages.find((e) => !e.value.startsWith("band:") && !e.parts && !isLegacyMerged(e))
  const parse = (v: string) => { const m = /^(\d+)(?:-(\d+))?/.exec(v.replace("band:", "")); return m ? { min: Number(m[1]), max: m[2] ? Number(m[2]) : 65 } : null }
  let age: MetaSuggestions["age"] = null
  if (cfg) { const r = parse(cfg.value); if (r) age = { ...item(cfg, t), ...r } }
  else {
    const bands = ages.filter((e) => e.value.startsWith("band:")).flatMap((e) => partsOf(e).map((p) => ({ e, r: parse(p.value) })))
      .filter((x): x is { e: PlaybookEntry; r: { min: number; max: number } } => !!x.r)
    if (bands.length) {
      let lo = bands[0].r.min, hi = bands[0].r.max
      const used = [bands[0].e]
      for (let grew = true; grew;) {
        grew = false
        for (const b of bands) {
          if (b.r.max + 1 === lo) { lo = b.r.min; grew = true; if (!used.includes(b.e)) used.push(b.e) }
          else if (b.r.min === hi + 1) { hi = b.r.max; grew = true; if (!used.includes(b.e)) used.push(b.e) }
        }
      }
      age = { ...item(used[0], t), label: t("libcase.w.pat.pb.0", { a: lo, b: hi }), min: lo, max: hi, why: used.map((u) => `${localizeEntryLabel(u.label, t)}: ${whyOf(u, t)}`).join(" · ") }
    }
  }
  const interests = use.filter((e) => e.kind === "interest" && partsOf(e).length).map((e) => ({
    ...item(e, t), interests: partsOf(e).map((p) => ({ id: p.value, name: p.label.replace(/^Sở thích: /, "") })),
  }))
  const ev = use.find((e) => e.kind === "opt_event" && (STANDARD_EVENTS.has(e.value) || e.value.startsWith("OTHER:")) && !e.parts && !isLegacyMerged(e))
  return {
    age, interests,
    optEvent: !ev ? null : ev.value.startsWith("OTHER:") ? { ...item(ev, t), customEventName: ev.value.slice(6) } : { ...item(ev, t), pixelEvent: ev.value },
    placements: use.filter((e) => e.kind === "placement").flatMap((e) => partsOf(e).map((p) => ({ ...item(e, t), key: p.value }))),
    content: use.filter((e) => ["ad_format", "hook", "headline", "cta"].includes(e.kind) && !isLegacyMerged(e)).map((e) => ({ ...item(e, t), kind: e.kind, text: e.label })),
    budgetTier: (() => { const b = use.find((e) => e.kind === "budget_tier" && !e.parts && !isLegacyMerged(e)); return b ? { ...item(b, t), tier: b.value } : null })(),
  }
}
export function buildGoogle(entries: PlaybookEntry[], t: TFunction = makeT("vi")): GoogleSuggestions {
  const use = entries.filter((e) => e.direction === "use").sort(byStrength)
  const names = (e: PlaybookEntry) => e.evidence.map((x) => x.unitName)
  return {
    // Cụm 2 âm tiết hay cắt ngang từ ghép ("giá tên", "miền việt") — làm từ khoá thì dở. Gợi ý LƯỢT TÌM
    // ĐẦY ĐỦ đã thắng chứa cụm đó ("giá tên miền"); không có bằng chứng thì mới dùng chính cụm.
    themes: dedupeText(use.filter((e) => e.kind === "search_theme").flatMap((e) => partsOf(e).map((p) => {
      const theme = accentedForm(p.value, names(e)) ?? p.value
      return { ...item(e, t), text: representativeQuery(p.value, e.evidence) ?? theme, theme }
    }))),
    keywords: use.filter((e) => e.kind === "keyword").flatMap((e) => partsOf(e).map((p) => ({ ...item(e, t), text: unquote(p.label), matchType: resolveMatchType(p.value.split("|")[1]) }))),
    landings: use.filter((e) => e.kind === "landing").flatMap((e) => partsOf(e).map((p) => ({ ...item(e, t), url: `https://${p.value}` }))),
    timing: use.filter((e) => (e.kind === "device" || e.kind === "hour") && !isLegacyMerged(e)).map((e) => ({ ...item(e, t), kind: e.kind, value: e.value })),
  }
}

/** Từ phủ định từ dòng "Nên tránh" của Google — ưu tiên bản CÓ dấu; không tìm được thì báo rõ. */
export function negativesOf(avoidE: PlaybookEntry[], t: TFunction = makeT("vi")): Suggestions["negatives"] {
  return avoidE.filter((e) => e.kind === "search_theme" || e.kind === "keyword").flatMap((e) => partsOf(e).map((p) => {
    if (e.kind === "keyword") return { entryId: e.id, text: unquote(p.label), why: whyOf(e, t), status: e.status }
    const acc = accentedForm(p.value, e.evidence.map((x) => x.unitName))
    return { entryId: e.id, text: acc ?? p.value, why: whyOf(e, t) + (acc || !/[a-z]/.test(p.value) ? "" : t("libcase.w.why.noAccent")), status: e.status }
  }))
}

export function buildSuggestions(all: PlaybookEntry[], ctx: { company: Company; platform: Platform; product: string; updatedAt: string | null }, t: TFunction = makeT("vi")): Suggestions {
  const all2 = all.filter((e) => e.platform === ctx.platform && e.product === ctx.product)
  // Dòng tìm thương hiệu/đăng nhập/đối thủ (có note) = khách cũ, đằng nào cũng mua → KHÔNG đưa vào
  // màn tạo chiến dịch mới (đo 28/09: "idmatbao", "id" lọt vào gợi ý Tên miền). Chỉ đếm để báo.
  const mine = all2.filter((e) => !e.note)
  const applyE = mine.filter((e) => e.status === "auto" || e.status === "approved")
  const suggestE = mine.filter((e) => e.status === "suggested")
  const avoidE = all2.filter((e) => e.direction === "avoid" && e.status !== "rejected" && e.status !== "expired")
  return {
    ...ctx,
    apply: { meta: buildMeta(applyE, t), google: buildGoogle(applyE, t) },
    suggest: { meta: buildMeta(suggestE, t), google: buildGoogle(suggestE, t) },
    avoid: avoidE.map((e) => item(e, t)),
    avoidPlacements: avoidE.filter((e) => e.kind === "placement").flatMap((e) => partsOf(e).map((p) => ({ key: p.value, label: localizeEntryLabel(p.label, t), entryId: e.id, status: e.status, why: whyOf(e, t) }))),
    avoidOptEvents: avoidE.filter((e) => e.kind === "opt_event").flatMap((e) => partsOf(e).map((p) => ({ value: p.value, label: localizeEntryLabel(p.label, t), entryId: e.id, status: e.status, why: whyOf(e, t) }))),
    negatives: negativesOf(avoidE, t),
    hiddenNonIncremental: all2.filter((e) => !!e.note && e.status !== "rejected" && e.status !== "expired").length,
    hiddenLegacyMerged: mine.filter((e) => e.status !== "rejected" && e.status !== "expired" && isLegacyMerged(e)).length,
  }
}

export function suggestFor(company: Company, platform: Platform, productKey: string, t: TFunction = makeT("vi")): Suggestions {
  // 7c: dòng bị bác ≥ 2 chiến dịch không còn tự điền (withOutcomes hạ "tự dùng" → "gợi ý").
  const p = withOutcomes(readPlaybook(company))
  const product = productLabelOf(productKey)
  return buildSuggestions(product ? p.entries : [], { company, platform, product: product ?? "", updatedAt: p.updatedAt }, t)
}

/**
 * Bỏ vị trí khỏi targeting của wizard — hàm thuần. Không bao giờ để nền tảng
 * rỗng: loại hết vị trí của một nền tảng → bỏ nền tảng đó; loại hết MỌI vị trí →
 * không đổi gì (trả changed=false + lý do) để Meta không nhận targeting hỏng.
 */
export function dropPlacements(t: Targeting, keys: string[], tr: TFunction = makeT("vi")): { next: Targeting; changed: boolean; removed: string[]; reason?: string } {
  const next: Targeting = JSON.parse(JSON.stringify(t))
  const removed: string[] = []
  let platforms = Array.isArray(next.publisher_platforms) ? [...(next.publisher_platforms as string[])] : null
  for (const k of keys) {
    const pt = placementTarget(k)
    if (!pt || !Array.isArray(next[pt.field])) continue
    const cur = next[pt.field] as string[]
    if (!cur.includes(pt.value)) continue
    const kept = cur.filter((v) => v !== pt.value)
    removed.push(k)
    if (kept.length) next[pt.field] = kept
    else { delete next[pt.field]; if (platforms) platforms = platforms.filter((p) => p !== pt.platform) }
  }
  if (!removed.length) return { next: t, changed: false, removed }
  if (platforms && !platforms.length) return { next: t, changed: false, removed: [], reason: tr("libcase.w.drop.noPlaces") }
  if (platforms) next.publisher_platforms = platforms
  if (!POSITION_FIELDS.some((f) => Array.isArray(next[f]) && (next[f] as string[]).length)) return { next: t, changed: false, removed: [], reason: tr("libcase.w.drop.noPlaces2") }
  return { next, changed: true, removed }
}

const REF_KINDS = new Set(["ad_format", "hook", "headline", "cta", "search_theme", "keyword", "landing"])
/** Đợt 7b — mẫu tham khảo cho brief: dòng nội dung đang dùng/gợi ý + dòng nên tránh, tối đa 12. */
export function briefReferences(company: Company, platforms: Platform[], productKey: string) {
  const product = productLabelOf(productKey)
  if (!product) return []
  const refs = readPlaybook(company).entries
    // Cùng bộ lọc với màn tạo: bỏ dòng tìm thương hiệu/khách cũ (note) + dòng gộp bóc trước 7b.
    .filter((e) => platforms.includes(e.platform) && e.product === product && REF_KINDS.has(e.kind) && e.status !== "rejected" && e.status !== "expired" && !e.note && !isLegacyMerged(e))
    .sort(byStrength)
    .map((e) => ({ entryId: e.id, platform: e.platform, direction: e.direction, kind: e.kind,
      text: e.kind === "search_theme" ? `Lượt tìm: “${representativeQuery(e.value, e.evidence) ?? e.value}”` : e.label, why: whyOf(e), confidence: e.confidence }))
  const uniq = dedupeText(refs)
  // Tối đa 9 mẫu thắng + 3 mẫu nên tránh — để phần "nên tránh" không bị đẩy khỏi danh sách.
  return [...uniq.filter((r) => r.direction === "use").slice(0, 9), ...uniq.filter((r) => r.direction === "avoid").slice(0, 3)]
}
