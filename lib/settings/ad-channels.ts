// Đợt 27 — đọc / thêm / ẩn kênh quảng cáo (data/ad-channels.json). Kênh gốc ở lib/settings/ad-channels-def.ts.
// Không có XOÁ: số KPI / chi phí đã nhập gắn theo mã kênh. Chỉ ẩn được kênh đang không có số nào (tránh tổng bị lệch mà
// không thấy kênh nào gây ra).
import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { BUILTIN_AD_CHANNELS, CHANNEL_KEY_RE, MAX_CUSTOM_CHANNELS, RESERVED_CHANNEL_KEYS, slugifyChannel, type AdChannelDef } from "./ad-channels-def"

interface StoredChannel { key: string; label: string; hidden?: boolean; createdAt: string; createdBy: string }
const FILE = () => path.join(process.cwd(), "data", "ad-channels.json")
let cache: { mtime: number; file: string; rows: StoredChannel[] } | null = null

function readCustom(): StoredChannel[] {
  const f = FILE()
  try {
    if (!existsSync(f)) return []
    const mtime = statSync(f).mtimeMs
    if (cache && cache.file === f && cache.mtime === mtime) return cache.rows
    const raw = JSON.parse(readFileSync(f, "utf8"))
    const rows = (Array.isArray(raw) ? raw : []).filter((r): r is StoredChannel => !!r && CHANNEL_KEY_RE.test(String(r.key)) && !RESERVED_CHANNEL_KEYS.includes(String(r.key)) && typeof r.label === "string")
    cache = { mtime, file: f, rows }
    return rows
  } catch { return [] }
}

/** Mọi kênh: gốc + tự thêm (kể cả đã ẩn). Bản Mắt Bão chưa thêm gì → đúng 4 kênh gốc như trước. */
export function adChannels(): AdChannelDef[] {
  return [...BUILTIN_AD_CHANNELS, ...readCustom().map((c) => ({ key: c.key, label: c.label, manualLabel: c.label, source: "manual" as const, builtIn: false, hidden: !!c.hidden }))]
}
export const kpiChannelKeys = (): string[] => adChannels().map((c) => c.key)
/** Kênh khai chi phí tay: kênh không có API + "Kênh khác". */
export const manualChannelKeys = (): string[] => [...adChannels().filter((c) => c.source === "manual").map((c) => c.key), "other"]

export class ChannelInputError extends Error {}

export async function addChannel(label: string, actor: string): Promise<AdChannelDef> {
  const name = label.trim().replace(/\s+/g, " ").slice(0, 40)
  if (name.length < 2) throw new ChannelInputError("Tên kênh phải có ít nhất 2 ký tự")
  const key = slugifyChannel(name)
  if (!CHANNEL_KEY_RE.test(key)) throw new ChannelInputError("Tên kênh phải có chữ cái (vd “ChatGPT Ads”, “Microsoft Ads”)")
  if (RESERVED_CHANNEL_KEYS.includes(key) && !BUILTIN_AD_CHANNELS.some((c) => c.key === key) || key === "khac" || key === "kenh_khac") throw new ChannelInputError("“Kênh khác” đã có sẵn ở Chi phí kênh khác — đặt tên kênh cụ thể (vd “ChatGPT Ads”)")
  return withFileLock(FILE(), async () => {
    const rows = readCustom()
    // So theo dạng bỏ "_" — "Chat GPT" (chat_gpt) và "ChatGPT" (chatgpt) là MỘT kênh.
    const flat = (x: string) => x.replace(/_/g, "")
    const clash = adChannels().find((c) => flat(c.key) === flat(key) || flat(slugifyChannel(c.label)) === flat(key))
    if (clash) throw new ChannelInputError(`Đã có kênh “${clash.label}”${clash.hidden ? " (đang ẩn — bật hiện lại thay vì thêm mới)" : ""}`)
    if (rows.length >= MAX_CUSTOM_CHANNELS) throw new ChannelInputError(`Tối đa ${MAX_CUSTOM_CHANNELS} kênh tự thêm`)
    const next = [...rows, { key, label: name, createdAt: new Date().toISOString(), createdBy: actor }]
    writeFileAtomicSync(FILE(), JSON.stringify(next, null, 2))
    cache = null
    return adChannels().find((c) => c.key === key)!
  })
}

/** Ẩn / hiện kênh tự thêm. `inUse` = kênh đang có số (KPI hoặc chi phí khai tay) — có số thì KHÔNG cho ẩn. */
export async function setChannelHidden(key: string, hidden: boolean, inUse: (key: string) => boolean): Promise<AdChannelDef> {
  return withFileLock(FILE(), async () => {
    const rows = readCustom()
    const i = rows.findIndex((r) => r.key === key)
    if (i < 0) throw new ChannelInputError(RESERVED_CHANNEL_KEYS.includes(key) ? "Kênh gốc không ẩn được" : "Không tìm thấy kênh")
    if (hidden && inUse(key)) throw new ChannelInputError(`Kênh “${rows[i].label}” đang có số (KPI hoặc chi phí đã khai) — đặt về 0 trước khi ẩn`)
    rows[i] = { ...rows[i], hidden }
    writeFileAtomicSync(FILE(), JSON.stringify(rows, null, 2))
    cache = null
    return adChannels().find((c) => c.key === key)!
  })
}
