// ============================================================
// Đợt 15a — HỘP "VIỆC NÊN LÀM HÔM NAY": gom việc từ PMax / Search / Meta / Sức khoẻ / Phiên xử lý / NBA về MỘT khuôn (HÀM THUẦN)
// ============================================================
// Đo 29/09: mỗi nguồn tính "tiền liên quan" một nghĩa (Meta = cả chi chiến dịch, Search = chi lượt tìm 0 đơn, PMax = chi cả kênh)
// → xếp thẳng thì Meta chiếm hết top 5, và 28 việc Meta MBC là CÙNG một vấn đề. Nên:
//   • chia 3 LOẠI: ① số đo sai (chặn mọi quyết định khác) → ② lãng phí rõ → ③ cơ hội; trong loại mới xếp theo tiền;
//   • con số tiền LUÔN đi kèm nhãn nói nó là gì (không cộng/so tiền khác nghĩa mà không ghi);
//   • việc cùng loại trên nhiều chiến dịch GỘP thành một việc có danh sách bên trong;
//   • top 5 gửi Teams tối đa 2 việc / nguồn.
// Hộp việc KHÔNG ghi gì lên tài khoản — mỗi việc dẫn tới đúng chỗ đã có (Kiểm trước → XAC NHAN → đọc lại → hoàn tác).
import type { Company } from "@/lib/case/types"
import type { Recommendation as PmaxRec } from "@/lib/pmax/recommend"
import type { SearchRecommendation } from "@/lib/search/recommend"
import type { MetaRecommendation } from "@/lib/meta/recommend"
import type { MetaXray } from "@/lib/meta/xray"
import type { FixItem } from "@/lib/overview/health"
import type { BoardRow } from "@/lib/case/board"
import type { NbaRecommendation } from "@/lib/nba/types"

export type InboxSource = "pmax" | "search" | "meta" | "health" | "case" | "nba"
export type InboxKind = 1 | 2 | 3
// Nhãn chuyển sang ./labels.ts (file thuần, không phụ thuộc "fs") — re-export ở đây để không đổi chỗ import cũ.
export { KIND_LABEL, SOURCE_LABEL } from "./labels"

