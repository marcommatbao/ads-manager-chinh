// ============================================================
// Đợt 15b — LUỒNG GHI CHUNG: mọi lần tool ghi lên tài khoản quảng cáo về MỘT khuôn
// ============================================================
// Kiểm kê 29/09: ~15 nhật ký khác khuôn, nhiều cái KHÔNG lưu campaignId (chỉ tên tài nguyên), giữ 30 ngày – 1.000 dòng → không
// đo lại được, không làm báo cáo tuần được. Ở đây: đọc các nhật ký chính → WriteEvent {…, campaignIds, pendingResources};
// tên tài nguyên cấp nhóm quảng cáo / asset group / ngân sách → tra chiến dịch lúc đo (lib/writes/outcome.ts).
// Luồng được LƯU LẠI (data/write-feed.json) để lịch sử sống lâu hơn nhật ký gốc (bị cắt theo số dòng).
// Nguồn tự đo lại riêng (phiên /xu-ly, bản tách Search) vẫn vào luồng nhưng `ownOutcome` → không đo lại lần hai.
import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import type { GuardedWrite } from "@/lib/write-guard"
import type { ControlExecution } from "@/lib/pmax/controls"
import type { SearchExecution } from "@/lib/search/controls"
import type { SplitRecord } from "@/lib/search/split"
import type { CampaignCase } from "@/lib/case/store"
import type { DecisionMemoryEntry } from "@/lib/decision-memory/types"
import type { BudgetApplyRecord } from "@/lib/pmax-insights/budget-apply-log"
import { companyIds } from "@/lib/companies"
import { undoableReason } from "@/lib/writes/undo"
import { EVENT_LABEL } from "@/lib/writes/labels"

export type WritePlatform = "google" | "meta"
export interface WriteEvent {
  /** `${nguồn}:${id gốc}` — ổn định. */
  id: string
  source: string
  sourceLabel: string
  at: string
  company: Company
  platform: WritePlatform
  by: string
  label: string
  campaignIds: string[]
  /** Tên tài nguyên Google chưa biết chiến dịch (nhóm quảng cáo / asset group / ngân sách) — tra lúc đo. */
  pending: string[]
  /** Chỉ chạm cấp tài khoản (phủ định / loại vị trí toàn tài khoản) — không đo riêng chiến dịch. */
  accountLevel: boolean
  undoneAt: string | null
  link: string
  /** Nguồn tự đo lại (phiên xử lý, bản tách) — không đo lần hai. */
  ownOutcome: "case" | "split" | null
  /** Đợt 23 (3c): bấm Hoàn tác được trên trang "Đã làm & kết quả" (POST /api/writes/undo). */
  undoable?: boolean
}

export const SOURCE_LABELS: Record<string, string> = {
  guard: "Search / toolkit", pmax: "PMax · việc nên làm", search: "Search · việc nên làm", split: "Search · tách chiến dịch",
  case: "Phiên xử lý", dm: "Ngân sách / bật-tắt / tự động", pmax_budget: "PMax · ngân sách (AI Advisor)",
  undo_log: "Improvements / NBA tự áp",
}

// ── Tên tài nguyên Google → chiến dịch ───────────────────────
const RES = /customers\/(\d+)\/([A-Za-z]+)\/(\d+)(?:~\d+)*/g
const CAMPAIGN_LEVEL = new Set(["campaigns", "campaignCriteria", "campaignSharedSets", "campaignAssets", "campaignLabels", "campaignConversionGoals", "campaignLifecycleGoals"])
const LOOKUP_LEVEL = new Set(["adGroups", "adGroupCriteria", "adGroupAds", "adGroupAssets", "assetGroups", "assetGroupAssets", "assetGroupSignals", "assetGroupListingGroupFilters", "campaignBudgets"])
const ACCOUNT_LEVEL = new Set(["customerNegativeCriteria", "sharedCriteria", "sharedSets", "customerAssets", "conversionActions", "customers"])

