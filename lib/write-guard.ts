// ============================================================
// Đợt 11d — Lớp GHI AN TOÀN dùng chung cho các nút ghi Google Ads cũ (trước đây ghi thẳng, không hoàn tác)
// ============================================================
// Kiểm kê 29/09: /google-search thêm từ khoá / phủ định, n-gram, sửa RSA, dayparting ghi thẳng lên tài khoản — không Kiểm
// trước, không XAC NHAN, không hoàn tác. Lớp này: Kiểm trước (validate_only CẢ lệnh) → XAC NHAN → ghi MỘT lệnh nguyên khối →
// lưu LỆNH NGƯỢC vào data/write-log.json → hoàn tác một chạm (/api/write-log). Gọi thiếu XAC NHAN → 428 kèm kết quả kiểm
// trước, để giao diện hiện hộp xác nhận thay vì ghi.

import fs from "fs"
import path from "path"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"

export const WRITE_CONFIRM_TEXT = "XAC NHAN"
export class WriteGuardError extends Error { constructor(message: string, public status = 400, public validated = false) { super(message) } }

type MutateOp = { entity: string; operation: "create" | "update" | "remove"; resource: unknown }
export interface GuardedWrite {
  id: string; company: Company; at: string; by: string; source: string; label: string
  ops: number; inverse: MutateOp[]; status: "done" | "failed"; error?: string
  undoneAt?: string; undoneBy?: string; undoError?: string
}

const FILE = path.join(process.cwd(), "data", "write-log.json")
function readLog(): GuardedWrite[] { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as GuardedWrite[] } catch { return [] } }
function writeLog(l: GuardedWrite[]) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(l.slice(-1000), null, 1)) }
export const listWrites = (company?: Company, source?: string) => readLog().filter((w) => (!company || w.company === company) && (!source || w.source === source)).reverse().slice(0, 100)

/** Tên tài nguyên vừa tạo trong phản hồi mutateResources (…_result.resource_name) theo đúng thứ tự lệnh. */
export function createdNames(resp: unknown): (string | undefined)[] {
  const rs = ((resp as { mutate_operation_responses?: Record<string, { resource_name?: string } | undefined>[] })?.mutate_operation_responses ?? [])
  return rs.map((r) => Object.values(r ?? {}).find((v) => v && typeof v === "object" && "resource_name" in v)?.resource_name)
}

/**
 * Kiểm trước → (XAC NHAN) → ghi → lưu lệnh ngược. `inverseOf` nhận phản hồi ghi, trả lệnh hoàn tác (gỡ thứ vừa tạo, trả giá
 * trị cũ cho thứ vừa sửa — giá trị cũ do NƠI GỌI đọc trước khi ghi).
 */
export async function guardedMutate(input: {
  company: Company; source: string; label: string; ops: MutateOp[]
  inverseOf: (resp: unknown) => MutateOp[]
  validateOnly?: boolean; confirmText?: string; actor: string
}): Promise<{ validated: boolean; entry?: GuardedWrite; response?: unknown }> {
  if (!input.ops.length) throw new WriteGuardError("Không có thay đổi nào để ghi")
  const c = getGoogleAdsCustomer(input.company)
  try { await c.mutateResources(input.ops as never, { validate_only: true } as never) } catch (e) { throw new WriteGuardError(`Google từ chối khi kiểm — CHƯA ghi gì: ${googleAdsErrorMessage(e)}`, 422) }
  if (input.validateOnly) return { validated: true }
  if (input.confirmText?.trim() !== WRITE_CONFIRM_TEXT) throw new WriteGuardError(`Kiểm trước đã qua (${input.ops.length} thao tác). Gõ đúng “${WRITE_CONFIRM_TEXT}” để ghi lên tài khoản thật.`, 428, true)
  return withFileLock(FILE, async () => {
    const entry: GuardedWrite = { id: `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, company: input.company, at: new Date().toISOString(), by: input.actor, source: input.source, label: input.label, ops: input.ops.length, inverse: [], status: "failed" }
    let response: unknown
    try {
      response = await c.mutateResources(input.ops as never)
      entry.inverse = input.inverseOf(response)
      entry.status = "done"
    } catch (e) { entry.error = `Google không ghi gì: ${googleAdsErrorMessage(e)}` }
    writeLog([...readLog(), entry])
    if (entry.status === "failed") throw new WriteGuardError(entry.error!, 502)
    return { validated: true, entry, response }
  })
}

/** Hoàn tác MỘT lần ghi — một lệnh nguyên khối; hỏng thì không đổi gì, bấm lại được. */
export async function undoWrite(company: Company, id: string, actor: string): Promise<GuardedWrite> {
  return withFileLock(FILE, async () => {
    const l = readLog()
    const w = l.find((x) => x.id === id && x.company === company)
    if (!w || w.status !== "done") throw new WriteGuardError("Không tìm thấy lần ghi", 404)
    if (w.undoneAt) throw new WriteGuardError("Đã hoàn tác rồi", 409)
    if (!w.inverse.length) throw new WriteGuardError("Lần ghi này không có lệnh hoàn tác")
    try { await getGoogleAdsCustomer(company).mutateResources(w.inverse as never) } catch (e) {
      w.undoError = googleAdsErrorMessage(e); writeLog(l)
      throw new WriteGuardError(`Chưa hoàn tác được — Google từ chối (không đổi gì): ${w.undoError}`, 502)
    }
    w.undoneAt = new Date().toISOString(); w.undoneBy = actor; w.undoError = undefined
    writeLog(l)
    return w
  })
}
