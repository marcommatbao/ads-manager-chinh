// ============================================================
// Sửa trên Google — mục tiêu đặt giá + hành động chính (user chốt 27/09)
// ============================================================
// User muốn tool SỬA ĐƯỢC THẬT, không chỉ hướng dẫn. Ghi ở cấp TÀI KHOẢN nên
// tác động NGAY lên mọi chiến dịch dùng mục tiêu tài khoản → ba chốt phía
// server (giao diện chỉ là lớp thứ hai):
//   1. confirmText phải đúng "XAC NHAN" mới ghi thật;
//   2. đặt giá theo Mua hàng khi sau thay đổi KHÔNG còn hành động Mua hàng
//      chính nào có lượt trong 7 ngày → phải có acknowledgeNoSignal;
//   3. đọc lại trạng thái NGAY trước khi ghi; lệch với đề xuất → bỏ qua việc đó.
// Trình tự như mọi đường ghi khác: đọc → validate_only → ghi → ĐỌC LẠI → nhật ký
// để hoàn tác (chỉ đảo mục còn đúng như lúc tool đặt).

import fs from "fs"
import path from "path"
import type { Customer } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import type { GoogleFixProposal, TagDoctorReport } from "./tag-doctor"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export const CONFIRM_TEXT = "XAC NHAN"
const FILE = path.join(process.cwd(), "data", "google-goal-fixes.json")

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GoalFixChange { kind: GoogleFixProposal["kind"]; resourceName: string; label: string; before: boolean; after: boolean }
export interface GoalFixExecution {
  id: string
  company: Company
  at: string
  by: string
  mode: "validate" | "write"
  status: "done" | "failed"
  changes: GoalFixChange[]
  skipped: string[]
  errors: string[]
  readback: { label: string; before: string; after: string; expected: string; ok: boolean }[]
  undoneAt?: string
  undoReport?: string[]
}

/** Sau khi áp các việc đã chọn, còn hành động Mua hàng CHÍNH nào có lượt trong 7 ngày không — hàm thuần. */
export function purchaseSignalAfter(report: Pick<TagDoctorReport, "googleActions">, selected: GoogleFixProposal[]): boolean {
  const primaryAfter = new Map(report.googleActions.map((a) => [a.resourceName, a.primary]))
  for (const f of selected) if (f.kind === "action_primary") primaryAfter.set(f.resourceName, f.after)
  return report.googleActions.some((a) => a.category === "PURCHASE" && a.origin === "WEBSITE" && primaryAfter.get(a.resourceName) && a.last7 > 0)
}

export function needsNoSignalAck(report: Pick<TagDoctorReport, "googleActions">, selected: GoogleFixProposal[]): boolean {
  return selected.some((f) => f.kind === "goal_biddable" && f.category === "PURCHASE" && f.after) && !purchaseSignalAfter(report, selected)
}

async function readState(customer: Customer, fixes: GoogleFixProposal[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const goals = fixes.filter((f) => f.kind === "goal_biddable")
  const acts = fixes.filter((f) => f.kind === "action_primary")
  if (goals.length) {
    for (const r of (await customer.query(`SELECT customer_conversion_goal.resource_name, customer_conversion_goal.biddable FROM customer_conversion_goal`)) as Row[]) {
      out.set(String(r.customer_conversion_goal.resource_name), !!r.customer_conversion_goal.biddable)
    }
  }
  if (acts.length) {
    const list = acts.map((f) => `'${f.resourceName.replace(/'/g, "")}'`).join(",")
    for (const r of (await customer.query(`SELECT conversion_action.resource_name, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.resource_name IN (${list})`)) as Row[]) {
      out.set(String(r.conversion_action.resource_name), !!r.conversion_action.primary_for_goal)
    }
  }
  return out
}

async function apply(customer: Customer, changes: GoalFixChange[], validateOnly: boolean): Promise<void> {
  const opt = validateOnly ? { validate_only: true } : undefined
  const goals = changes.filter((c) => c.kind === "goal_biddable")
  const acts = changes.filter((c) => c.kind === "action_primary")
  // Hành động chính TRƯỚC, mục tiêu SAU: bật đặt giá Mua hàng khi hành động chính mới đã có mặt.
  if (acts.length) await customer.conversionActions.update(acts.map((c) => ({ resource_name: c.resourceName, primary_for_goal: c.after })), opt)
  if (goals.length) await customer.customerConversionGoals.update(goals.map((c) => ({ resource_name: c.resourceName, biddable: c.after })), opt)
}

const yesNo = (c: { kind: GoogleFixProposal["kind"] }, v: boolean, t: TFunction) => (c.kind === "goal_biddable" ? (v ? t("libmeta.gg.yesBid") : t("libmeta.gg.noBid")) : v ? t("libmeta.gg.primary") : t("libmeta.gg.secondary"))

function readLog(): GoalFixExecution[] {
  try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as GoalFixExecution[]) : [] } catch { return [] }
}
function writeLog(list: GoalFixExecution[]) {
  if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify(list.slice(-200), null, 1))
}
export function listGoalFixes(company: Company): GoalFixExecution[] {
  return readLog().filter((e) => e.company === company).reverse()
}

export class GoalFixError extends Error { constructor(message: string, public status = 400) { super(message) } }

