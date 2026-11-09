// ============================================================
// C2 — Sửa GTM qua API (user chốt 28/09: làm C1 + C2)
// ============================================================
// Publish GTM đổi mã theo dõi trên website THẬT ngay lập tức → cùng các chốt như "Sửa trên Google":
//   1. Ghi thật cần confirmText "XAC NHAN"; "Kiểm trước" chỉ dựng workspace tạm, biên dịch thử rồi XOÁ.
//   2. Đọc lại bản live NGAY trước khi sửa: thẻ đã đổi so với lúc chẩn đoán → bỏ qua việc đó.
//   3. Không bao giờ đụng "Default Workspace" (nơi người sửa tay) — luôn tạo workspace riêng.
//   4. Sau publish đọc lại bản live; nhật ký giữ bản trước để hoàn tác = publish lại bản trước,
//      CHỈ khi bản live vẫn là bản tool tạo (có người publish chen vào → không đè).
// Không sửa thẻ HTML tự viết; lỗi dataLayer (trang không đẩy sự kiện) để đội web sửa — user chốt 28/09.

import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import { GtmApiError, SCOPE_WRITE, gtmCall, readLive, type GtmLive } from "./gtm-api"
import type { GtmFixProposal, TagDoctorReport } from "./tag-doctor"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export const GTM_CONFIRM_TEXT = "XAC NHAN"
export const MAX_GTM_FIXES = 5
const FILE = path.join(process.cwd(), "data", "gtm-fixes.json")

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GtmFixExecution {
  id: string; company: Company; container: string; at: string; by: string
  mode: "validate" | "write"; status: "done" | "failed"
  applied: { fixId: string; label: string }[]
  skipped: string[]; errors: string[]
  prevVersionId: string | null; newVersionId: string | null
  readback: { label: string; ok: boolean; note: string }[]
  undoneAt?: string; undoReport?: string[]
}

/** Có việc nào làm Google mất tín hiệu đặt giá không — publish cần tích xác nhận riêng. */
export const needsSignalAck = (fixes: GtmFixProposal[]) => fixes.some((f) => f.kind === "tag_retrigger" && !!f.signalWarning)

export class GtmFixError extends Error { constructor(message: string, public status = 400) { super(message) } }

/** Điều kiện trước — hàm thuần: thẻ còn đúng như lúc chẩn đoán không. null = áp được. */
export type PrecheckCode = "gone" | "already" | "changed" | "noTrigger" | "trigChanged"
/** Mã kết quả điều kiện trước — logic dò theo MÃ, không dò chữ (chữ đổi theo ngôn ngữ). null = áp được. */
export function precheckCode(f: GtmFixProposal, live: Pick<GtmLive, "tags" | "triggers">): PrecheckCode | null {
  const t = live.tags.find((x) => x.id === f.tagId)
  if (!t) return "gone"
  if (f.kind === "tag_standard") {
    if (t.params.eventName === "standard" && t.params.standardEventName === f.toName) return "already"
    if (t.params.eventName === "standard" || t.params.customEventName !== f.fromName) return "changed"
    return null
  }
  if (!live.triggers.some((x) => x.id === f.toTriggerId)) return "noTrigger"
  const cur = [...t.firingTriggerIds].sort().join(",")
  if (cur === f.toTriggerId) return "already"
  if (cur !== [...f.fromTriggerIds].sort().join(",")) return "trigChanged"
  return null
}
export function precheck(f: GtmFixProposal, live: Pick<GtmLive, "tags" | "triggers">, t: TFunction = makeT("vi")): string | null {
  const c = precheckCode(f, live)
  return c ? t(`libmeta.gf.${c === "gone" ? "gone" : c}` as "libmeta.gf.gone", { label: f.label }) : null
}