export interface InboxChild { name: string; detail: string; money: number | null }
export interface InboxItem {
  /** Khoá ỔN ĐỊNH giữa các lần dựng — trạng thái (đã xem / hoãn / bỏ qua) gắn vào khoá này. */
  key: string
  company: Company
  source: InboxSource
  kind: InboxKind
  title: string
  why: string
  /** ₫ trong 30 ngày (NBA: ước tính/tháng). null = không đo được tiền. */
  money: number | null
  /** Con số tiền là gì — luôn hiện cạnh số. */
  moneyLabel: string | null
  href: string
  hrefLabel: string
  children?: InboxChild[]
  campaignIds: string[]
}

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`
const pct = (x: number) => `${Math.round(x * 100)}%`

// ── PMax ─────────────────────────────────────────────────────
const PMAX_KIND: Record<string, InboxKind> = { rec_negatives: 2, rec_pages: 2, rec_apps: 2, rec_brand: 3, rec_urlexp: 3, rec_places: 3, rec_age: 3, rec_assets: 3 }
export function fromPmax(company: Company, recs: PmaxRec[]): InboxItem[] {
  return recs.map((r): InboxItem => {
    const engaged = r.id.startsWith("rec_engaged_")
    const kind: InboxKind = engaged ? 1 : PMAX_KIND[r.id] ?? 3
    return {
      key: `${company}:pmax:${r.id}`, company, source: "pmax", kind, title: r.title, why: r.why,
      money: r.moneyAtStake, moneyLabel: r.moneyAtStake == null ? null : engaged ? "chi của kênh, chấm theo đơn sau lượt xem" : kind === 2 ? "chi vào chỗ 0 đơn" : "chi liên quan",
      href: "/google-pmax?tab=xray", hrefLabel: "Mở X-quang PMax", campaignIds: [],
    }
  })
}

// ── Search ───────────────────────────────────────────────────
export function fromSearch(company: Company, recs: SearchRecommendation[], names: Record<string, string> = {}): InboxItem[] {
  // Đã có bản tách → Hộp việc theo dõi qua fromSplits (bỏ dở / nên hoàn tác), không lặp lại việc "Tách".
  return recs.filter((r) => !(r.action.type === "split" && r.action.split)).map((r): InboxItem => {
    const waste = r.id === "rec_neg" || r.id === "rec_pause" || r.id.startsWith("rec_comp_")
    const split = r.id.startsWith("rec_split_")
    const cid = r.action.type === "split" ? r.action.campaignId : r.id.match(/_(\d+)$/)?.[1]
    return {
      key: `${company}:search:${r.id}`, company, source: "search", kind: waste ? 2 : 3,
      // "Mất hiển thị vì hạng" / "Tiền vào tên đối thủ" không mang tên chiến dịch → hai việc trùng tên.
      title: cid && names[cid] && !r.title.includes(names[cid]) ? `${r.title} — ${names[cid]}` : r.title, why: r.why,
      money: r.moneyAtStake, moneyLabel: r.moneyAtStake == null ? null : split ? "chi lượt tìm chung trong chiến dịch thương hiệu" : waste ? "chi vào lượt tìm / từ khoá 0 đơn" : "chi liên quan",
      href: "/google-search?tab=xray", hrefLabel: "Mở X-quang Search", campaignIds: cid ? [cid] : [],
    }
  })
}

// ── Meta: GỘP theo loại vấn đề ─────────────────────────────────
export function fromMeta(company: Company, x: Pick<MetaXray, "campaigns">, recs: MetaRecommendation[]): InboxItem[] {
  const out: InboxItem[] = []
  const byId = new Map(x.campaigns.map((c) => [c.id, c]))
  const view: InboxChild[] = [], opt: InboxChild[] = []
  const viewIds: string[] = [], optIds: string[] = []
  let viewMoney = 0, optMoney = 0
  for (const r of recs) {
    if (r.action.type !== "open_case") continue
    const c = byId.get(r.action.campaignId)
    if (!c) continue
    if (r.priority === 1 && c.viewShare != null) {
      const m = c.spend * c.viewShare
      viewMoney += m; viewIds.push(c.id)
      view.push({ name: c.name, detail: `${pct(c.viewShare)} "mua hàng" là chỉ xem · chi ${vnd(c.spend)}`, money: m })
    } else {
      optMoney += c.spend; optIds.push(c.id)
      opt.push({ name: c.name, detail: `tối ưu theo "${c.optEventLabel ?? c.optEvent ?? "?"}" · chi ${vnd(c.spend)}`, money: c.spend })
    }
  }
  const sortKids = (k: InboxChild[]) => k.sort((a, b) => (b.money ?? 0) - (a.money ?? 0))
  if (view.length) out.push({
    key: `${company}:meta:view_heavy`, company, source: "meta", kind: 1,
    title: `${view.length} chiến dịch: phần lớn "mua hàng" Meta báo là người CHỈ XEM`,
    why: "Meta học theo số này — tiền dồn vào người lướt thấy quảng cáo rồi tự mua (khách gia hạn). Mở từng chiến dịch → phiên xử lý đề xuất nhóm mới CHỈ tính lượt bấm 7 ngày.",
    money: viewMoney, moneyLabel: "chi × tỉ lệ đơn chỉ xem", href: "/meta-xray", hrefLabel: "Mở Meta X-quang", children: sortKids(view), campaignIds: viewIds,
  })
  if (opt.length) out.push({
    key: `${company}:meta:opt_not_purchase`, company, source: "meta", kind: 1,
    title: `${opt.length} chiến dịch tối ưu theo sự kiện KHÔNG phải Mua hàng`,
    why: "Meta tìm người làm sự kiện đó (vd thêm thông tin thanh toán), không phải người mua. Meta cấm sửa trên nhóm cũ → phiên xử lý tạo nhóm mới tối ưu Mua hàng.",
    money: optMoney, moneyLabel: "chi đang tối ưu theo sự kiện khác", href: "/meta-xray", hrefLabel: "Mở Meta X-quang", children: sortKids(opt), campaignIds: optIds,
  })
  for (const r of recs.filter((r) => r.action.type !== "open_case"))
    out.push({ key: `${company}:meta:${r.id}`, company, source: "meta", kind: r.id === "rec_utm" ? 1 : 3, title: r.title, why: r.why, money: r.moneyAtStake, moneyLabel: r.moneyAtStake == null ? null : "chi liên quan",
      href: r.action.type === "link" ? r.action.href : "/meta-xray", hrefLabel: r.action.type === "link" ? r.action.label : "Mở Meta X-quang", campaignIds: [] })
  return out
}

// ── Sức khoẻ Tổng quan (đo lường, vượt trần CPA, việc giao quá hạn) ─────────
// Lỗi đo lường (sự kiện tối ưu không bắn, thẻ GTM, mục tiêu Google) GỘP một việc / công ty — đo 29/09 MBI có 7 dòng rời chiếm hết
// loại ①. Đường lead đứt giữ RIÊNG (đứt là mất lead ngay).
/** Đợt 18g: bản tách Search cần làm — HÀM THUẦN. Mốc gần nhất "Nên hoàn tác" (②) · đã tạo > 3 ngày chưa chuyển từ khoá (③). */
export function fromSplits(records: { id: string; company: Company; name: string; at: string; step: string; sourceId: string; newCampaign?: string; checkpoints?: Partial<Record<"7" | "14", { verdict: string; lines: string[] }>> }[], now: Date): InboxItem[] {
  const out: InboxItem[] = []
  for (const r of records) {
    const newId = r.newCampaign?.split("/").pop()
    const ids = [r.sourceId, ...(newId ? [newId] : [])]
    const last = r.checkpoints?.["14"] ?? r.checkpoints?.["7"]
    const lastDays = r.checkpoints?.["14"] ? 14 : 7
    if (r.step === "moved" && last?.verdict === "dung") {
      out.push({ key: `${r.company}:split:${r.id}:dung`, company: r.company, source: "search", kind: 2, title: `Bản tách "${r.name}" nên hoàn tác (mốc ${lastDays} ngày)`, why: `${last.lines[0] ?? ""} → mở bản tách, bấm "Hoàn tác chuyển từ khoá".`, money: null, moneyLabel: null, href: "/google-search?tab=xray", hrefLabel: "Mở X-quang Search", campaignIds: ids })
    }
    const age = Math.floor((now.getTime() - Date.parse(r.at)) / 86_400_000)
    if (r.step === "created" && age > 3) {
      out.push({ key: `${r.company}:split:${r.id}:pending`, company: r.company, source: "search", kind: 3, title: `Bản tách "${r.name}" tạo ${age} ngày nhưng chưa chuyển từ khoá`, why: "Chưa chuyển thì chưa có mốc đo hiệu quả — bổ sung tài sản, bật chiến dịch mới (bước 2) rồi chuyển từ khoá (bước 3), hoặc gỡ nếu không dùng.", money: null, moneyLabel: null, href: "/google-search?tab=xray", hrefLabel: "Mở X-quang Search", campaignIds: ids })
    }
  }
  return out
}

export function fromHealth(fixes: FixItem[]): InboxItem[] {
  const out: InboxItem[] = []
  const strip = (t: string, co: string) => t.replace(new RegExp(`^${co} · `), "")
  const measure = new Map<Company, FixItem[]>()
  // pmax_* trùng với nguồn PMax (đã có ở trên) → bỏ.
  for (const f of fixes.filter((f) => !f.id.startsWith("pmax_"))) {
    if (f.rank === "measurement" && !f.id.startsWith("lead_flow_")) { measure.set(f.company, [...(measure.get(f.company) ?? []), f]); continue }
    const cid = f.id.match(/^money_[a-z]+_(.+)$/)?.[1]
    out.push({
      key: `${f.company}:health:${f.id}`, company: f.company, source: f.rank === "overdue" ? "case" : "health",
      kind: f.rank === "measurement" ? 1 : f.rank === "money" ? 2 : 3,
      title: f.title, why: [f.why, f.suggestion].filter(Boolean).join(" → "),
      money: f.money ? f.money : null, moneyLabel: f.money ? "chi vượt trần CPA" : null,
      href: f.href, hrefLabel: f.hrefLabel, campaignIds: cid ? [cid] : [],
    })
  }
  for (const [co, fs] of measure) out.push(fs.length === 1
    ? { key: `${co}:health:${fs[0].id}`, company: co, source: "health", kind: 1, title: fs[0].title, why: [fs[0].why, fs[0].suggestion].filter(Boolean).join(" → "), money: null, moneyLabel: null, href: fs[0].href, hrefLabel: fs[0].hrefLabel, campaignIds: [] }
    : { key: `${co}:health:measurement`, company: co, source: "health", kind: 1,
      title: `${co}: ${fs.length} lỗi đo lường (sự kiện tối ưu / thẻ GTM / mục tiêu Google)`,
      why: "Nền tảng đang học theo tín hiệu sai hoặc thiếu — sửa trước khi đánh giá hay chỉnh ngân sách các chiến dịch liên quan.",
      money: null, moneyLabel: null, href: "/do-luong", hrefLabel: "Mở Sức khoẻ đo lường",
      children: fs.map((f) => ({ name: strip(f.title, co), detail: f.suggestion || f.why, money: null })), campaignIds: [] })
  return out
}

// ── Phiên bị MỞ LẠI (đo lại 14 ngày: CPA không giảm) ─────────────
export function fromBoard(rows: BoardRow[]): InboxItem[] {
  // Đợt 23: mốc 7 ngày đã XẤU ĐI (chưa tới mốc 14 ngày) → báo sớm, không đợi thêm một tuần tiền chạy.
  const early = rows.filter((r) => r.state !== "reopened" && r.remeasure[0]?.done && r.remeasure[0].verdict === -1 && !r.remeasure[1]?.done).map((r): InboxItem => {
    const m = r.remeasure[0]!
    const detail = m.roasAfter !== null && m.roasAfter !== undefined
      ? `ROAS ${m.roasBefore ?? "—"} → ${m.roasAfter}`
      : `CPA ${m.cpaBefore ? vnd(m.cpaBefore) : "—"} → ${m.cpaAfter ? vnd(m.cpaAfter) : "chưa có đơn"}`
    return {
      key: `${r.company}:case:worse7_${r.id}`, company: r.company, source: "case", kind: 2,
      title: `Đo 7 ngày: ${r.campaignName} đang XẤU ĐI sau khi xử lý`,
      why: `${detail} (xấu hơn quá 10% so với lúc mở phiên). Xem lại việc đã áp — cân nhắc hoàn tác trước mốc 14 ngày.`,
      money: null, moneyLabel: null, href: `/xu-ly/${r.id}`, hrefLabel: "Mở phiên", campaignIds: [r.campaignId],
    }
  })
  return [...early, ...rows.filter((r) => r.state === "reopened").map((r): InboxItem => {
    const m = r.remeasure[1] ?? r.remeasure[0]
    return {
      key: `${r.company}:case:reopened_${r.id}`, company: r.company, source: "case", kind: 2,
      title: `Phiên bị mở lại: ${r.campaignName}`,
      why: `Đo lại sau 14 ngày: ${m?.roasAfter !== null && m?.roasAfter !== undefined ? `ROAS ${m.roasBefore ?? "—"} → ${m.roasAfter}` : `CPA ${m?.cpaBefore ? vnd(m.cpaBefore) : "—"} → ${m?.cpaAfter ? vnd(m.cpaAfter) : "—"}`} — chưa đạt mục tiêu (cần về dưới trần hoặc tốt hơn ít nhất 10%). Xem lại nguyên nhân / cân nhắc hoàn tác.`,
      money: null, moneyLabel: null, href: `/xu-ly/${r.id}`, hrefLabel: "Mở phiên", campaignIds: [r.campaignId],
    }
  })]
}

// ── NBA (chỉ Meta — Google đã có ở Search/PMax), gộp theo lý do ──────
const NBA_WASTE = new Set(["ZERO_CONV_SPEND", "CPL_CRITICAL", "PAUSE_FB_AD_LOW_CTR", "NEGATIVE_KEYWORD_WASTE"])
export function fromNba(recs: NbaRecommendation[]): InboxItem[] {
  const groups = new Map<string, NbaRecommendation[]>()
  for (const r of recs.filter((r) => r.platform === "facebook")) {
    const k = `${r.company}|${r.reasonCode}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.values()].map((rs): InboxItem => {
    const r0 = rs[0], money = rs.reduce((s, r) => s + (r.estimatedMonthlySavings ?? r.estimatedMonthlyLift ?? 0), 0)
    const waste = NBA_WASTE.has(r0.reasonCode)
    return {
      key: `${r0.company}:nba:${r0.reasonCode}`, company: r0.company as Company, source: "nba", kind: waste ? 2 : 3,
      title: rs.length === 1 ? r0.title : `${rs.length} việc: ${r0.title.replace(/[:—-].*$/, "").trim() || r0.reasonCode}`,
      why: rs.length === 1 ? r0.summary || r0.explanation : r0.recommendedAction || r0.summary,
      money: money || null, moneyLabel: money ? (waste ? "ước tính tiết kiệm / tháng" : "ước tính thêm / tháng") : null,
      href: "/", hrefLabel: "Mở Next Best Actions",
      children: rs.length > 1 ? rs.map((r) => ({ name: r.entityName, detail: r.summary || r.title, money: r.estimatedMonthlySavings ?? r.estimatedMonthlyLift ?? null })) : undefined,
      campaignIds: rs.filter((r) => r.entityType === "campaign").map((r) => r.entityId),
    }
  })
}

/** ① → ② → ③; trong loại: tiền giảm dần (không tiền xếp cuối loại). */
export function rankItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => a.kind - b.kind || (b.money ?? -1) - (a.money ?? -1) || a.key.localeCompare(b.key))
}

/** Top N gửi Teams — tối đa `perSource` việc / nguồn để một nguồn không chiếm hết. Đầu vào đã xếp hạng + lọc trạng thái. */
export function pickDigest(ranked: InboxItem[], n = 5, perSource = 2): InboxItem[] {
  const used: Partial<Record<InboxSource, number>> = {}, out: InboxItem[] = []
  for (const it of ranked) {
    if (out.length >= n) break
    if ((used[it.source] ?? 0) >= perSource) continue
    used[it.source] = (used[it.source] ?? 0) + 1
    out.push(it)
  }
  return out
}
