// POST /api/admin/data-import — NHẬP thư mục data/ từ bản cài cũ khi chuyển máy chủ (Coolify → Vibe Host, 09/11/2026).
// TẮT mặc định: chỉ chạy khi biến DATA_IMPORT_TOKEN có ≥ 32 ký tự; đặt lại thành giá trị ngắn (vd "off") là tắt hẳn.
// Dùng MỘT lần: xong bước "done" thì ghi data/.import-done và mọi lần gọi sau trả 409.
// Các bước (bên gửi: scripts/export-data-to.mjs chạy trong container bản cũ):
//   ?step=begin → sao lưu data/ hiện tại vào data/backups/pre-import-<thời điểm>/
//   ?step=files → body { files: [{ p: "đường/dẫn/tương/đối", b64 }] } — ghi từng tệp (ghi tạm rồi đổi tên)
//   ?step=done  → ghi dấu đã nhập. Sau đó khởi động lại app để nạp dữ liệu mới.
import crypto from "crypto"
import fs from "fs"
import path from "path"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const MARKER = ".import-done"
const dataDir = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data")
const err = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } })

function authorized(req: Request): boolean {
  const want = (process.env.DATA_IMPORT_TOKEN ?? "").trim()
  if (want.length < 32) return false
  const got = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? ""
  const h = (s: string) => crypto.createHash("sha256").update(s).digest()
  return crypto.timingSafeEqual(h(got), h(want))
}

/** Chỉ nhận đường dẫn TƯƠNG ĐỐI nằm trong data/; không ghi đè bản sao lưu hay dấu đã nhập. */
export function safeRel(p: unknown): string | null {
  if (typeof p !== "string" || !p || p.length > 300 || p.includes("\0") || p.includes("\\")) return null
  const n = path.posix.normalize(p)
  if (n !== p || n.startsWith("/") || n.split("/").some((s) => s === ".." || s === "." || s === "")) return null
  if (n === MARKER || n === "backups" || n.startsWith("backups/")) return null
  return n
}

export async function POST(req: Request) {
  if (!authorized(req)) return err(401, "unauthorized")
  const dir = dataDir()
  if (fs.existsSync(path.join(dir, MARKER))) return err(409, "already imported")
  const step = new URL(req.url).searchParams.get("step")

  if (step === "begin") {
    const dest = path.join(dir, "backups", `pre-import-${new Date().toISOString().replace(/[-:.]/g, "")}`)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of fs.readdirSync(dir)) {
      if (f !== "backups") fs.cpSync(path.join(dir, f), path.join(dest, f), { recursive: true })
    }
    return Response.json({ ok: true, backup: path.relative(dir, dest) })
  }

  if (step === "files") {
    const body = (await req.json().catch(() => null)) as { files?: { p?: unknown; b64?: unknown }[] } | null
    if (!body || !Array.isArray(body.files)) return err(400, "files[] required")
    let files = 0, bytes = 0
    for (const f of body.files) {
      const rel = safeRel(f.p)
      if (!rel || typeof f.b64 !== "string") return err(400, `bad entry: ${String(f.p).slice(0, 120)}`)
      const target = path.join(dir, rel)
      if (!target.startsWith(dir + path.sep)) return err(400, `outside data/: ${rel}`)
      const buf = Buffer.from(f.b64, "base64")
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const tmp = `${target}.import-tmp`
      fs.writeFileSync(tmp, buf)
      fs.renameSync(tmp, target)
      files++
      bytes += buf.length
    }
    return Response.json({ ok: true, files, bytes })
  }

  if (step === "done") {
    fs.writeFileSync(path.join(dir, MARKER), new Date().toISOString())
    return Response.json({ ok: true })
  }

  return err(400, "step must be begin | files | done")
}