/** Áp một đề xuất lên bản JSON thẻ của workspace — hàm thuần, trả bản mới. */
export function applyToTag(tag: Json, f: GtmFixProposal): Json {
  const next = JSON.parse(JSON.stringify(tag)) as Json
  if (f.kind === "tag_retrigger") { next.firingTriggerId = [f.toTriggerId]; return next }
  const params = (next.parameter ?? []) as Json[]
  const set = (key: string, value: string) => {
    const p = params.find((x) => x.key === key)
    if (p) p.value = value
    else params.push({ type: "template", key, value })
  }
  set("eventName", "standard")
  set("standardEventName", f.toName)
  next.parameter = params
  return next
}

function readLog(): GtmFixExecution[] {
  try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as GtmFixExecution[]) : [] } catch { return [] }
}
function writeLog(list: GtmFixExecution[]) {
  if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify(list.slice(-200), null, 1))
}
export function listGtmFixes(company: Company): GtmFixExecution[] {
  return readLog().filter((e) => e.company === company).reverse()
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runGtmFix(input: {
  company: Company; report: Pick<TagDoctorReport, "gtmFixes">; fixIds: string[]; actor: string
  validateOnly: boolean; confirmText?: string; acknowledgeSignalLoss?: boolean
}, t: TFunction = makeT("vi")): Promise<GtmFixExecution> {
  const selected = input.report.gtmFixes.filter((f) => input.fixIds.includes(f.id))
  if (!selected.length) throw new GtmFixError(t("libmeta.gf.noneSelected"))
  if (selected.length > MAX_GTM_FIXES) throw new GtmFixError(t("libmeta.gf.maxFixes", { max: MAX_GTM_FIXES }))
  const containers = [...new Set(selected.map((f) => f.container))]
  if (containers.length > 1) throw new GtmFixError(t("libmeta.gf.oneContainer"))
  if (!input.validateOnly && input.confirmText?.trim() !== GTM_CONFIRM_TEXT) throw new GtmFixError(t("libmeta.gf.typeConfirm", { text: GTM_CONFIRM_TEXT }))
  if (!input.validateOnly && needsSignalAck(selected) && !input.acknowledgeSignalLoss) {
    throw new GtmFixError(t("libmeta.gf.signalAck"))
  }

  const container = containers[0]
  const exec: GtmFixExecution = {
    id: `gtmfix_${Date.now().toString(36)}`, company: input.company, container, at: new Date().toISOString(), by: input.actor,
    mode: input.validateOnly ? "validate" : "write", status: "failed", applied: [], skipped: [], errors: [],
    prevVersionId: null, newVersionId: null, readback: [],
  }
  let live: GtmLive
  try { live = await readLive(container) } catch (e) { exec.errors.push(t("libmeta.gf.liveReadFail", { msg: msg(e) })); return exec }
  exec.prevVersionId = live.versionId
  const todo: GtmFixProposal[] = []
  for (const f of selected) { const why = precheck(f, live, t); if (why) exec.skipped.push(why); else todo.push(f) }
  if (!todo.length) { exec.status = "done"; return exec }

  // Workspace riêng — không đụng Default Workspace.
  let ws: string | null = null
  const dropWorkspace = async () => { if (ws) { try { await gtmCall("DELETE", ws, undefined, SCOPE_WRITE) } catch (e) { exec.errors.push(t("libmeta.gf.wsDropFail", { ws: String(ws), msg: msg(e) })) } ws = null } }
  try {
    const w = await gtmCall("POST", `${live.path}/workspaces`, { name: `AdsCommand ${exec.id}`, description: `Tool AdsCommand — ${input.actor} — ${todo.map((f) => f.label).join(" | ").slice(0, 400)}` }, SCOPE_WRITE)
    ws = String(w.path)
    for (const f of todo) {
      const tag = await gtmCall("GET", `${ws}/tags/${f.tagId}`, undefined, SCOPE_WRITE)
      await gtmCall("PUT", `${ws}/tags/${f.tagId}?fingerprint=${encodeURIComponent(String(tag.fingerprint ?? ""))}`, applyToTag(tag, f), SCOPE_WRITE)
      exec.applied.push({ fixId: f.id, label: f.label })
    }
    const pv = await gtmCall("POST", `${ws}:quick_preview`, {}, SCOPE_WRITE)
    if (pv.compilerError) throw new GtmApiError(t("libmeta.gf.compilerError"))
    if (pv.syncStatus?.mergeConflict) throw new GtmApiError(t("libmeta.gf.mergeConflict"))
  } catch (e) {
    exec.errors.push(e instanceof GtmApiError ? msg(e) : t("libmeta.gf.errPrefix", { msg: msg(e) }))
    exec.applied = []
    await dropWorkspace()
    if (!input.validateOnly) await withFileLock(FILE, async () => writeLog([...readLog(), exec]))
    return exec
  }

  if (input.validateOnly) {
    await dropWorkspace()
    exec.status = exec.errors.length ? "failed" : "done"
    exec.readback = exec.applied.map((a) => ({ label: a.label, ok: true, note: t("libmeta.gf.validateNote") }))
    return exec
  }

  try {
    const cv = await gtmCall("POST", `${ws}:create_version`, { name: `AdsCommand ${exec.id}`, notes: `${input.actor}: ${todo.map((f) => f.label).join(" | ")}` }, SCOPE_WRITE)
    if (cv.compilerError || !cv.containerVersion) throw new GtmApiError(t("libmeta.gf.noVersion"))
    ws = null // workspace đã được GTM dùng để tạo phiên bản
    exec.newVersionId = String(cv.containerVersion.containerVersionId)
    await gtmCall("POST", `${live.path}/versions/${exec.newVersionId}:publish`, {}, SCOPE_WRITE)
  } catch (e) {
    exec.errors.push(t("libmeta.gf.publishErr", { msg: msg(e), extra: exec.newVersionId ? t("libmeta.gf.publishErrExtra", { id: exec.newVersionId }) : "" }))
    await dropWorkspace()
  }
  try {
    const after = await readLive(container)
    const isNew = after.versionId === exec.newVersionId
    exec.readback = todo.map((f) => {
      const ok = isNew && precheckCode(f, after) === "already"
      return { label: f.label, ok, note: isNew ? (ok ? t("libmeta.gf.rbOk") : t("libmeta.gf.rbNo")) : t("libmeta.gf.rbOther", { live: after.versionId, expected: exec.newVersionId ?? "?" }) }
    })
  } catch (e) { exec.errors.push(t("libmeta.gf.rbFail", { msg: msg(e) })) }
  exec.status = !exec.errors.length && exec.readback.length > 0 && exec.readback.every((r) => r.ok) ? "done" : "failed"
  await withFileLock(FILE, async () => writeLog([...readLog(), exec]))
  return exec
}

export async function undoGtmFix(company: Company, execId: string, actor: string, t: TFunction = makeT("vi")): Promise<string[]> {
  return withFileLock(FILE, async () => {
    const log = readLog()
    const ex = log.find((e) => e.id === execId && e.company === company)
    if (!ex || ex.mode !== "write" || !ex.newVersionId || !ex.prevVersionId) throw new GtmFixError(t("libmeta.gf.undoNotFound"), 404)
    if (ex.undoneAt) throw new GtmFixError(t("libmeta.gf.undoDone"), 409)
    const live = await readLive(ex.container)
    if (live.versionId !== ex.newVersionId) {
      throw new GtmFixError(t("libmeta.gf.undoLiveChanged", { live: live.versionId, name: live.versionName ? ` “${live.versionName}”` : "", expected: ex.newVersionId }), 409)
    }
    await gtmCall("POST", `${live.path}/versions/${ex.prevVersionId}:publish`, {}, SCOPE_WRITE)
    const after = await readLive(ex.container)
    const report = [after.versionId === ex.prevVersionId ? t("libmeta.gf.undoRepublished", { id: ex.prevVersionId }) : t("libmeta.gf.undoNotBack", { id: ex.prevVersionId, live: after.versionId })]
    ex.undoneAt = new Date().toISOString()
    ex.undoReport = [t("libmeta.gf.undoBy", { actor }), ...report]
    writeLog(log)
    return report
  })
}

