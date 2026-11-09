// ============================================================
// Kho phiên "Xử lý chiến dịch" — MỖI PHIÊN MỘT TỆP data/cases/<id>.json
// ============================================================
// Vì sao không dồn một tệp: bước thực thi gọi Google hàng chục giây trong
// khoá; dồn một tệp thì mọi phiên khác đứng chờ theo. Khoá theo từng phiên
// (withFileLock(key = đường dẫn tệp)) chỉ chặn đúng phiên đang thao tác.
// Ghi bằng writeFileAtomicSync (giống lib/apply-undo-log.ts) — ghi hụt giữa
// chừng không để lại tệp nửa vời.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { withFileLock } from "@/lib/file-lock"
import type { NegativeKw, SimulationResult } from "./simulate-negatives"
import type { CaseEvidence, Company, Diagnosis } from "./types"
import type { CaseBasis } from "./verdict"
import { isCompany } from "@/lib/companies/registry";
import { CaseError } from "./errors"

const DIR = path.join(process.cwd(), "data", "cases")
/** Phiên đóng quá 180 ngày thì dọn — kết quả đo lại đã có, tài khoản đã khác xa. */
const KEEP_MS = 180 * 24 * 60 * 60 * 1000

export type CaseStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type CaseAction =
  | { id: string; type: "ADD_NEGATIVES"; label: string; selected: boolean; campaignIds: string[]; negatives: NegativeKw[]; simulation?: SimulationResult
      /** 19/10: phủ định trong gói bị bỏ vì chặn từ khoá đang bật / lượt tìm thương hiệu của chiến dịch thương hiệu. */
      dropped?: { text: string; why: string }[] }
  | { id: string; type: "REMOVE_NEGATIVE"; label: string; selected: boolean; campaignId: string; text: string; match: string }
  | { id: string; type: "PAUSE_CAMPAIGN"; label: string; selected: boolean; campaignId: string }
  /** Thêm từ vào danh sách phủ định DÙNG CHUNG (shared set) — mọi chiến dịch gắn list đều hưởng. */
  | { id: string; type: "ADD_TO_SHARED_LIST"; label: string; selected: boolean; sharedSetId: string; sharedSetName: string; negatives: NegativeKw[]; simulation?: SimulationResult }
  /** Bỏ từ khỏi danh sách dùng chung — dùng cho từ chặn được câu tìm của người mua (`reasons` = bằng chứng). */
  | { id: string; type: "REMOVE_FROM_SHARED_LIST"; label: string; selected: boolean; sharedSetId: string; sharedSetName: string; words: { text: string; match: string }[]; reasons: string[] }
  /** Gắn danh sách dùng chung vào chiến dịch. `flagged` = từ dạng cụm/rộng quá chung, cần người duyệt xem. */
  | { id: string; type: "ATTACH_SHARED_LIST"; label: string; selected: boolean; campaignId: string; sharedSetId: string; sharedSetName: string; simulation?: SimulationResult; flagged?: string[] }
  // ── Facebook (Đợt 3). PAUSE_CAMPAIGN dùng chung, nền tảng lấy theo phiên. ──
  /** Đổi ngân sách ngày cấp chiến dịch (VND). `before` = số lúc đề xuất; lúc ghi đọc lại số thật. */
  | { id: string; type: "SET_CAMPAIGN_BUDGET"; label: string; selected: boolean; campaignId: string; before: number; after: number; reason: string }
  | { id: string; type: "PAUSE_ADSET"; label: string; selected: boolean; adsetId: string; adsetName: string; reason: string }
  /** Loại vị trí (khoá báo cáo, vd "facebook:facebook_reels") khỏi một nhóm. RESET giai đoạn học. */
  | { id: string; type: "EXCLUDE_PLACEMENT"; label: string; selected: boolean; adsetId: string; adsetName: string; placements: string[]; placementLabels: string[]; automatic: boolean; cost: number; results: number; resultLabel: string; warnings: string[] }
  // ── Đợt 5: nhóm mới với sự kiện chuẩn (Meta cấm đổi sự kiện nhóm đã chạy — đo 27/09) ──
  /** Tạo nhóm mới TẠM DỪNG, sao nhóm nguồn, tạo lại quảng cáo bằng creative_id cũ. `event` = enum custom_event_type. */
  | { id: string; type: "CREATE_ADSET_WITH_EVENT"; label: string; selected: boolean; sourceAdsetId: string; sourceAdsetName: string; pixelId: string; event: string; eventLabel: string; perWeek: number | null; lowSignal: boolean; alternatives: { event: string; label: string; perWeek: number }[]; warnings: string[]; lowSignalAck?: boolean; /** Đợt 12: nhóm mới CHỈ tính lượt bấm 7 ngày (bỏ đơn chỉ-xem 1 ngày). */ clickOnly?: boolean; /** Đợt 23 (3d): chiến dịch thu lead — nhóm mới ĐỔI cách tối ưu sang chuyển đổi trên web (nhóm nguồn có thể tối ưu click…). */ forceGoal?: "OFFSITE_CONVERSIONS" }
  /** Bật nhóm mới (và quảng cáo của nó); tuỳ chọn tạm dừng nhóm nguồn cùng lúc. Sinh ra SAU khi tạo nhóm. */
  | { id: string; type: "ACTIVATE_NEW_ADSET"; label: string; selected: boolean; newAdsetId: string; newAdIds: string[]; sourceAdsetId: string; pauseSource: boolean }