/** HÀM THUẦN: gom mã chiến dịch, tài nguyên cần tra, cờ cấp tài khoản từ bất kỳ chuỗi / đối tượng nào chứa tên tài nguyên. */
export function parseResources(x: unknown): { campaignIds: string[]; pending: string[]; accountLevel: boolean } {
  const text = typeof x === "string" ? x : JSON.stringify(x ?? "")
  const campaignIds = new Set<string>(), pending = new Set<string>()
  let accountLevel = false
  for (const m of text.matchAll(RES)) {
    const [, cust, kind, id] = m
    if (CAMPAIGN_LEVEL.has(kind)) campaignIds.add(id)
    else if (LOOKUP_LEVEL.has(kind)) pending.add(`customers/${cust}/${kind}/${id}`)
    else if (ACCOUNT_LEVEL.has(kind)) accountLevel = true
  }
  return { campaignIds: [...campaignIds], pending: [...pending], accountLevel: accountLevel && !campaignIds.size && !pending.size }
}

/** Mã đề xuất PMax / Search mang sẵn campaignId: neg_<cid>_…, brand_<cid>_…, wp_<cid>_…, urlexp_<cid>, age_<cid>_… */
export function campaignFromProposalId(id: string): string | null {
  return id.match(/^(?:neg|brand|wp|urlexp|age)_(\d+)(?:_|$)/)?.[1] ?? null
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]

// ── Bộ chuyển từng nguồn (HÀM THUẦN) ─────────────────────────
export function fromGuard(w: GuardedWrite): WriteEvent | null {
  if (w.status !== "done") return null
  const r = parseResources(w.inverse)
  return { id: `guard:${w.id}`, source: "guard", sourceLabel: `${SOURCE_LABELS.guard} · ${w.source}`, at: w.at, company: w.company, platform: "google", by: w.by, label: w.label, ...r, undoneAt: w.undoneAt ?? null, link: "/google-search?tab=xray", ownOutcome: null }
}

function fromControls(kind: "pmax" | "search", e: ControlExecution | SearchExecution): WriteEvent | null {
  if (e.mode !== "write" || !e.applied.length) return null
  const r = parseResources(e.applied.map((a) => a.resourceName ?? ""))
  const fromIds = e.applied.map((a) => campaignFromProposalId(a.proposalId)).filter((x): x is string => !!x)
  const campaignIds = uniq([...r.campaignIds, ...fromIds])
  return {
    id: `${kind}:${e.id}`, source: kind, sourceLabel: SOURCE_LABELS[kind], at: e.at, company: e.company, platform: "google", by: e.by,
    label: e.applied.length === 1 ? e.applied[0].label : `${e.applied.length} việc: ${e.applied.slice(0, 3).map((a) => a.label).join(" · ")}${e.applied.length > 3 ? " …" : ""}`,
    campaignIds, pending: r.pending, accountLevel: !campaignIds.length && !r.pending.length && (r.accountLevel || e.applied.some((a) => a.proposalId.startsWith("pl_"))),
    undoneAt: e.undoneAt ?? null, link: kind === "pmax" ? "/google-pmax?tab=xray" : "/google-search?tab=xray", ownOutcome: null,
  }
}
export const fromPmaxExec = (e: ControlExecution) => fromControls("pmax", e)
export const fromSearchExec = (e: SearchExecution) => fromControls("search", e)

export function fromSplit(s: SplitRecord): WriteEvent | null {
  if (!s.movedAt) return null
  const nc = parseResources(s.newCampaign ?? "").campaignIds
  return { id: `split:${s.id}`, source: "split", sourceLabel: SOURCE_LABELS.split, at: s.movedAt, company: s.company, platform: "google", by: s.by, label: `Tách lượt tìm chung khỏi "${s.sourceName}" → "${s.name}" (${s.keywordsCount} từ khoá)`, campaignIds: uniq([s.sourceId, ...nc]), pending: [], accountLevel: false, undoneAt: s.step === "removed" ? s.at : null, link: "/google-search?tab=xray", ownOutcome: "split" }
}

/** Đợt 18d: mỗi lần gắn tài sản từ chiến dịch gốc sang bản tách (không tính lần Kiểm trước). */
export function fromSplitAssets(s: SplitRecord): WriteEvent[] {
  const nc = parseResources(s.newCampaign ?? "").campaignIds
  return (s.assetReports ?? []).filter((a) => !a.validateOnly && a.added.length).map((a) => ({
    id: `split-assets:${s.id}:${a.at}`, source: "split", sourceLabel: SOURCE_LABELS.split, at: a.at, company: s.company, platform: "google" as const, by: a.by,
    label: `Gắn tài sản từ "${s.sourceName}" sang "${s.name}": ${a.added.map((x) => `${x.count} ${x.label}`).join(", ")}`,
    campaignIds: uniq(nc), pending: [], accountLevel: false, undoneAt: null, link: "/google-search?tab=xray", ownOutcome: "split" as const,
  }))
}

