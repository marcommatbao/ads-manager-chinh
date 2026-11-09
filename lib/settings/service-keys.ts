// Đợt 24a — lưu / đọc khoá dịch vụ phụ (data/service-keys-settings.json, mã hoá như mọi khoá khác).
// Ưu tiên giữ nguyên: biến môi trường do hạ tầng đặt (Coolify) THẮNG; giá trị lưu ở đây có hiệu lực NGAY (không cần deploy).
import fs from "fs"
import path from "path"
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { maskSecret } from "@/lib/settings/validators/credentials"
import { hasModule } from "@/lib/companies/registry"
import { patchFromSettings, setByInfra } from "./env-origin"
import { SERVICE_KEYS, SERVICE_KEYS_FILE, type ServiceKeyDef } from "./service-keys-def"

const FILE = () => path.resolve(process.cwd(), "data", SERVICE_KEYS_FILE)
const ENC = SERVICE_KEYS.filter((k) => k.secret).map((k) => k.key)
type Saved = Record<string, string>

/** Ô nào hiện ở bản cài này (theo mô-đun). */
export const visibleServiceKeys = (): ServiceKeyDef[] => SERVICE_KEYS.filter((k) => !k.module || hasModule(k.module))

function readSaved(): Saved {
  try { return fs.existsSync(FILE()) ? decryptFields(JSON.parse(fs.readFileSync(FILE(), "utf8")), ENC) as Saved : {} } catch { return {} }
}
/** Đọc để GHI — lỗi đọc / giải mã thì NÉM (trả {} rồi ghi = xoá sạch khoá đã lưu khác). */
function readForWrite(): Saved {
  if (!fs.existsSync(FILE())) return {}
  return decryptFields(JSON.parse(fs.readFileSync(FILE(), "utf8")), ENC) as Saved
}

export interface ServiceKeyStatus { key: string; label: string; help: string; secret: boolean; value: string; connected: boolean; source: "settings" | "env" | "none" }

export function serviceKeyStatus(): ServiceKeyStatus[] {
  const saved = readSaved()
  return visibleServiceKeys().map((k) => {
    const infra = setByInfra(k.envVar)
    const raw = infra ? process.env[k.envVar] ?? "" : saved[k.key] || process.env[k.envVar] || ""
    return {
      key: k.key, label: k.label, help: k.help, secret: k.secret,
      value: k.secret ? maskSecret(raw) : raw, connected: !!raw,
      source: infra ? "env" : saved[k.key] ? "settings" : raw ? "env" : "none",
    }
  })
}

/** Lưu (gộp với giá trị cũ) + vá biến môi trường ngay. Trả tên biến bị hạ tầng giữ (giá trị vừa lưu chưa có tác dụng). */
export async function saveServiceKeys(patch: Saved): Promise<{ overriddenByEnv: string[] }> {
  return withFileLock(FILE(), async () => {
    const merged = { ...readForWrite(), ...patch }
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    writeFileAtomicSync(FILE(), JSON.stringify(encryptFields(merged, ENC), null, 2))
    const overriddenByEnv: string[] = []
    for (const k of SERVICE_KEYS) {
      if (!(k.key in patch)) continue
      if (!patchFromSettings(k.envVar, merged[k.key])) overriddenByEnv.push(k.envVar)
    }
    return { overriddenByEnv }
  })
}

/** Kiểm đầu vào — HÀM THUẦN. Trả {patch} hoặc {error}. Ô đang hiện dạng che (****) = không đổi. */
export function parseServiceKeyInput(body: Record<string, unknown>, defs: ServiceKeyDef[] = visibleServiceKeys()): { patch: Saved } | { error: string } {
  const patch: Saved = {}
  for (const k of defs) {
    const v = body[k.key]
    if (typeof v !== "string") continue
    const s = v.trim()
    if (!s || s.includes("****")) continue
    if (s.length > 500 || /\s/.test(s)) return { error: `${k.label}: giá trị không hợp lệ (không được chứa khoảng trắng, tối đa 500 ký tự)` }
    if (k.key === "telegramKpiChatId" && !/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,64}$/.test(s)) return { error: `${k.label}: phải là số (vd -1001234567890) hoặc @tên_kênh` }
    patch[k.key] = s
  }
  return { patch }
}
