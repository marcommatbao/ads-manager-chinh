// ============================================================
// Đợt 21 A6 — Trạng thái "thiết lập lần đầu" của một bản cài
// ============================================================
// BẬT bằng biến SETUP_WIZARD=on (chỉ đặt ở bản cài MỚI cho khách). Bản Mắt Bão KHÔNG đặt biến → setupEnabled() = false →
// không chuyển hướng, không tạm dừng job, mọi API /api/setup/* trả 404. Đây là chốt an toàn chính: bản Mắt Bão chạy từ mặc định
// (không có data/companies.json) nên KHÔNG thể dùng "thiếu tệp công ty" làm dấu hiệu "chưa thiết lập".
// Hoàn tất → data/setup.json { completedAt, completedBy }. Đọc lại theo mtime (middleware gọi mỗi yêu cầu).

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"

export interface SetupState { completedAt?: string; completedBy?: string }

const FILE = () => path.join(process.cwd(), "data", "setup.json")
let cache: { mtime: number; file: string; state: SetupState } | null = null

export function setupEnabled(): boolean {
  return ["on", "1", "true"].includes(String(process.env.SETUP_WIZARD ?? "").trim().toLowerCase())
}

export function readSetupState(): SetupState {
  const f = FILE()
  try {
    const mtime = fs.statSync(f).mtimeMs
    if (cache && cache.file === f && cache.mtime === mtime) return cache.state
    const raw = JSON.parse(fs.readFileSync(f, "utf8")) as SetupState
    const state: SetupState = typeof raw?.completedAt === "string" ? { completedAt: raw.completedAt, completedBy: String(raw.completedBy ?? "") } : {}
    cache = { mtime, file: f, state }
    return state
  } catch {
    return {}
  }
}

/** Bật trình thiết lập VÀ chưa hoàn tất → chuyển mọi trang về /setup, tạm dừng job tự động. */
export function setupPending(): boolean {
  return setupEnabled() && !readSetupState().completedAt
}

export function markSetupComplete(by: string): SetupState {
  const state: SetupState = { completedAt: new Date().toISOString(), completedBy: by }
  writeFileAtomicSync(FILE(), JSON.stringify(state, null, 2))
  return state
}

/** Đường dẫn trang vẫn mở khi đang thiết lập: chính trình thiết lập + Cài đặt (dán khoá, người dùng, hồ sơ thương hiệu). */
export function pageAllowedDuringSetup(pathname: string): boolean {
  return pathname === "/setup" || pathname.startsWith("/setup/") || pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/doi-mat-khau" || pathname === "/xu-ly/muc-tieu" /* Đợt 23: đặt mục tiêu chiến dịch ngay trong lúc thiết lập */ || pathname.startsWith("/oauth/") /* #7142: nối Claude (OAuth) không bị khoá bởi trình thiết lập */
}