export function fromCase(c: CampaignCase): WriteEvent[] {
  return c.executions.filter((e) => e.mode !== "validate" && e.status === "done").map((e) => ({
    id: `case:${c.id}:${e.id}`, source: "case", sourceLabel: SOURCE_LABELS.case, at: e.at, company: c.company, platform: c.platform === "facebook" ? "meta" as const : "google" as const, by: e.by,
    label: `${c.campaignName}: ${[e.created.length && `${e.created.length} phủ định`, e.paused.length && `dừng ${e.paused.length} chiến dịch`, e.metaChanges?.length && `${e.metaChanges.length} thay đổi Meta`, e.attached?.length && "gắn danh sách chặn"].filter(Boolean).join(", ") || "thực hiện"}`,
    campaignIds: uniq([c.campaignId, ...e.paused.map((p) => p.campaignId)]), pending: [], accountLevel: false, undoneAt: e.undoneAt ?? null, link: `/xu-ly/${c.id}`, ownOutcome: "case" as const,
  }))
}

// Sự kiện decision-memory ghi LÊN tài khoản (bỏ các sự kiện chỉ là ghi chú: đề xuất bị bỏ qua / đổi cấu hình tool…).
const DM_WRITE = /^(budget\.|campaign\.(pause|resume|archive)|adset\.|creative\.(pause|promote)|automation\.(rule_applied|sim_approved)|ab\.variant_paused|nba\.recommendation_applied)/
export function fromDecision(d: DecisionMemoryEntry): WriteEvent | null {
  if (!DM_WRITE.test(d.event)) return null
  const platform: WritePlatform | null = d.target.platform === "meta" ? "meta" : d.target.platform === "google_ads" ? "google" : null
  if (!platform) return null
  const cid = d.target.entityType === "campaign" ? d.target.entityId : d.target.parentId ?? null
  const src = d.source
  const by = src.type === "human_manual" ? src.actor : src.type === "cron_auto_apply" ? `tự động · ${src.jobId}` : src.type === "automation_rule" ? `luật · ${src.ruleName}` : src.type === "nba_engine" ? "NBA tự áp" : src.type
  return { id: `dm:${d.id}`, source: "dm", sourceLabel: SOURCE_LABELS.dm, at: d.createdAt, company: d.target.company, platform, by, label: `${d.target.entityName}: ${EVENT_LABEL[d.event] ?? d.event}${d.action.notes ? ` — ${d.action.notes}` : ""}`, campaignIds: cid ? [cid] : [], pending: [], accountLevel: false, undoneAt: d.undoneAt ?? null, link: "/", ownOutcome: null, undoable: undoableReason(d) === null }
}

/** Đợt 23 (3c): nhật ký hoàn tác của Improvements + NBA tự áp (lib/apply-undo-log.ts) — trước đây KHÔNG vào luồng đo lại
 *  nên các việc cấp từ khoá (tạm dừng / đổi giá thầu / thêm phủ định) không bao giờ được đo 7/14 ngày. */
export function fromUndoLog(u: { id: string; improvementId: string; company: string; action: string; resourceName: string; label?: string; appliedAt: string; undoneAt?: string }): WriteEvent | null {
  const r = parseResources(u.resourceName)
  if (!r.campaignIds.length && !r.pending.length && !r.accountLevel) return null
  const nba = u.improvementId.startsWith("nba")
  return { id: `undo_log:${u.id}`, source: "undo_log", sourceLabel: SOURCE_LABELS.undo_log, at: u.appliedAt, company: u.company as Company, platform: u.resourceName.startsWith("customers/") ? "google" : "meta", by: nba ? "NBA tự áp" : "Improvements", label: `${u.label ?? u.resourceName}: ${u.action}`, ...r, undoneAt: u.undoneAt ?? null, link: nba ? "/" : "/improvements", ownOutcome: null }
}

