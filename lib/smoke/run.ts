// ============================================================
// Đợt 20a — Tự chạy thử các truy vấn THẬT mỗi đêm (chỉ đọc)
// ============================================================
// Vì sao: 3 lỗi Đợt 18 (thiếu campaign.id trong SELECT, vượt trần 20 ảnh, vùng loại trừ cũ) đều là luật của Google mà test
// giả lập không bắt được — chỉ lộ ra khi người dùng bấm. Job này gọi đúng các HÀM ĐỌC tính năng đang dùng, khoảng 1 ngày,
// trên tài khoản thật; hỏng → Teams kênh IT TRƯỚC khi người dùng gặp. Chỉ báo khi có lỗi MỚI (hoặc đã hết lỗi), không lặp mỗi đêm.
// KHÔNG ghi gì lên tài khoản quảng cáo. Kết quả lưu data/smoke/last.json.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { addDays, vnDate } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { companyIds } from "@/lib/companies"

export interface ProbeResult { company: Company; id: string; label: string; ok: boolean; skipped?: boolean; ms: number; detail: string }
export interface SmokeRun { at: string; results: ProbeResult[] }
interface Probe { id: string; label: string; run: (co: Company, day: { from: string; to: string }) => Promise<string | { skip: string }> }

// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại).
const FILE = path.join(process.cwd(), "data", "smoke", "last.json")
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/access_token=[^&\s]+/g, "access_token=***").slice(0, 300)
/** Hàm X-quang gom lỗi từng truy vấn vào errors[] thay vì ném — ở đây coi errors[] không rỗng là HỎNG. */
const failIf = (errors: string[] | undefined, ok: string) => { if (errors?.length) throw new Error(errors.slice(0, 3).join(" · ")); return ok }

async function activeSplit(co: Company) {
  const { allSplits } = await import("@/lib/search/split")
  return allSplits().filter((r) => r.company === co && (r.step === "created" || r.step === "moved") && r.newCampaign).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null
}

async function trendProbe(platform: "meta" | "google", co: Company, to: string): Promise<string> {
  const { metaTrend, googleTrend } = await import("@/lib/trends/fetch")
  const { metaBreakdown, googleBreakdown } = await import("@/lib/trends/breakdown-fetch")
  const { checkTrend, checkBreakdown } = await import("@/lib/trends/consistency")
  const range = { from: addDays(to, -13), to }
  const t = await (platform === "meta" ? metaTrend(co, range, true) : googleTrend(co, range, true))
  const b = await (platform === "meta" ? metaBreakdown(co, range, true) : googleBreakdown(co, range, true))
  const a = checkTrend(t, range), c = checkBreakdown(b, t)
  const issues = [...a.issues, ...c.issues]
  // Nguồn ĐỘC LẬP: tổng chi trang Xử lý chiến dịch cùng kỳ (đọc theo đường khác — bắt chiến dịch bị sót, vd đã lưu trữ).
  const svc = await import("@/lib/case/service")
  const ov = await (platform === "meta" ? svc.metaOverview(co, range) : svc.googleOverview(co, range))
  const tSpend = t.campaigns.reduce((x, k) => x + k.cur.spend, 0)
  if (Math.abs(ov.totals.cost - tSpend) > Math.max(2000, ov.totals.cost * 0.02)) issues.push(`tổng chi Diễn biến ₫${Math.round(tSpend).toLocaleString("vi-VN")} ≠ Xử lý chiến dịch ₫${Math.round(ov.totals.cost).toLocaleString("vi-VN")} (${ov.rows.length} chiến dịch) — có chiến dịch bị sót?`)
  if (issues.length) throw new Error(issues.slice(0, 4).join(" · "))
  return `${a.summary} · ${c.summary}`
}