export interface ManualTask {
  id: string
  title: string
  detail: string
  assignee: string | null
  status: "open" | "done"
  createdAt: string
  doneAt?: string
  /** Lần nhắc Teams gần nhất (lib/case/board.ts) — mỗi việc tối đa 1 lần/ngày. */
  lastRemindedAt?: string
}

export interface ReadbackRow { label: string; before: string; after: string; expected: string; ok: boolean }

export interface Execution {
  id: string
  at: string
  by: string
  idempotencyKey: string
  /** "validate" = chỉ nhờ Google kiểm hợp lệ, KHÔNG ghi gì. Thiếu trường (bản cũ) = "write". */
  mode?: "validate" | "write"
  status: "done" | "failed"
  warnings: string[]
  errors: string[]
  /** Resource name các phủ định vừa tạo — để hoàn tác. */
  created: string[]
  /** Phủ định đã xoá — để thêm lại khi hoàn tác. */
  removed: { campaignId: string; text: string; match: string }[]
  /** Chiến dịch đã đổi trạng thái — trạng thái trước để trả lại. */
  paused: { campaignId: string; before: string }[]
  /** Resource name từ vừa thêm vào danh sách dùng chung — để hoàn tác. */
  sharedCreated?: string[]
  /** Từ đã bỏ khỏi danh sách dùng chung — để thêm lại khi hoàn tác. */
  sharedRemoved?: { sharedSetId: string; text: string; match: string }[]
  /** Resource name liên kết chiến dịch ↔ danh sách vừa tạo — để hoàn tác. */
  attached?: string[]
  /** Facebook: ảnh chụp trước khi ghi của từng đối tượng đã đổi — để hoàn tác + so đọc lại. */
  metaChanges?: MetaChange[]
  readback: ReadbackRow[]
  undoneAt?: string
  undoReport?: string[]
}

export type MetaChange =
  | { kind: "campaign_status"; id: string; name: string; before: string; after: string }
  | { kind: "campaign_budget"; id: string; name: string; before: number; after: number }
  | { kind: "adset_status"; id: string; name: string; before: string; after: string }
  /** targeting đầy đủ trước/sau — hoàn tác ghi lại `before` nếu vị trí hiện tại còn đúng `after`. */
  | { kind: "adset_targeting"; id: string; name: string; before: Record<string, unknown>; after: Record<string, unknown> }
  /** Đợt 5: nhóm + quảng cáo tool tạo. Hoàn tác: chưa phân phối → xoá; đã phân phối → tạm dừng. */
  | { kind: "adset_created"; id: string; name: string; adIds: string[]; sourceAdsetId: string; event: string; after: string }
  | { kind: "ad_status"; id: string; name: string; before: string; after: string }

/** 14/10/2026: ảnh chụp chẩn đoán lúc đo lại — đủ để giải thích "vì sao" mà không phải gọi lại Google/Meta.
 *  `facts` = số kỳ đo (Google: clicks, impressions, impressionShare, lostIsBudget, lostIsRank; Meta: clicks, linkClicks,
 *  landingViews, frequency, reach); `causes` = bộ tìm nguyên nhân của bước 4 chạy lại trên số kỳ đo. */
export interface RemeasureDiag {
  from: string
  to: string
  facts: Record<string, number | null>
  causes: { id: string; title: string; money: number | null }[]
}
export interface RemeasureEntry {
  due: string
  status: "pending" | "done"
  result?: Record<string, number | null>
  diag?: RemeasureDiag
  /** Mốc thêm vì mốc cuối "chưa đủ dữ liệu" (tối đa MAX_REMEASURE_EXTENSIONS lần). */
  extended?: boolean
  /** Ngày bắt đầu kỳ đo (YYYY-MM-DD) của vòng đo này. Thiếu (phiên cũ) = ngày thực hiện đầu tiên chưa hoàn tác. */
  start?: string
}

export interface CampaignCase {
  id: string
  platform: "google" | "facebook"
  company: Company
  campaignId: string
  campaignName: string
  range: { from: string; to: string }
  step: CaseStep
  status: "open" | "done" | "reopened"
  goal: null | { basis: CaseBasis; target: number; ceiling: number; where: string; confirmedBy: string; confirmedAt: string }
  evidence: CaseEvidence | null
  diagnosis: Diagnosis | null
  actions: CaseAction[]
  manualTasks: ManualTask[]
  executions: Execution[]
  remeasure: RemeasureEntry[]
  /** 14/10: lần mở lại gần nhất (tự động ở mốc cuối hoặc bấm "Mở lại ở bước 4"). Vòng đo mới tính từ thực hiện SAU mốc này. */
  reopenedAt?: string
  /** 14/10: lần "Kiểm tra ngay" gần nhất (đo ngoài lịch, chỉ để xem chẩn đoán — không đổi lịch, không mở lại). */
  latestCheck?: { at: string; verdict: number; result: Record<string, number | null>; diag: RemeasureDiag }
  createdBy: string
  createdAt: string
  updatedAt: string
}

