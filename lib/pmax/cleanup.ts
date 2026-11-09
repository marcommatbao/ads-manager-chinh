// ============================================================
// Đợt 10d (D3) — Dọn PMax cũ: gắn nhãn "AdsCommand · PMax cũ" cho chiến dịch đã dừng lâu (KHÔNG xoá)
// ============================================================
// Đo 28/09: MBC 22 PMax tạm dừng, MBI 19 — lẫn vào báo cáo/danh sách, dễ bật nhầm. Xoá chiến dịch không hoàn tác được →
// tool CHỈ gắn nhãn (gỡ được), liệt kê chi 12 tháng + tháng cuối còn chi để người dùng quyết. Nhãn tạo nếu chưa có — cùng
// một lệnh với việc gắn (mã tạm -1). Hoàn tác = gỡ đúng các liên kết nhãn tool đã tạo.

import fs from "fs"
import path from "path"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { addDays, vnDate } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { customerIdOf, PMAX_CONFIRM_TEXT, PmaxControlError } from "./controls"
import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const OLD_LABEL = "AdsCommand · PMax cũ"
export const IDLE_DAYS = 60

export interface OldCampaign { id: string; name: string; started: string | null; spend12m: number; lastSpendMonth: string | null; labelled: boolean; suggest: boolean; why: string }

/** HÀM THUẦN: gợi ý gắn nhãn khi không còn chi trong IDLE_DAYS ngày gần nhất (theo tháng — Google trả theo tháng). */
export function classifyOld(rows: { id: string; name: string; started: string | null; months: Record<string, number>; labelled: boolean }[], today: string, t: TFunction = viT): OldCampaign[] {
  const cutoff = addDays(today, -IDLE_DAYS).slice(0, 7) + "-01"
  return rows.map((r) => {
    const spent = Object.entries(r.months).filter(([, v]) => v > 0).map(([m]) => m).sort()
    const last = spent.length ? spent[spent.length - 1] : null
    const spend12m = Object.values(r.months).reduce((s, v) => s + v, 0)
    const idle = !last || last < cutoff
    return { id: r.id, name: r.name, started: r.started, spend12m: Math.round(spend12m), lastSpendMonth: last ? last.slice(0, 7) : null, labelled: r.labelled,
      suggest: idle && !r.labelled, why: !last ? t("libgoogle.cl.whyNever") : idle ? t("libgoogle.cl.whyLast", { m: last.slice(5, 7), y: last.slice(0, 4) }) : t("libgoogle.cl.whyActive", { days: IDLE_DAYS }) }
  }).sort((a, b) => Number(b.suggest) - Number(a.suggest) || (a.lastSpendMonth ?? "").localeCompare(b.lastSpendMonth ?? ""))
}

export async function readOldPmax(company: Company, t: TFunction = viT): Promise<{ campaigns: OldCampaign[]; label: string }> {
  const c = getGoogleAdsCustomer(company)
  const to = addDays(vnDate(), -1), from = addDays(to, -365)
  const [camps, spend, labels] = await Promise.all([
    c.query(`SELECT campaign.id, campaign.name, campaign.start_date_time FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'PAUSED'`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, segments.month, metrics.cost_micros FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'PAUSED' AND segments.date BETWEEN '${from}' AND '${to}' AND metrics.cost_micros > 0`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, label.name FROM campaign_label WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'`) as Promise<Row[]>,
  ])
  const months = new Map<string, Record<string, number>>()
  for (const r of spend) { const m = months.get(String(r.campaign.id)) ?? {}; m[String(r.segments.month)] = (m[String(r.segments.month)] ?? 0) + (Number(r.metrics.cost_micros) || 0) / 1e6; months.set(String(r.campaign.id), m) }
  const lab = new Set(labels.filter((l) => l.label.name === OLD_LABEL).map((l) => String(l.campaign.id)))
  return { label: OLD_LABEL, campaigns: classifyOld(camps.map((r) => ({ id: String(r.campaign.id), name: String(r.campaign.name), started: r.campaign.start_date_time ? String(r.campaign.start_date_time).slice(0, 10) : null, months: months.get(String(r.campaign.id)) ?? {}, labelled: lab.has(String(r.campaign.id)) })), vnDate(), t) }
}

