// Sổ kinh nghiệm · 7b — ghi chiến dịch nào đã dùng kinh nghiệm nào (để 7c chấm sau 14/28 ngày).
// Không bao giờ ném: chiến dịch đã tạo thật trên nền tảng, lỗi ghi sổ không được biến thành công thành lỗi.
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"

const FILE = path.join(process.cwd(), "data", "playbook", "usage.json")
const MAX = 3000

export interface PlaybookUsage {
  at: string; by: string; company: string; platform: "facebook" | "google"
  productKey: string; campaignId: string; campaignName: string
  /** Dòng tool đã tự điền và người dùng GIỮ lại + dòng gợi ý người dùng bấm Thêm. */
  entryIds: string[]
  /** Dòng "Nên tránh" mà người dùng vẫn chọn trái khuyến nghị. */
  overriddenAvoidIds: string[]
}

export function readUsage(): PlaybookUsage[] {
  try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as PlaybookUsage[]) : [] } catch { return [] }
}

export async function recordPlaybookUsage(u: Omit<PlaybookUsage, "at">): Promise<void> {
  if (!u.entryIds.length && !u.overriddenAvoidIds.length) return
  try {
    await withFileLock(FILE, async () => {
      const list = readUsage()
      list.push({ ...u, at: new Date().toISOString() })
      if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true })
      writeFileAtomicSync(FILE, JSON.stringify(list.slice(-MAX), null, 1))
    })
  } catch (e) {
    console.error("[playbook-usage] không ghi được:", e)
  }
}

/** Kiểm đầu vào từ client — chỉ nhận mã dòng đúng dạng, tối đa 100. */
export const cleanIds = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && /^pb_[\w-]{1,80}$/.test(v)).slice(0, 100) : [])
