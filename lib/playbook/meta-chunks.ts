// ============================================================
// Sổ kinh nghiệm — số Meta lưu theo KHOẢNG 15 NGÀY, tải dần mỗi đêm
// ============================================================
// Đo 28/09 (một nửa kỳ 90 ngày): nhóm × vị trí ~3.000 dòng (13 giây/trang),
// nhóm × tuổi × giới ~6.000 dòng (22 giây/trang) → một lượt 180 ngày ≈ 12 phút
// và ~40 lượt gọi, trong khi app ở bậc development chỉ ~60 lượt/giờ CHO CẢ APP.
// Nên: chia 180 ngày thành 12 khoảng 15 ngày; mỗi đêm tải khoảng hiện tại (làm
// mới) + MỘT khoảng cũ còn thiếu (~8 lượt, < 2 phút). Khoảng đã qua tải một lần.
// Tuổi và giới tách hai truy vấn nhỏ (gộp thì số dòng nhân lên ~3 lần).

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { adAccountId, metaGetAll } from "@/lib/case/meta-graph"
import { vnDate } from "@/lib/case/dates"
import { halfOf } from "./collect-meta"
import type { Half } from "./engine"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DIR = path.join(process.cwd(), "data", "playbook", "meta-chunks")
export const CHUNK_DAYS = 15
export const CHUNKS_NEEDED = 12 // 180 ngày

export interface CRow extends Half { key: string; name: string; campaignId: string; campaignName: string; adsetId: string }
export interface MetaChunk {
  id: number; since: string; until: string
  /** true = khoảng đã qua hết → không tải lại. */
  complete: boolean
  fetchedAt: string
  adset: CRow[]; placement: CRow[]; age: CRow[]; gender: CRow[]; ad: CRow[]
}

const DAY = 86_400_000
const dayNo = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY)
const ymdOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
/** Khoảng cố định theo lịch (không trôi theo ngày chạy) → khoảng đã qua giữ nguyên nghĩa. */
export const chunkIdOf = (ymd: string) => Math.floor(dayNo(ymd) / CHUNK_DAYS)
export const chunkRange = (id: number) => ({ since: ymdOf(id * CHUNK_DAYS), until: ymdOf(id * CHUNK_DAYS + CHUNK_DAYS - 1) })

/** Các khoảng cần có cho 180 ngày tính tới hôm nay — mới nhất trước. */
export function neededChunks(today: string): number[] {
  const cur = chunkIdOf(today)
  return Array.from({ length: CHUNKS_NEEDED }, (_, i) => cur - i)
}

const fileOf = (id: number) => path.join(DIR, `${id}.json`)
export function readChunk(id: number): MetaChunk | null {
  try { return fs.existsSync(fileOf(id)) ? (JSON.parse(fs.readFileSync(fileOf(id), "utf-8")) as MetaChunk) : null } catch { return null }
}

const row = (r: Row, key: string, name: string): CRow => ({ key, name, campaignId: String(r.campaign_id), campaignName: String(r.campaign_name ?? ""), adsetId: String(r.adset_id ?? ""), ...halfOf(r) })

export async function fetchChunk(id: number, today: string): Promise<{ chunk: MetaChunk; calls: number }> {
  const r = chunkRange(id)
  const until = r.until > today ? today : r.until
  const range = JSON.stringify({ since: r.since, until })
  const act = `act_${adAccountId()}`
  const F = "campaign_id,campaign_name,adset_id,adset_name,spend,actions"
  let calls = 0
  const q = async (level: string, fields: string, breakdowns?: string) => {
    calls++
    return metaGetAll<Row>(`${act}/insights`, { level, time_range: range, fields, limit: "500", ...(breakdowns ? { breakdowns } : {}) }, 40)
  }
  const adset = (await q("adset", F)).map((x) => row(x, String(x.adset_id), String(x.adset_name)))
  const placement = (await q("adset", F, "publisher_platform,platform_position")).map((x) => row(x, `${x.adset_id}|${x.publisher_platform}|${x.platform_position}`, `${x.adset_name}|${x.publisher_platform}|${x.platform_position}`))
  const age = (await q("adset", F, "age")).map((x) => row(x, `${x.adset_id}|${x.age}`, `${x.adset_name}|${x.age}`))
  const gender = (await q("adset", F, "gender")).map((x) => row(x, `${x.adset_id}|${x.gender}`, `${x.adset_name}|${x.gender}`))
  const ad = (await q("ad", `${F},ad_id,ad_name`)).map((x) => row(x, String(x.ad_id), String(x.ad_name)))
  return { chunk: { id, since: r.since, until, complete: r.until < today, fetchedAt: new Date().toISOString(), adset, placement, age, gender, ad }, calls }
}

/** Job hằng đêm: làm mới khoảng hiện tại + tải tối đa `backfill` khoảng cũ còn thiếu. */
export async function syncMetaChunks(opts: { backfill?: number; now?: Date } = {}): Promise<{ fetched: number[]; have: number; calls: number; errors: string[] }> {
  const today = vnDate(opts.now)
  const need = neededChunks(today)
  // Khoảng thiếu, GẦN NHẤT trước — để nửa kỳ sau (dùng nhiều nhất) có số sớm.
  const missing = need.slice(1).filter((id) => !readChunk(id)?.complete)
  const todo = [need[0], ...missing.slice(0, opts.backfill ?? 1)]
  const fetched: number[] = [], errors: string[] = []
  let calls = 0
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
  for (const id of todo) {
    try {
      const { chunk, calls: c } = await fetchChunk(id, today)
      calls += c
      writeFileAtomicSync(fileOf(id), JSON.stringify(chunk))
      fetched.push(id)
    } catch (e) {
      errors.push(`Khoảng ${chunkRange(id).since}–${chunkRange(id).until}: ${e instanceof Error ? e.message : String(e)}`)
      break // Meta chặn/nghẽn → dừng, đêm sau làm tiếp
    }
  }
  // Dọn khoảng quá cũ (ngoài 180 ngày + 2 khoảng dự phòng).
  for (const f of fs.readdirSync(DIR)) { const n = Number(f.replace(".json", "")); if (Number.isFinite(n) && n < need[need.length - 1] - 2) { try { fs.unlinkSync(path.join(DIR, f)) } catch { /* lần sau */ } } }
  return { fetched, have: need.filter((id) => readChunk(id)).length, calls, errors }
}

/** Gộp các khoảng đã có thành 2 nửa kỳ (6 khoảng gần nhất = nửa sau). */
export function loadHalves(today: string): { h1: MetaChunk[]; h2: MetaChunk[]; have: number } {
  const need = neededChunks(today)
  const got = need.map((id) => readChunk(id))
  return { h2: got.slice(0, 6).filter((x): x is MetaChunk => !!x), h1: got.slice(6).filter((x): x is MetaChunk => !!x), have: got.filter(Boolean).length }
}
