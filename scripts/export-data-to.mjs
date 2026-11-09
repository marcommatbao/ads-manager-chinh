// Gửi toàn bộ /app/data của bản cài này sang bản cài mới qua POST /api/admin/data-import (chuyển máy chủ 09/11/2026).
// Chạy TRONG container bản cũ:  IMPORT_URL=https://<bản-mới> IMPORT_TOKEN=<khoá> node scripts/export-data-to.mjs
// Bỏ qua data/backups/ (bản sao lưu cũ) và tệp tạm. Gửi theo lô ~4 MB; tệp lớn hơn 4 MB đi riêng một lô.
import fs from "node:fs"
import path from "node:path"

const base = (process.env.IMPORT_URL ?? "").replace(/\/+$/, "")
const token = process.env.IMPORT_TOKEN ?? ""
const root = process.env.DATA_DIR ?? path.join(process.cwd(), "data")
if (!base.startsWith("https://") || token.length < 32) {
  console.error("Thiếu IMPORT_URL (https) hoặc IMPORT_TOKEN (>= 32 ký tự)")
  process.exit(2)
}

async function call(step, body) {
  const res = await fetch(`${base}/api/admin/data-import?step=${step}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${step}: HTTP ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const list = []
;(function walk(rel) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (r === "backups" || r === ".import-done" || e.name.endsWith(".tmp") || e.name.endsWith(".lock")) continue
    if (e.isDirectory()) walk(r)
    else if (e.isFile()) list.push(r)
  }
})("")

console.log(`Có ${list.length} tệp cần gửi.`)
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
  const b64 = fs.readFileSync(path.join(root, r)).toString("base64")
  if (size + b64.length > 4_000_000) await flush()
  batch.push({ p: r, b64 })
  size += b64.length
}
await flush()
console.log("done:", JSON.stringify(await call("done")))
console.log(`XONG: ${sent} tệp, ${bytes} byte.`)
