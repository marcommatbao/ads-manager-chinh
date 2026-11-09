// ============================================================
// Đợt 15a — Dựng hộp việc (07:45) + gửi Top 5 lên Teams kênh Ads (08:10). CHỈ ĐỌC tài khoản quảng cáo.
// ============================================================
// Mỗi nguồn × công ty đọc riêng: nguồn nào hỏng thì ghi lỗi và KHÔNG mang việc cũ của nguồn đó sang (không trình số cũ như mới).
// Kênh gửi: TEAMS_WEBHOOK_ADS (user chốt 29/09: kênh riêng team Ads). Chưa đặt → vẫn dựng + hiện trên trang, chỉ không gửi —
// "chưa cấu hình" KHÔNG phải sự cố, không báo lỗi lặp.
import { lastDays, vnDate } from "@/lib/case/dates"
import { lexiconFor } from "@/lib/case/targets"
import type { Company } from "@/lib/case/types"
import { pmaxXray } from "@/lib/pmax/xray"
import { readControlData, proposeControls, controlLexicon } from "@/lib/pmax/controls"
import { recommend } from "@/lib/pmax/recommend"
import { searchXray } from "@/lib/search/xray"
import { proposeSearch, readSearchNegatives } from "@/lib/search/controls"
import { activeSplitsBySource, recommendSearch } from "@/lib/search/recommend"
import { metaXray } from "@/lib/meta/xray"
import { recommendMeta } from "@/lib/meta/recommend"
import { healthOverview } from "@/lib/overview/health"
import { caseBoard } from "@/lib/case/board"
import { queryFor } from "@/lib/nba/store"
import { sendTeamsAlert } from "@/lib/teams-alert"
import { fromPmax, fromSearch, fromMeta, fromHealth, fromBoard, fromNba, fromSplits, rankItems, pickDigest, KIND_LABEL, SOURCE_LABEL, type InboxItem, type InboxSource } from "./build"
import { readSnapshot, saveSnapshot, readStates, viewItems, isOpen, type InboxSnapshot } from "./store"
import { companyIds } from "@/lib/companies"

// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại).
export const ADS_WEBHOOK_HINT = "Top 5 buổi sáng đang KHÔNG gửi vì thiếu biến TEAMS_WEBHOOK_ADS (webhook kênh Teams của team Ads). Việc vẫn hiện ở trang Việc hôm nay."
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)

export async function buildInbox(now = new Date()): Promise<InboxSnapshot> {
  const r = lastDays(30, now)
  const items: InboxItem[] = [], errors: InboxSnapshot["errors"] = []
  const run = async (company: Company | "ALL", source: InboxSource, f: () => Promise<InboxItem[]>) => {
    try { items.push(...(await f())) } catch (e) { errors.push({ company, source, error: errMsg(e) }) }
  }
  const COMPANIES: Company[] = companyIds()
  for (const co of COMPANIES) {
    await run(co, "pmax", async () => {
      const [px, cd] = await Promise.all([pmaxXray(co, r), readControlData(co, r)])
      return fromPmax(co, recommend(px, proposeControls(px, cd, controlLexicon(co))))
    })
    await run(co, "search", async () => {
      const sx = await searchXray(co, r)
      const { allSplits, splitTargets } = await import("@/lib/search/split")
      const splits = activeSplitsBySource(allSplits().filter((x) => x.company === co), now)
      return fromSearch(co, recommendSearch(sx, proposeSearch(sx, await readSearchNegatives(co), lexiconFor(co), new Set(splits.keys()), splits.size ? await splitTargets(co) : new Map()), splits), Object.fromEntries(sx.campaigns.map((c) => [c.id, c.name])))
    })
    await run(co, "meta", async () => { const mx = await metaXray(co, r); return fromMeta(co, mx, recommendMeta(mx)) })
  }
  await run("ALL", "health", async () => fromHealth((await healthOverview(COMPANIES)).fixes))
  await run("ALL", "case", async () => fromBoard(caseBoard(COMPANIES, now.getTime())))
  await run("ALL", "search", async () => { const { allSplits } = await import("@/lib/search/split"); return fromSplits(allSplits(), now) })
  await run("ALL", "nba", async () => fromNba(queryFor(COMPANIES)))
  // Cùng khoá (vd việc quá hạn vừa từ Sức khoẻ vừa từ bảng phiên) → giữ bản đầu.
  const seen = new Set<string>()
  const uniq = rankItems(items).filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
  const snap: InboxSnapshot = { builtAt: now.toISOString(), items: uniq, errors }
  saveSnapshot(snap)
  return snap
}

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`

/** Thẻ Top 5 — HÀM THUẦN. */
export function composeDigest(snap: InboxSnapshot, top: InboxItem[], openCount: number, day: string): { title: string; facts: { title: string; value: string }[]; action: string } {
  return {
    title: top.length ? `📋 Việc nên làm hôm nay ${day} — ${top.length}/${openCount} việc ưu tiên` : `📋 ${day}: không có việc nào cần làm`,
    facts: [
      ...top.map((t, i) => ({ title: `${i + 1}. ${KIND_LABEL[t.kind]} · ${t.company} · ${SOURCE_LABEL[t.source]}`, value: `${t.title}${t.money != null ? ` — ${vnd(t.money)} (${t.moneyLabel})` : ""}` })),
      ...(snap.errors.length ? [{ title: "⚠ Không đọc được", value: snap.errors.map((e) => `${e.company} · ${SOURCE_LABEL[e.source]}`).join(", ") + " — việc của nguồn này không có trong danh sách" }] : []),
    ],
    action: "Mở AdsCommand → Việc hôm nay để làm / hoãn / bỏ qua. Tiền: 30 ngày gần nhất, mỗi con số ghi rõ là gì — không cộng các loại với nhau.",
  }
}

export async function sendInboxDigest(now = new Date()): Promise<{ sent: boolean; notConfigured?: boolean; error?: string; count: number }> {
  // Lần dựng 07:45 hỏng / chưa chạy → dựng lại, KHÔNG gửi danh sách của hôm trước như của hôm nay.
  const last = readSnapshot()
  const snap = last && now.getTime() - Date.parse(last.builtAt) < 6 * 3_600_000 ? last : await buildInbox(now)
  const open = viewItems(snap.items, readStates(), now.getTime()).filter(isOpen)
  const top = pickDigest(open)
  const card = composeDigest(snap, top, open.length, vnDate(now).slice(5).split("-").reverse().join("/"))
  const res = await sendTeamsAlert({ ...card, level: top.some((t) => t.kind === 1) ? "warning" : "good", webhookUrl: process.env.TEAMS_WEBHOOK_ADS ?? "", setupHint: ADS_WEBHOOK_HINT })
  saveSnapshot({ ...snap, digest: { sentAt: now.toISOString(), keys: top.map((t) => t.key), sent: res.sent, ...(res.notConfigured ? { notConfigured: true } : {}), ...(res.error && !res.notConfigured ? { error: res.error } : {}) } })
  return { sent: res.sent, notConfigured: res.notConfigured, error: res.error, count: top.length }
}
