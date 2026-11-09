// ============================================================
// Đợt 24c — phiên bản của thư mục data/ + chuyển đổi tự động khi nâng cấp
// ============================================================
// Mỗi bản cài khách giữ data/ riêng. Đổi định dạng một tệp (vd thêm trường bắt buộc, đổi tên khoá) mà không có đường chuyển
// thì nâng cấp = hỏng / mất dữ liệu. Nay:
//   data/data-version.json { version, updatedAt, history[] }
//   • thiếu tệp + data/ đã có dữ liệu → coi là v1 (định dạng tại Đợt 24c — mốc gốc); data/ trống → ghi thẳng bản mới nhất;
//   • version < DATA_VERSION → SAO LƯU cả data/ vào data/backups/<thời điểm>-v<cũ>/ rồi chạy lần lượt từng bước chuyển, ghi
//     version sau MỖI bước (hỏng giữa chừng thì lần sau chạy tiếp từ bước hỏng, bản sao lưu còn nguyên);
//   • version > DATA_VERSION (chạy mã CŨ trên dữ liệu MỚI) → KHÔNG đụng gì, cảnh báo to ở log + trang Sức khoẻ.
// Không bao giờ chặn khởi động: lỗi chỉ ghi log + hiện ở Cài đặt → Sức khoẻ hệ thống.
import fs from "fs"
import path from "path"

/** Phiên bản định dạng data/ mà mã này hiểu. Tăng khi thêm một bước vào MIGRATIONS. */
export const DATA_VERSION = 1

export interface DataMigration {
  /** Phiên bản SAU bước này (2, 3…). */
  to: number
  name: string
  /** Chỉ sửa tệp trong `dataDir`. Ném lỗi = dừng, giữ phiên bản cũ. Phải chạy lại được (idempotent). */
  run: (dataDir: string) => void | Promise<void>
}

/** v1 = mốc gốc (Đợt 24c, 06/10/2026). Bước sau: { to: 2, name: "…", run: (dir) => { … } }. */
export const MIGRATIONS: DataMigration[] = []

export type DataStatus = "current" | "fresh" | "baseline" | "migrated" | "newer" | "failed"
export interface DataVersionResult { status: DataStatus; from: number | null; to: number; target: number; backup: string | null; error: string | null }
interface VersionFile { version: number; updatedAt: string; history: { at: string; from: number | null; to: number; step: string }[] }

const BACKUP_RE = /^\d{8}T\d{6}Z-v\d+$/
export const KEEP_BACKUPS = 5
const FILE = "data-version.json"