export async function runGoalFix(input: {
  company: Company; report: TagDoctorReport; fixIds: string[]; actor: string
  validateOnly: boolean; confirmText?: string; acknowledgeNoSignal?: boolean
}, t: TFunction = makeT("vi")): Promise<GoalFixExecution> {
  const selected = input.report.fixes.filter((f) => input.fixIds.includes(f.id))
  if (!selected.length) throw new GoalFixError(t("libmeta.gf.noneSelected"))
  if (!input.validateOnly && input.confirmText?.trim() !== CONFIRM_TEXT) throw new GoalFixError(t("libmeta.gg.typeConfirm", { text: CONFIRM_TEXT }))
  if (!input.validateOnly && needsNoSignalAck(input.report, selected) && !input.acknowledgeNoSignal) {
    throw new GoalFixError(t("libmeta.gg.noSignalAck"))
  }
  const customer = getGoogleAdsCustomer(input.company)
  const exec: GoalFixExecution = {
    id: `gfix_${Date.now().toString(36)}`, company: input.company, at: new Date().toISOString(), by: input.actor,
    mode: input.validateOnly ? "validate" : "write", status: "failed", changes: [], skipped: [], errors: [], readback: [],
  }
  let before: Map<string, boolean>
  try { before = await readState(customer, selected) } catch (e) { exec.errors.push(t("libmeta.gg.readFail", { msg: googleAdsErrorMessage(e) })); return exec }
  for (const f of selected) {
    const cur = before.get(f.resourceName)
    if (cur === undefined) { exec.skipped.push(t("libmeta.gg.noneLeft", { label: f.label })); continue }
    if (cur === f.after) { exec.skipped.push(t("libmeta.gf.already", { label: f.label })); continue }
    if (cur !== f.before) { exec.skipped.push(t("libmeta.gg.changed", { label: f.label })); continue }
    exec.changes.push({ kind: f.kind, resourceName: f.resourceName, label: f.label, before: f.before, after: f.after })
  }
  if (!exec.changes.length) { exec.status = "done"; return exec }
  try { await apply(customer, exec.changes, true) } catch (e) { exec.errors.push(t("libmeta.gg.rejected", { msg: googleAdsErrorMessage(e) })); exec.changes = []; return exec }
  if (input.validateOnly) {
    exec.status = "done"
    exec.readback = exec.changes.map((c) => ({ label: c.label, before: yesNo(c, c.before, t), after: t("libmeta.gg.notWritten"), expected: yesNo(c, c.after, t), ok: true }))
    return exec
  }
  try { await apply(customer, exec.changes, false) } catch (e) { exec.errors.push(t("libmeta.gg.writeErr", { msg: googleAdsErrorMessage(e) })) }
  try {
    const after = await readState(customer, selected)
    exec.readback = exec.changes.map((c) => { const v = after.get(c.resourceName); return { label: c.label, before: yesNo(c, c.before, t), after: v === undefined ? "?" : yesNo(c, v, t), expected: yesNo(c, c.after, t), ok: v === c.after } })
  } catch (e) { exec.errors.push(t("libmeta.gg.readbackFail", { msg: googleAdsErrorMessage(e) })) }
  exec.status = !exec.errors.length && exec.readback.every((r) => r.ok) ? "done" : "failed"
  await withFileLock(FILE, async () => writeLog([...readLog(), exec]))
  return exec
}

export async function undoGoalFix(company: Company, execId: string, actor: string, t: TFunction = makeT("vi")): Promise<string[]> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === execId && e.company === company)
    if (!ex || ex.mode !== "write") throw new GoalFixError(t("libmeta.gg.undoNotFound"), 404)
    if (ex.undoneAt) throw new GoalFixError(t("libmeta.gg.undoDone"), 409)
    const customer = getGoogleAdsCustomer(company)
    const fake = ex.changes.map((c) => ({ id: c.resourceName, kind: c.kind, resourceName: c.resourceName, before: c.before, after: c.after, label: c.label, category: "", origin: "", name: "" })) as GoogleFixProposal[]
    const now = await readState(customer, fake)
    const report: string[] = []
    const revert: GoalFixChange[] = []
    for (const c of ex.changes) {
      if (now.get(c.resourceName) !== c.after) { report.push(t("libmeta.gg.undoChangedBy", { label: c.label })); continue }
      revert.push({ ...c, before: c.after, after: c.before })
    }
    if (revert.length) {
      // Đảo thứ tự khi hoàn tác: tắt mục tiêu trước, rồi mới trả hành động chính về như cũ.
      const goals = revert.filter((c) => c.kind === "goal_biddable"), acts = revert.filter((c) => c.kind === "action_primary")
      if (goals.length) await customer.customerConversionGoals.update(goals.map((c) => ({ resource_name: c.resourceName, biddable: c.after })))
      if (acts.length) await customer.conversionActions.update(acts.map((c) => ({ resource_name: c.resourceName, primary_for_goal: c.after })))
      const after = await readState(customer, fake)
      for (const c of revert) report.push(t("libmeta.gg.undoBack", { label: c.label, state: after.get(c.resourceName) === c.after ? t("libmeta.gg.undoBackYes") : t("libmeta.gg.undoBackNo"), value: yesNo(c, c.after, t) }))
    }
    ex.undoneAt = new Date().toISOString()
    ex.undoReport = [t("libmeta.gg.undoBy", { actor }), ...report]
    writeLog(log)
    return report
  })
}
