// ============================================================
// Kết nối bổ sung nhập trong Cài đặt (user chốt 28/09): khoá GTM + token Trang Facebook
// ============================================================
// Trước 28/09 hai khoá này chỉ đặt được bằng biến môi trường trên máy chủ (Coolify) — khách mua tool
// không vào đó được. Giờ nhập ở Cài đặt → Kết nối, lưu MÃ HOÁ ở data/extra-connections.json.
// Ưu tiên như mọi kết nối khác của app: biến môi trường (nếu có) LUÔN thắng; giá trị lưu ở đây chỉ
// có tác dụng khi biến môi trường tương ứng CHƯA đặt (xem teams-webhooks route + instrumentation).
//
// Token Trang lưu theo từng Trang: { pageId: { token, name, addedAt, addedBy } } — token người dùng
// dán vào KHÔNG bao giờ được lưu; máy chủ đổi nó ra token của từng Trang rồi mới lưu (page-tokens.ts).

import fs from "fs"
import path from "path"
import { decryptField, encryptField, type EncryptedField } from "@/lib/crypto/data-encryption"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"

export const EXTRA_CONNECTIONS_PATH = path.resolve(process.cwd(), "data/extra-connections.json")

export interface StoredPage { token: string; name: string; addedAt: string; addedBy: string }
export interface ExtraConnections {
  gtmServiceAccountJson?: string
  gtmSavedAt?: string
  gtmSavedBy?: string
  pages?: Record<string, StoredPage>
}
interface OnDisk {
  gtmServiceAccountJson?: EncryptedField
  gtmSavedAt?: string
  gtmSavedBy?: string
  pages?: Record<string, Omit<StoredPage, "token"> & { token: EncryptedField }>
}

export function readExtraConnections(): ExtraConnections {
  try {
    if (!fs.existsSync(EXTRA_CONNECTIONS_PATH)) return {}
    const raw = JSON.parse(fs.readFileSync(EXTRA_CONNECTIONS_PATH, "utf8")) as OnDisk
    const pages: Record<string, StoredPage> = {}
    for (const [id, p] of Object.entries(raw.pages ?? {})) {
      try { pages[id] = { ...p, token: decryptField(p.token) } } catch { /* khoá giải mã đổi → bỏ Trang này */ }
    }
    let gtm: string | undefined
    try { gtm = raw.gtmServiceAccountJson ? decryptField(raw.gtmServiceAccountJson) : undefined } catch { gtm = undefined }
    return { gtmServiceAccountJson: gtm, gtmSavedAt: raw.gtmSavedAt, gtmSavedBy: raw.gtmSavedBy, pages }
  } catch { return {} }
}

export async function updateExtraConnections(fn: (cur: ExtraConnections) => ExtraConnections): Promise<ExtraConnections> {
  return withFileLock(EXTRA_CONNECTIONS_PATH, async () => {
    const next = fn(readExtraConnections())
    const disk: OnDisk = {
      ...(next.gtmServiceAccountJson ? { gtmServiceAccountJson: encryptField(next.gtmServiceAccountJson), gtmSavedAt: next.gtmSavedAt, gtmSavedBy: next.gtmSavedBy } : {}),
      pages: Object.fromEntries(Object.entries(next.pages ?? {}).map(([id, p]) => [id, { ...p, token: encryptField(p.token) }])),
    }
    fs.mkdirSync(path.dirname(EXTRA_CONNECTIONS_PATH), { recursive: true })
    writeFileAtomicSync(EXTRA_CONNECTIONS_PATH, JSON.stringify(disk, null, 2))
    return next
  })
}

/** Khoá GTM đang dùng + nguồn. Biến môi trường thắng. */
export function gtmServiceAccountSource(): { json: string | null; source: "env" | "settings" | "none" } {
  const env = (process.env.GTM_SERVICE_ACCOUNT_JSON ?? "").trim()
  if (env) return { json: env, source: "env" }
  const saved = readExtraConnections().gtmServiceAccountJson
  return saved ? { json: saved, source: "settings" } : { json: null, source: "none" }
}

/** Token Trang đang dùng: gộp biến môi trường META_PAGE_TOKENS ({pageId: token}) + Cài đặt; env thắng khi trùng Trang. */
export function configuredPageTokens(): { pageId: string; token: string; name: string | null; source: "env" | "settings" }[] {
  const out = new Map<string, { pageId: string; token: string; name: string | null; source: "env" | "settings" }>()
  for (const [id, p] of Object.entries(readExtraConnections().pages ?? {})) out.set(id, { pageId: id, token: p.token, name: p.name, source: "settings" })
  try {
    const env = JSON.parse(process.env.META_PAGE_TOKENS ?? "{}") as Record<string, unknown>
    for (const [id, t] of Object.entries(env)) if (/^\d+$/.test(id) && typeof t === "string" && t) out.set(id, { pageId: id, token: t, name: out.get(id)?.name ?? null, source: "env" })
  } catch { /* biến hỏng → bỏ qua, Cài đặt vẫn dùng được */ }
  return [...out.values()]
}
