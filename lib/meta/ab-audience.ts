// ============================================================
// A/B test TỆP ĐỐI TƯỢNG trên Meta — phần THUẦN + kho (data/ab-audience-tests.json)
// ============================================================
// Cách làm: giữ nguyên nhóm A đang chạy; tạo nhóm B trong CÙNG chiến dịch, chép y A (sự kiện tối ưu, cách trả giá, ngân sách,
// ghi nhận, cùng bài quảng cáo) — CHỈ đổi tệp đối tượng. Như vậy chênh lệch (nếu có) là do tệp, không do quảng cáo/sự kiện.
// Đo bằng đúng phép thử của trang So sánh tệp (compareGroup: chi phí mỗi kết quả, khoảng tin cậy Poisson 95%), tính từ ngày
// bắt đầu. Giới hạn nói thẳng: đây KHÔNG phải công cụ A/B chia tách người của Meta — hai tệp giao nhau vẫn tranh cùng người.
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { GoalKind } from "@/lib/case/goal-kind"
import type { CompareGroup } from "./audience-compare"
import { makeT, type TFunction } from "@/lib/i18n/translate"

/** Ít nhất ngần này ngày mới coi kết quả là "kết luận" (qua giai đoạn học + đủ 1 vòng tuần). */
export const AB_MIN_DAYS = 7
/** Ngân sách nhóm (VND/ngày) tối thiểu để thử có ý nghĩa. */
export const AB_MIN_DAILY_BUDGET = 50_000

export type AbStatus = "draft" | "running" | "ended" | "discarded"
export type AbVariant = { kind: "winning"; winningId: string; name: string } | { kind: "edit"; ageMin: number; ageMax: number; genders: number[] }

export interface AbAudienceTest {
  id: string
  company: string
  goalKind: GoalKind
  campaignId: string
  campaignName: string
  a: { adsetId: string; adsetName: string; summary: string }
  b: { adsetId: string; adsetName: string; adIds: string[]; summary: string }
  variant: AbVariant
  dailyBudget: number | null
  overlapPct: number
  warnings: string[]
  status: AbStatus
  createdBy: string
  createdAt: string
  startedAt?: string
  startedBy?: string
  endedAt?: string
  endedBy?: string
  /** Lúc kết thúc: kết luận + nhóm đã tạm dừng (nếu chọn). */
  result?: { verdict: CompareGroup["verdict"]; winnerId: string | null; summary: string; days: number; paused: string | null }
}

const FILE = () => path.join(process.cwd(), "data", "ab-audience-tests.json")
function readAll(): AbAudienceTest[] {
  try { const x = JSON.parse(fs.readFileSync(FILE(), "utf-8")); return Array.isArray(x) ? x : [] } catch { return [] }
}
export function listAbTests(company?: string): AbAudienceTest[] {
  return readAll().filter((t) => !company || t.company === company).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export const getAbTest = (id: string) => readAll().find((t) => t.id === id) ?? null
export async function saveAbTest(t: AbAudienceTest): Promise<void> {
  await withFileLock(FILE(), async () => {
    const all = readAll().filter((x) => x.id !== t.id)
    all.push(t)
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    writeFileAtomicSync(FILE(), JSON.stringify(all, null, 2))
  })
}
export const newAbId = () => `ab_${crypto.randomBytes(6).toString("hex")}`

/** Nhóm A đang trong một thử nghiệm chưa xong → không mở thử nghiệm thứ hai trên cùng nhóm. */
export function busyAdset(adsetId: string, tests: AbAudienceTest[] = readAll()): AbAudienceTest | null {
  return tests.find((t) => (t.status === "draft" || t.status === "running") && (t.a.adsetId === adsetId || t.b.adsetId === adsetId)) ?? null
}

type T = Record<string, unknown>
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)

/** Kiểm biến thể "đổi tuổi/giới tính" — HÀM THUẦN. Trả câu lỗi hoặc null. */
export function validateEdit(v: { ageMin: unknown; ageMax: unknown; genders: unknown }, t: TFunction = makeT("vi")): string | null {
  if (!isNum(v.ageMin) || !isNum(v.ageMax) || v.ageMin < 18 || v.ageMax > 65 || v.ageMin > v.ageMax) return t("libmeta.ab.errAge")
  if (!Array.isArray(v.genders) || !v.genders.every((g) => g === 1 || g === 2) || v.genders.length > 2) return t("libmeta.ab.errGender")
  return null
}