export const PROBES: Probe[] = [
  { id: "search_xray", label: "X-quang Search", run: async (co, d) => { const { searchXray } = await import("@/lib/search/xray"); const x = await searchXray(co, d, { force: true }); return failIf(x.errors, `${x.campaigns.length} chiến dịch · ${x.terms.length} lượt tìm`) } },
  { id: "pmax_xray", label: "X-quang PMax", run: async (co, d) => { const { pmaxXray } = await import("@/lib/pmax/xray"); const x = await pmaxXray(co, d, { force: true }); return failIf(x.errors, "đọc được") } },
  { id: "case_google_goals", label: "Xử lý chiến dịch — hạng mục đặt giá Google (tách lead)", run: async (co) => {
    const { googleBiddableCategories } = await import("@/lib/case/service"); const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
    const { googleGoalKind } = await import("@/lib/case/goal-kind")
    const m = await googleBiddableCategories(getGoogleAdsCustomer(co)); const lead = [...m.values()].filter((c) => googleGoalKind(c) === "leads").length
    return `${m.size} chiến dịch có hạng mục đặt giá · ${lead} thu lead` } },
  // Đợt 28: tab Diễn biến — số phải khớp nhau (theo ngày = theo chiến dịch; tách tuổi/giới/vị trí/thiết bị/giờ = tổng). 14 ngày.
  { id: "trends_meta", label: "Diễn biến + tách — Meta (đối chiếu số)", run: async (co, d) => trendProbe("meta", co, d.to) },
  { id: "trends_google", label: "Diễn biến + tách — Google (đối chiếu số)", run: async (co, d) => trendProbe("google", co, d.to) },
  { id: "meta_xray", label: "X-quang Meta", run: async (co, d) => { const { metaXray } = await import("@/lib/meta/xray"); const x = await metaXray(co, d, { force: true }); return failIf(x.errors, `${x.campaigns.length} chiến dịch`) } },
  { id: "split_assets", label: "Tài sản chiến dịch (tách)", run: async (co) => {
    const s = await activeSplit(co); if (!s) return { skip: "chưa có bản tách" }
    const { readCampaignAssets } = await import("@/lib/search/split-assets"); const a = await readCampaignAssets(co, s.sourceId); return `${a.length} liên kết tài sản`
  } },
  { id: "split_ads", label: "Quảng cáo bản tách (Ad strength)", run: async (co) => {
    const s = await activeSplit(co); if (!s) return { skip: "chưa có bản tách" }
    const { splitAds } = await import("@/lib/search/split"); const g = await splitAds(co, s.id); return `${g.length} nhóm`
  } },
  { id: "split_series", label: "Diễn biến bản tách", run: async (co) => {
    const s = await activeSplit(co); if (!s) return { skip: "chưa có bản tách" }
    const { splitSeries } = await import("@/lib/search/split-tracking"); const x = await splitSeries(co, s); return `${x.points.length} ngày`
  } },
  { id: "google_readiness", label: "Google — sẵn sàng đơn thật", run: async (co) => {
    const { googleReadiness } = await import("@/lib/conversions/google-compare"); const r = await googleReadiness(co, false); return failIf(r.errors, r.action.exists ? "có hành động" : "chưa có hành động")
  } },
  { id: "google_compare", label: "Google — so sánh đơn thật", run: async (co, d) => {
    const { googleCompare, googleReadiness } = await import("@/lib/conversions/google-compare"); const r = await googleReadiness(co, false)
    const x = await googleCompare(co, d, { daysOn: null, uploaded: 0, action: r.action.resourceName }); return `${x.length} chiến dịch`
  } },
  { id: "meta_readiness", label: "Meta — sẵn sàng đơn thật", run: async (co) => {
    const { metaReadiness } = await import("@/lib/conversions/meta-compare"); const r = await metaReadiness(co); if (r.error) throw new Error(r.error); return r.conversion ? "có chuyển đổi tuỳ chỉnh" : "chưa có chuyển đổi tuỳ chỉnh"
  } },
  { id: "meta_compare", label: "Meta — so sánh đơn thật", run: async (co, d) => { const { metaCompare } = await import("@/lib/conversions/meta-compare"); const x = await metaCompare(co, d); return `${x.length} chiến dịch` } },
  { id: "order_source", label: "Nguồn đơn", run: async (co, d) => {
    const { orderSourceReason, orderSourceOf, readOrders } = await import("@/lib/orders/sources")
    if (orderSourceReason(co)) return { skip: "chưa chọn nguồn đơn" }
    const rows = await readOrders(co, new Date(`${d.from}T00:00:00+07:00`), new Date(`${d.to}T23:59:59+07:00`)); return `${orderSourceOf(co)?.source}: ${rows.length} đơn/ngày`
  } },
]

