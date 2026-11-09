// ============================================================
// Đợt 14d — ĐỐI CHIẾU SỐ hằng tuần: con số các trang đang hiện vs truy vấn GỐC từ nền tảng (cùng 7 ngày)
// ============================================================
// Lỗi cộng gộp từng lọt qua mọi test (vd omni_purchase + purchase đếm đôi, tài khoản lỗi lặng lẽ biến mất khỏi tổng) — chỉ
// thấy khi đặt HAI đường tính cạnh nhau. Mỗi tuần: Tổng quan (googleAdsClient) / X-quang Search / X-quang PMax / X-quang Meta so
// với truy vấn gốc (GAQL cấp tài khoản / Meta insights cấp chiến dịch). Lệch > 5% → báo Teams IT. Kết quả lưu để trang Sức khoẻ
// tool hiện.
import fs from "fs"
import path from "path"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsClient } from "@/lib/google-client"
import { customerIdOf } from "@/lib/pmax/controls"
import { searchXray } from "@/lib/search/xray"
import { pmaxXray } from "@/lib/pmax/xray"
import { metaXray } from "@/lib/meta/xray"
import { metaGetAll, adAccountId } from "@/lib/case/meta-graph"
import { detectCompany } from "@/lib/company-detect"
import { addDays, vnDate } from "@/lib/case/dates"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { sendSystemAlert } from "@/lib/system-alert"
import type { Company } from "@/lib/case/types"
import { companyIds } from "@/lib/companies"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const MAX_DIFF = 0.05
const FILE = path.join(process.cwd(), "data", "numbers-check.json")

export interface NumberCheck { company: Company; name: string; tool: number | null; reference: number | null; diff: number | null; status: "ok" | "lech" | "loi"; note?: string }
export interface NumbersCheckResult { at: string; range: { from: string; to: string }; checks: NumberCheck[] }

/** Chấm một cặp — HÀM THUẦN. Cả hai ≈ 0 thì coi là khớp. */
export function judge(company: Company, name: string, tool: number | null, reference: number | null, note?: string): NumberCheck {
  if (tool == null || reference == null) return { company, name, tool, reference, diff: null, status: "loi", note: note ?? "không đọc được một trong hai phía" }
  if (Math.abs(tool) < 1 && Math.abs(reference) < 1) return { company, name, tool, reference, diff: 0, status: "ok", note }
  const diff = reference === 0 ? 1 : Math.abs(tool - reference) / Math.abs(reference)
  return { company, name, tool, reference, diff, status: diff > MAX_DIFF ? "lech" : "ok", note }
}

const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f() } catch { return null } }

export async function runNumbersCheck(now = new Date()): Promise<NumbersCheckResult> {
  const to = addDays(vnDate(now), -1), from = addDays(to, -6)
  const range = { from, to }
  const checks: NumberCheck[] = []
  const breakdown = await safe(() => googleAdsClient.getAccountBreakdown(range))
  // Meta gốc: insights cấp chiến dịch cả tài khoản dùng chung, chia công ty theo tên (1 lượt gọi).
  const metaRows = await safe(() => metaGetAll<Row>(`act_${adAccountId()}/insights`, { level: "campaign", time_range: JSON.stringify({ since: from, until: to }), fields: "campaign_name,spend", limit: "500" }, 3))
  for (const co of companyIds()) {
    const c = getGoogleAdsCustomer(co)
    const raw = await safe(async () => {
      const rows = (await c.query(`SELECT campaign.advertising_channel_type, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`)) as Row[]
      const by: Record<string, number> = {}
      for (const r of rows) by[String(r.campaign.advertising_channel_type)] = (by[String(r.campaign.advertising_channel_type)] ?? 0) + (Number(r.metrics.cost_micros) || 0) / 1e6
      return { total: Object.values(by).reduce((a, b) => a + b, 0), search: by["2"] ?? 0, pmax: by["10"] ?? 0 }
    })
    const acc = breakdown?.find((b) => b.accountId.replace(/-/g, "") === customerIdOf(co))
    checks.push(judge(co, "Tổng quan — chi Google", acc ? acc.costMicros / 1e6 : null, raw?.total ?? null))
    const sx = await safe(() => searchXray(co, range, { force: true }))
    checks.push(judge(co, "X-quang Search — chi", sx?.account.cost ?? null, raw?.search ?? null))
    const px = await safe(() => pmaxXray(co, range, { force: true }))
    checks.push(judge(co, "X-quang PMax — chi", px?.account.totals.cost ?? null, raw?.pmax ?? null))
    const mx = await safe(() => metaXray(co, range, { force: true }))
    const metaRef = metaRows ? metaRows.filter((r) => detectCompany(String(r.campaign_name)) === co).reduce((s, r) => s + (Number(r.spend) || 0), 0) : null
    checks.push(judge(co, "X-quang Meta — chi", mx?.totals.spend ?? null, metaRef))
  }
  const result: NumbersCheckResult = { at: new Date().toISOString(), range, checks }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify(result, null, 1))
  return result
}

export function lastNumbersCheck(): NumbersCheckResult | null { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as NumbersCheckResult } catch { return null } }

export async function runNumbersCheckJob(now = new Date()): Promise<{ result: NumbersCheckResult; alerted: boolean }> {
  const result = await runNumbersCheck(now)
  const bad = result.checks.filter((c) => c.status !== "ok")
  let alerted = false
  if (bad.length) {
    const vnd = (n: number | null) => (n == null ? "—" : `₫${Math.round(n).toLocaleString("vi-VN")}`)
    const r = await sendSystemAlert({
      level: bad.some((b) => b.status === "lech") ? "danger" : "warning",
      title: `⚠ Đối chiếu số tuần ${result.range.from.slice(5)} → ${result.range.to.slice(5)}: ${bad.length} chỗ lệch/không đọc được`,
      facts: bad.map((b) => ({ title: `${b.company} · ${b.name}`, value: b.status === "loi" ? `Không đọc được — ${b.note}` : `Tool ${vnd(b.tool)} vs gốc ${vnd(b.reference)} (lệch ${Math.round((b.diff ?? 0) * 100)}%)` })),
      action: "Con số trên trang đó có thể sai — kiểm lại trước khi dùng để quyết định ngân sách. Chi tiết: Cài đặt → Sức khoẻ tool.",
    }).catch(() => ({ sent: false }))
    alerted = !!r.sent
  }
  return { result, alerted }
}