export function fromPmaxBudget(b: BudgetApplyRecord): WriteEvent {
  return { id: `pmax_budget:${b.campaignId}:${b.appliedAt}`, source: "pmax_budget", sourceLabel: SOURCE_LABELS.pmax_budget, at: b.appliedAt, company: b.company, platform: "google", by: b.appliedBy, label: `${b.campaignName}: ngân sách ₫${Math.round(b.beforeVnd).toLocaleString("vi-VN")} → ₫${Math.round(b.afterVnd).toLocaleString("vi-VN")}/ngày`, campaignIds: [b.campaignId], pending: [], accountLevel: false, undoneAt: null, link: "/google-pmax", ownOutcome: null }
}

/**
 * Gộp + khử trùng — HÀM THUẦN. decision-memory bị nhiều đường ghi gọi KÈM nhật ký riêng của chúng (phiên xử lý, Improvements…)
 * → bỏ bản decision-memory nếu có bản ở nguồn khác cùng chiến dịch trong ±10 phút.
 */
export function mergeEvents(events: WriteEvent[]): WriteEvent[] {
  const byId = new Map<string, WriteEvent>()
  for (const e of events) byId.set(e.id, { ...byId.get(e.id), ...e })
  const all = [...byId.values()]
  const rich = all.filter((e) => e.source !== "dm")
  const dup = (d: WriteEvent) => rich.some((r) => r.company === d.company && Math.abs(Date.parse(r.at) - Date.parse(d.at)) <= 10 * 60_000 && d.campaignIds.some((c) => r.campaignIds.includes(c)))
  return all.filter((e) => e.source !== "dm" || !dup(e)).sort((a, b) => b.at.localeCompare(a.at))
}

// ── Đọc + lưu ────────────────────────────────────────────────
const FILE = path.join(process.cwd(), "data", "write-feed.json")
export const FEED_KEEP_DAYS = 400
export function readFeedFile(): WriteEvent[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as WriteEvent[] } catch { return [] } }

/** Đọc mọi nguồn (mỗi nguồn hỏng thì bỏ qua, ghi vào errors) → gộp với luồng đã lưu → lưu lại (trừ khi persist: false). */
export async function collectWrites(now: Date = new Date(), opts: { persist?: boolean } = {}): Promise<{ events: WriteEvent[]; errors: string[] }> {
  const errors: string[] = [], fresh: WriteEvent[] = []
  const add = async (name: string, f: () => Promise<(WriteEvent | null)[]> | (WriteEvent | null)[]) => {
    try { for (const e of await f()) if (e) fresh.push(e) } catch (err) { errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`) }
  }
  const COS: Company[] = companyIds()
  await add("write-log", async () => { const { listWrites } = await import("@/lib/write-guard"); return COS.flatMap((co) => listWrites(co)).map(fromGuard) })
  await add("pmax-controls", async () => { const { listControlExecutions } = await import("@/lib/pmax/controls"); return COS.flatMap((co) => listControlExecutions(co)).map(fromPmaxExec) })
  await add("search-controls", async () => { const { allSearchExecutions } = await import("@/lib/search/controls"); return allSearchExecutions().map(fromSearchExec) })
  await add("search-splits", async () => { const { allSplits } = await import("@/lib/search/split"); return allSplits().flatMap((s) => [fromSplit(s), ...fromSplitAssets(s)]) })
  await add("cases", async () => { const { listCases } = await import("@/lib/case/store"); return listCases().flatMap(fromCase) })
  await add("decision-memory", async () => { const { readAll } = await import("@/lib/decision-memory/store"); return readAll().map(fromDecision) })
  await add("undo-log", async () => { const { recentApplies } = await import("@/lib/apply-undo-log"); return recentApplies(5000).map(fromUndoLog) })
  await add("pmax-budget", async () => { const { readBudgetApplies } = await import("@/lib/pmax-insights/budget-apply-log"); return (await readBudgetApplies()).map(fromPmaxBudget) })
  const cutoff = now.getTime() - FEED_KEEP_DAYS * 86_400_000
  const events = mergeEvents([...readFeedFile(), ...fresh]).filter((e) => Date.parse(e.at) >= cutoff)
  // Chỉ job lưu (trang xem không ghi file — tránh hai nơi ghi cùng lúc).
  if (opts.persist !== false) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(events, null, 1)) }
  return { events, errors }
}
