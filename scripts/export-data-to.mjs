// Gửi toàn bộ /app/data của bản cài này sang bản cài mới qua POST /api/admin/data-import (chuyển máy chủ 09/11/2026).
// Chạy TRONG container bản cũ:  IMPORT_URL=https://<bản-mới> IMPORT_TOKEN=<khoá> node export-data-to.mjs
// Bỏ qua data/backups/ (bản sao lưu cũ), tệp tạm và tệp khoá. Lô ~1 MB; tệp lớn hơn được cắt thành nhiều mảnh.
// Bên nhận từ chối lượt thứ hai khi đang nhập (409) và mọi lượt sau khi đã xong → chạy lặp lại không gây hại.
import fs from "node:fs"
import path from "node:path"

const base = (process.env.IMPORT_URL ?? "").replace(/\/+$/, "")
const token = process.env.IMPORT_TOKEN ?? ""
const root = process.env.DATA_DIR ?? path.join(process.cwd(), "data")
const LIMIT = Number(process.env.BATCH_BYTES ?? 1_000_000) // byte thô mỗi lô / mỗi mảnh
if (!base.startsWith("https://") || token.length < 32) {
  console.error("Thiếu IMPORT_URL (https) hoặc IMPORT_TOKEN (>= 32 ký tự)")
  process.exit(2)
}

async function call(step, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/api/admin/data-import?step=${step}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      const text = await res.text()
      if (res.status === 409) { console.log(`${step}: bỏ qua — ${text.slice(0, 120)}`); process.exit(0) }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
      return JSON.parse(text)
    } catch (e) {
      if (attempt >= 4) throw new Error(`${step}: ${e.message}`)
      console.log(`${step}: lỗi (${e.message}) — thử lại lần ${attempt + 1}`)
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
}

const list = []
;(function walk(rel) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (r === "backups" || r === ".import-done" || r === ".import-lock" || /\.(tmp|lock|import-tmp)$/.test(e.name)) continue
    if (e.isDirectory()) walk(r)
    else if (e.isFile()) list.push(r)
  }
})("")

const total = list.reduce((s, r) => s + fs.statSync(path.join(root, r)).size, 0)
console.log(`Có ${list.length} tệp, ${total} byte cần gửi.`)
console.log("begin:", JSON.stringify(await call("begin")))

let batch = [], size = 0, sent = 0, bytes = 0
const flush = async () => {
  if (!batch.length) return
  const r = await call("files", { files: batch })
  sent += r.files
  bytes += r.bytes
  console.log(`đã gửi ${sent}/${list.length} tệp`)
  batch = []
  size = 0
}
for (const r of list) {
  const buf = fs.readFileSync(path.join(root, r))
  if (buf.length <= LIMIT) {
    if (size + buf.length > LIMIT) await flush()
    batch.push({ p: r, b64: buf.toString("base64") })
    size += buf.length
    continue
  }
  await flush() // tệp lớn: mỗi mảnh một lượt riêng
  const n = Math.ceil(buf.length / LIMIT)
  for (let i = 0; i < n; i++) {
    const part = buf.subarray(i * LIMIT, (i + 1) * LIMIT)
    const res = await call("files", { files: [{ p: r, b64: part.toString("base64"), chunk: i, final: i === n - 1 }] })
    bytes += res.bytes
    sent += res.files
  }
  console.log(`đã gửi ${sent}/${list.length} tệp (tệp lớn ${r}: ${n} mảnh)`)
}
await flush()
console.log("done:", JSON.stringify(await call("done")))
console.log(`XONG: ${sent}/${list.length} tệp, ${bytes}/${total} byte.`)
if (sent !== list.length || bytes !== total) process.exit(1)
