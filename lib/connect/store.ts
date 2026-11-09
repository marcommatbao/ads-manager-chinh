// ============================================================
// Sổ kết nối của bản cài ở chế độ cổng: data/connect.json. KHÔNG chứa token — chỉ mã kết nối ở cổng + tài khoản đã chọn.
// Đọc lại theo mtime (giống lib/setup/state.ts).
// ============================================================
import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"

export type ConnectProvider = "google" | "meta"

export interface GoogleAccountPick {
  customerId: string
  /** MCC đứng trên tài khoản (login-customer-id); không có = vào thẳng tài khoản. */
  loginCustomerId?: string
  name: string
  company: string
}

export interface ConnectState {
  google?: { connectionId: string; createdAt: string; createdBy: string; accounts: GoogleAccountPick[] }
  meta?: {
    connectionId: string
    createdAt: string
    createdBy: string
    /** Tài khoản quảng cáo dùng cho cả bản cài (AdsCommand đọc một META_AD_ACCOUNT_ID — như chế độ dán khoá). */
    adAccount?: MetaAdAccountPick
    /** Pixel / Trang theo công ty → NEXT_PUBLIC_META_PIXEL_ID_<hậu tố>, NEXT_PUBLIC_META_PAGE_ID_<hậu tố>. */
    companies?: Record<string, MetaCompanyPick>
  }
}

export interface MetaAdAccountPick { id: string; name: string; currency: string }
export interface MetaCompanyPick { pixelId?: string; pixelName?: string; pageId?: string; pageName?: string }

const FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "connect.json")
let cache: { mtime: number; file: string; state: ConnectState } | null = null

export function readConnect(): ConnectState {
  const f = FILE()
  try {
    const mtime = fs.statSync(f).mtimeMs
    if (cache && cache.file === f && cache.mtime === mtime) return cache.state
    const state = JSON.parse(fs.readFileSync(f, "utf8")) as ConnectState
    cache = { mtime, file: f, state }
    return state
  } catch {
    return {}
  }
}

export function writeConnect(next: ConnectState): ConnectState {
  writeFileAtomicSync(FILE(), JSON.stringify(next, null, 2))
  cache = null
  return next
}

/** login-customer-id cho một mã tài khoản Google đã chọn (chế độ cổng). */
export function loginCustomerIdFor(customerId: string): string | undefined {
  const id = customerId.replace(/-/g, "")
  return readConnect().google?.accounts.find((a) => a.customerId === id)?.loginCustomerId
}

/** Mã tài khoản Google đã chọn cho công ty (chế độ cổng). Mỗi công ty tối đa một tài khoản — như chế độ dán khoá. */
export function gatewayCustomerIdFor(company: string): string | undefined {
  return readConnect().google?.accounts.find((a) => a.company === company)?.customerId
}