const fileOf = (id: string) => {
  if (!/^case_[a-z0-9_]+$/.test(id)) throw new Error("Mã phiên không hợp lệ")
  return path.join(DIR, `${id}.json`)
}

export function newCaseId(): string {
  return `case_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function readCase(id: string): CampaignCase | null {
  try {
    const f = fileOf(id)
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, "utf-8")) as CampaignCase
  } catch {
    return null
  }
}

function writeCase(c: CampaignCase): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
  writeFileAtomicSync(fileOf(c.id), JSON.stringify(c, null, 1))
}

export async function createCase(c: Omit<CampaignCase, "id" | "createdAt" | "updatedAt">): Promise<CampaignCase> {
  const now = new Date().toISOString()
  const full: CampaignCase = { ...c, id: newCaseId(), createdAt: now, updatedAt: now }
  await withFileLock(fileOf(full.id), async () => writeCase(full))
  return full
}

/**
 * Nhập phiên từ bản chạy khác (Đợt 6 · B) — GIỮ NGUYÊN id + lịch đo lại. Kiểm hình dạng
 * tối thiểu; trùng id → bỏ qua (không bao giờ ghi đè phiên đang có).
 */
export function validateImportedCase(x: unknown): string | null {
  const c = x as Partial<CampaignCase>
  if (!c || typeof c !== "object") return "không phải phiên"
  if (typeof c.id !== "string" || !/^case_[a-z0-9_]+$/.test(c.id)) return "mã phiên không hợp lệ"
  if (!isCompany(c.company)) return "công ty không hợp lệ"
  if (c.platform !== "google" && c.platform !== "facebook") return "nền tảng không hợp lệ"
  if (typeof c.campaignId !== "string" || !/^\d+$/.test(c.campaignId)) return "campaignId không hợp lệ"
  if (!c.evidence || !Array.isArray(c.executions) || !Array.isArray(c.remeasure) || !Array.isArray(c.actions)) return "thiếu bằng chứng / lần thực hiện / lịch đo lại"
  return null
}

export async function importCase(c: CampaignCase): Promise<"imported" | "exists"> {
  return withFileLock(fileOf(c.id), async () => {
    if (readCase(c.id)) return "exists"
    writeCase({ ...c, updatedAt: new Date().toISOString() })
    return "imported"
  })
}

/**
 * Đọc–sửa–ghi trong khoá của phiên. `fn` có thể async (gọi Google) — chỉ phiên
 * này phải chờ. `fn` trả null = không ghi gì.
 */
export async function updateCase<T>(
  id: string,
  fn: (c: CampaignCase) => Promise<{ next: CampaignCase | null; result: T }>,
): Promise<T> {
  return withFileLock(fileOf(id), async () => {
    const cur = readCase(id)
    if (!cur) throw new CaseError("Không tìm thấy phiên", 404, { key: "libcase.s.http.caseNotFound" })
    const { next, result } = await fn(cur)
    if (next) writeCase({ ...next, updatedAt: new Date().toISOString() })
    return result
  })
}

/** Phiên gần nhất trước (mới nhất lên đầu); dọn phiên đóng quá hạn. */
/**
 * Chiến dịch có phiên đang mở (chưa đóng) không. Các đường TỰ ĐỘNG tăng ngân
 * sách phải bỏ qua chiến dịch này — vừa xử lý vừa bị máy tự tăng tiền thì số
 * đo lại không còn nói được gì (user chốt 27/09). Lỗi đọc kho → coi như CÓ
 * phiên: chặn nhầm một lượt tăng rẻ hơn tăng nhầm.
 */
export function hasOpenCase(campaignId: string): boolean {
  try {
    return listCases({ campaignId: String(campaignId) }).some((c) => c.status !== "done")
  } catch {
    return true
  }
}

export function listCases(filter?: { company?: Company; campaignId?: string }): CampaignCase[] {
  if (!fs.existsSync(DIR)) return []
  const now = Date.now()
  const out: CampaignCase[] = []
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue
    const c = readCase(f.slice(0, -5))
    if (!c) continue
    if (c.status === "done" && now - Date.parse(c.updatedAt) > KEEP_MS) {
      try { fs.unlinkSync(path.join(DIR, f)) } catch { /* dọn lần sau */ }
      continue
    }
    if (filter?.company && c.company !== filter.company) continue
    if (filter?.campaignId && c.campaignId !== filter.campaignId) continue
    out.push(c)
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