function readVersion(dir: string): VersionFile | null {
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf-8")) as VersionFile; return Number.isInteger(v.version) ? v : null } catch { return null }
}
function writeVersion(dir: string, v: VersionFile) {
  const tmp = path.join(dir, `${FILE}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
  fs.renameSync(tmp, path.join(dir, FILE))
}
const hasData = (dir: string) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f !== FILE && f !== "backups")
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")

/** Sao chép data/ (trừ backups/) — trả đường dẫn bản sao. */
export function backupData(dir: string, fromVersion: number, now: Date): string {
  const dest = path.join(dir, "backups", `${stamp(now)}-v${fromVersion}`)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of fs.readdirSync(dir)) {
    if (f === "backups") continue
    fs.cpSync(path.join(dir, f), path.join(dest, f), { recursive: true })
  }
  // Giữ KEEP_BACKUPS bản mới nhất — CHỈ xoá thư mục đúng mẫu tên do chính hàm này tạo.
  const all = fs.readdirSync(path.join(dir, "backups")).filter((n) => BACKUP_RE.test(n)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, "backups", old), { recursive: true, force: true })
  return dest
}

export async function ensureDataVersion(dir: string, opts: { migrations?: DataMigration[]; target?: number; now?: Date } = {}): Promise<DataVersionResult> {
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.to - b.to)
  const target = opts.target ?? DATA_VERSION
  const now = opts.now ?? new Date()
  fs.mkdirSync(dir, { recursive: true })
  const cur = readVersion(dir)
  // Soát 07/10: tệp phiên bản CÓ mà đọc không được (hỏng / sửa tay) ≠ chưa có — KHÔNG ghi đè thành v1 rồi chạy lại mọi bước
  // trên dữ liệu có thể đã ở bản mới. Dừng, báo đỏ, chờ người xem.
  if (!cur && fs.existsSync(path.join(dir, FILE))) return { status: "failed", from: null, to: 0, target, backup: null, error: `Không đọc được ${FILE} (tệp hỏng?) — KHÔNG chuyển đổi gì. Kiểm tệp này rồi khởi động lại.` }
  if (!cur) {
    if (!hasData(dir)) {
      writeVersion(dir, { version: target, updatedAt: now.toISOString(), history: [{ at: now.toISOString(), from: null, to: target, step: "bản cài mới" }] })
      return { status: "fresh", from: null, to: target, target, backup: null, error: null }
    }
    // Bản cài có từ trước Đợt 24c: định dạng = v1.
    const base: VersionFile = { version: 1, updatedAt: now.toISOString(), history: [{ at: now.toISOString(), from: null, to: 1, step: "mốc gốc (dữ liệu có từ trước)" }] }
    writeVersion(dir, base)
    if (target === 1) return { status: "baseline", from: null, to: 1, target, backup: null, error: null }
    return runSteps(dir, base, migrations, target, now)
  }
  if (cur.version === target) return { status: "current", from: cur.version, to: cur.version, target, backup: null, error: null }
  if (cur.version > target) return { status: "newer", from: cur.version, to: cur.version, target, backup: null, error: `Dữ liệu ở phiên bản v${cur.version}, mã này chỉ hiểu tới v${target} — đang chạy bản CŨ trên dữ liệu MỚI. Không chuyển đổi gì; nâng mã lên bản mới.` }
  return runSteps(dir, cur, migrations, target, now)
}

async function runSteps(dir: string, cur: VersionFile, migrations: DataMigration[], target: number, now: Date): Promise<DataVersionResult> {
  const from = cur.version
  const steps = migrations.filter((m) => m.to > from && m.to <= target)
  // Phải có ĐỦ từng bước from+1…target — thiếu bước là lỗi lập trình, không đoán.
  for (let v = from + 1; v <= target; v++) if (!steps.some((m) => m.to === v)) return { status: "failed", from, to: from, target, backup: null, error: `Thiếu bước chuyển dữ liệu lên v${v}` }
  let backup: string
  // Soát 07/10: lần chuyển trước hỏng giữa chừng → đã có bản sao lưu của v<from> từ lần đó (bản gốc nhất). Không tạo thêm mỗi lần
  // khởi động hỏng (5 lần là bản gốc bị xoá theo giới hạn giữ 5 bản).
  const prior = fs.existsSync(path.join(dir, "backups")) ? fs.readdirSync(path.join(dir, "backups")).filter((n) => BACKUP_RE.test(n) && n.endsWith(`-v${from}`)).sort()[0] : undefined
  try { backup = prior ? path.join(dir, "backups", prior) : backupData(dir, from, now) } catch (e) { return { status: "failed", from, to: from, target, backup: null, error: `Không sao lưu được data/ — KHÔNG chuyển đổi: ${e instanceof Error ? e.message : String(e)}` } }
  let v = from
  for (const m of steps) {
    try { await m.run(dir) } catch (e) { return { status: "failed", from, to: v, target, backup, error: `Bước "${m.name}" (lên v${m.to}) lỗi: ${e instanceof Error ? e.message : String(e)} — dữ liệu ở v${v}, bản sao lưu: ${backup}` } }
    v = m.to
    cur = { version: v, updatedAt: new Date().toISOString(), history: [...cur.history, { at: new Date().toISOString(), from: v - 1, to: v, step: m.name }].slice(-50) }
    writeVersion(dir, cur)
  }
  return { status: "migrated", from, to: v, target, backup, error: null }
}

/** Kết quả lần kiểm lúc khởi động — trang Sức khoẻ đọc. */
const G = globalThis as { __adsDataVersion?: DataVersionResult }
export function setDataVersionResult(r: DataVersionResult) { G.__adsDataVersion = r }
export function dataVersionResult(): DataVersionResult | null { return G.__adsDataVersion ?? null }