const FILE = path.join(process.cwd(), "data", "pmax-cleanup.json")
export interface CleanupExecution { id: string; company: Company; at: string; by: string; campaigns: { id: string; name: string; link?: string }[]; labelCreated: boolean; status: "done" | "failed"; errors: string[]; undoneAt?: string }
function readLog(): CleanupExecution[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as CleanupExecution[] } catch { return [] } }
function writeLog(l: CleanupExecution[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-200), null, 1)) }
export const listCleanups = (co: Company) => readLog().filter((e) => e.company === co).reverse().slice(0, 20)

export async function labelOld(input: { company: Company; ids: string[]; actor: string; validateOnly: boolean; confirmText?: string }, t: TFunction = viT): Promise<CleanupExecution> {
  if (!input.validateOnly && input.confirmText?.trim() !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(t("libgoogle.sc.errConfirm", { text: PMAX_CONFIRM_TEXT }))
  const c = getGoogleAdsCustomer(input.company)
  const cust = customerIdOf(input.company)
  const { campaigns } = await readOldPmax(input.company)
  // Chỉ chiến dịch PMax ĐANG TẠM DỪNG và chưa gắn nhãn — không tin danh sách client gửi.
  const pick = campaigns.filter((x) => input.ids.includes(x.id) && !x.labelled)
  const exec: CleanupExecution = { id: `pmaxcl_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor, campaigns: pick.map((p) => ({ id: p.id, name: p.name })), labelCreated: false, status: "failed", errors: [] }
  if (!pick.length) { exec.errors.push(t("libgoogle.cl.errNone")); return exec }
  const [lab] = (await c.query(`SELECT label.resource_name FROM label WHERE label.name = '${OLD_LABEL}'`)) as Row[]
  const labelRn = lab ? String(lab.label.resource_name) : `customers/${cust}/labels/-1`
  exec.labelCreated = !lab
  const ops = [
    ...(lab ? [] : [{ entity: "label", operation: "create", resource: { resource_name: labelRn, name: OLD_LABEL, description: "PMax đã dừng lâu — gắn bởi AdsCommand (Đợt 10d), gỡ nhãn là hoàn tác" } }]),
    ...pick.map((p) => ({ entity: "campaign_label", operation: "create", resource: { campaign: `customers/${cust}/campaigns/${p.id}`, label: labelRn } })),
  ]
  try { await c.mutateResources(ops as never, { validate_only: true } as never) } catch (e) { exec.errors.push(t("libgoogle.pa.errValidate", { msg: googleAdsErrorMessage(e) })); return exec }
  if (input.validateOnly) { exec.status = "done"; return exec }
  return withFileLock(FILE, async () => {
    try {
      const res = (await c.mutateResources(ops as never)) as { mutate_operation_responses?: Row[] }
      const resp = res?.mutate_operation_responses ?? []
      const off = lab ? 0 : 1
      exec.campaigns.forEach((p, i) => { p.link = resp[off + i]?.campaign_label_result?.resource_name })
      const after = await readOldPmax(input.company)
      const missing = pick.filter((p) => !after.campaigns.find((x) => x.id === p.id)?.labelled)
      if (missing.length) exec.errors.push(t("libgoogle.cl.errReadback", { list: missing.map((m) => m.name).join(", ") }))
    } catch (e) { exec.errors.push(t("libgoogle.pa.errWrite", { msg: googleAdsErrorMessage(e) })) }
    exec.status = exec.errors.length ? "failed" : "done"
    writeLog([...readLog(), exec])
    return exec
  })
}

export async function undoLabel(company: Company, id: string, t: TFunction = viT): Promise<CleanupExecution> {
  return withFileLock(FILE, async () => {
    const l = readLog()
    const ex = l.find((e) => e.id === id && e.company === company)
    if (!ex || ex.status !== "done") throw new PmaxControlError(t("libgoogle.cl.errNoRun"), 404)
    if (ex.undoneAt) throw new PmaxControlError(t("libgoogle.rsa.errUndone"), 409)
    const links = ex.campaigns.map((p) => p.link).filter((x): x is string => !!x)
    if (links.length) { try { await getGoogleAdsCustomer(company).campaignLabels.remove(links) } catch (e) { throw new PmaxControlError(t("libgoogle.cl.errUndoGoogle", { msg: googleAdsErrorMessage(e) }), 502) } }
    ex.undoneAt = new Date().toISOString()
    writeLog(l)
    return ex
  })
}