export async function runProbes(now = new Date(), probes = PROBES, companies: Company[] = companyIds()): Promise<SmokeRun> {
  const y = addDays(vnDate(now), -1), day = { from: y, to: y }
  const results: ProbeResult[] = []
  for (const co of companies) for (const p of probes) {
    const t0 = Date.now()
    try {
      const r = await p.run(co, day)
      results.push(typeof r === "string" ? { company: co, id: p.id, label: p.label, ok: true, ms: Date.now() - t0, detail: r } : { company: co, id: p.id, label: p.label, ok: true, skipped: true, ms: Date.now() - t0, detail: r.skip })
    } catch (e) { results.push({ company: co, id: p.id, label: p.label, ok: false, ms: Date.now() - t0, detail: short(e) }) }
  }
  return { at: now.toISOString(), results }
}

/** Lỗi MỚI (lần trước chạy được hoặc chưa có) + đã HẾT lỗi — HÀM THUẦN. Không báo lại lỗi cũ mỗi đêm. */
export function diffRuns(prev: SmokeRun | null, cur: SmokeRun): { broken: ProbeResult[]; fixed: ProbeResult[]; stillBroken: ProbeResult[] } {
  const key = (r: ProbeResult) => `${r.company}:${r.id}`
  const was = new Map((prev?.results ?? []).map((r) => [key(r), r]))
  const broken = cur.results.filter((r) => !r.ok && (was.get(key(r))?.ok ?? true))
  const stillBroken = cur.results.filter((r) => !r.ok && was.get(key(r))?.ok === false)
  const fixed = cur.results.filter((r) => r.ok && !r.skipped && was.get(key(r))?.ok === false)
  return { broken, fixed, stillBroken }
}

export function readLastRun(): SmokeRun | null { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SmokeRun } catch { return null } }

export async function runSmoke(now = new Date()): Promise<{ run: SmokeRun; broken: number; fixed: number; stillBroken: number; sent: boolean; notConfigured?: boolean }> {
  const prev = readLastRun()
  const run = await runProbes(now)
  const d = diffRuns(prev, run)
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify(run, null, 1))
  let sent = false, notConfigured: boolean | undefined
  if (d.broken.length || d.fixed.length) {
    const { sendTeamsAlert } = await import("@/lib/teams-alert")
    const res = await sendTeamsAlert({
      title: d.broken.length ? `⚠ Tự kiểm AdsCommand: ${d.broken.length} chức năng đọc HỎNG` : `✓ Tự kiểm AdsCommand: ${d.fixed.length} chức năng đã chạy lại`,
      level: d.broken.length ? "danger" : "good",
      facts: [...d.broken.map((r) => ({ title: `✕ ${r.company} · ${r.label}`, value: r.detail })), ...d.fixed.map((r) => ({ title: `✓ ${r.company} · ${r.label}`, value: "đã chạy lại bình thường" }))],
      action: d.stillBroken.length ? `Còn ${d.stillBroken.length} lỗi cũ chưa sửa.` : "Kiểm ở Hệ thống → Lịch job → query_smoke.",
      // Bỏ trống webhookUrl = kênh cảnh báo hệ thống (IT).
    })
    sent = res.sent; notConfigured = res.notConfigured
  }
  return { run, broken: d.broken.length, fixed: d.fixed.length, stillBroken: d.stillBroken.length, sent, ...(notConfigured ? { notConfigured } : {}) }
}