/** Tệp của nhóm B — HÀM THUẦN. "edit": giữ nguyên tệp A, chỉ thay tuổi/giới; "winning": dùng nguyên tệp đã lưu. */
export function variantTargeting(aTargeting: T, v: AbVariant, winningTargeting?: T): T {
  if (v.kind === "winning") return { ...(winningTargeting ?? {}) }
  const t: T = { ...aTargeting, age_min: v.ageMin, age_max: v.ageMax }
  if (v.genders.length) t.genders = v.genders
  else delete t.genders
  return t
}

const norm = (t: T) => JSON.stringify(Object.keys(t).sort().map((k) => [k, t[k]]))
/** Cảnh báo trước khi tạo — HÀM THUẦN. Trả { blockers, warnings }. */
export function planWarnings(input: { aTargeting: T; bTargeting: T; overlapPct: number; campaignBudget: boolean; adsetDaily: number | null; adsetLifetime: number | null; aStatus: string; activeAds: number; skippedAds: number }, t: TFunction = makeT("vi")): { blockers: string[]; warnings: string[] } {
  const nl = t("libmeta.numLocale")
  const blockers: string[] = [], warnings: string[] = []
  if (input.aStatus !== "ACTIVE") blockers.push(t("libmeta.ab.blkStatus", { status: input.aStatus }))
  if (input.campaignBudget) blockers.push(t("libmeta.ab.blkCbo"))
  if (input.adsetDaily === null && input.adsetLifetime === null && !input.campaignBudget) blockers.push(t("libmeta.ab.blkNoBudget"))
  if (input.adsetDaily !== null && input.adsetDaily < AB_MIN_DAILY_BUDGET) blockers.push(t("libmeta.ab.blkLowBudget", { budget: input.adsetDaily.toLocaleString(nl), min: AB_MIN_DAILY_BUDGET.toLocaleString(nl) }))
  if (!input.activeAds) blockers.push(t("libmeta.ab.blkNoAds"))
  if (norm(input.aTargeting) === norm(input.bTargeting)) blockers.push(t("libmeta.ab.blkSame"))
  if (input.adsetDaily !== null) warnings.push(t("libmeta.ab.warnSameBudget", { budget: input.adsetDaily.toLocaleString(nl) }))
  if (input.adsetLifetime !== null) warnings.push(t("libmeta.ab.warnLifetime"))
  warnings.push(t("libmeta.ab.warnNotSplit"))
  if (input.overlapPct >= 75) warnings.push(t("libmeta.ab.warnOverlap", { pct: input.overlapPct }))
  const adv = (t: T) => (t.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience === 1
  if (adv(input.aTargeting) || adv(input.bTargeting)) warnings.push(t("libmeta.ab.warnAdvantage"))
  if (input.skippedAds > 0) warnings.push(t("libmeta.ab.warnSkipped", { n: input.activeAds, skipped: input.skippedAds }))
  warnings.push(t("libmeta.ab.warnLearning"))
  return { blockers, warnings }
}

/** Số ngày đã chạy (làm tròn xuống), tính theo giờ VN — HÀM THUẦN. */
export function daysRunning(startedAt: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 86_400_000))
}

/** Lời kết luận của thử nghiệm từ kết quả so sánh — HÀM THUẦN. Chưa đủ ngày thì không bao giờ nói "kết luận". */
export function abReading(test: Pick<AbAudienceTest, "a" | "b">, g: CompareGroup | null, days: number, t: TFunction = makeT("vi")): { tone: "win_a" | "win_b" | "leaning" | "wait"; text: string } {
  if (!g) return { tone: "wait", text: t("libmeta.ab.readNoData") }
  const who = (id: string | null) => (id === test.a.adsetId ? t("libmeta.ab.whoA") : id === test.b.adsetId ? t("libmeta.ab.whoB") : "?")
  const early = days < AB_MIN_DAYS
  if (g.verdict === "winner" && !early) return { tone: g.winnerId === test.a.adsetId ? "win_a" : "win_b", text: t("libmeta.ab.readWin", { who: who(g.winnerId), summary: g.summary }) }
  if (g.verdict === "winner") return { tone: "leaning", text: t("libmeta.ab.readEarlyWin", { who: who(g.winnerId), days, min: AB_MIN_DAYS, summary: g.summary }) }
  if (g.verdict === "leaning") return { tone: "leaning", text: t("libmeta.ab.readLean", { who: who(g.winnerId), summary: g.summary }) }
  return { tone: "wait", text: `${early ? t("libmeta.ab.readEarly", { days, min: AB_MIN_DAYS }) : ""}${g.summary}` }
}
