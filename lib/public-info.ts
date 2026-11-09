// ============================================================
// Thông tin công khai cho 2 trang /about + /privacy (15/10/2026)
// ============================================================
// Google bắt trang chủ + chính sách quyền riêng tư XEM ĐƯỢC KHÔNG CẦN ĐĂNG NHẬP, trên tên miền đã xác minh,
// trước khi duyệt OAuth (scope adwords). Đơn vị vận hành + email liên hệ đọc từ biến LÚC CHẠY để bản cài khách
// (vd matbao.ws) tự điền tên mình, không phải build lại. CHỈ máy chủ.
import { companiesConfig } from "@/lib/companies"

export interface PublicInfo {
  appName: string
  orgName: string
  contactEmail: string | null
  orgAddress: string | null
  policyUpdated: string
}

const env = (k: string): string | null => {
  const v = process.env[k]?.trim()
  return v ? v : null
}

export function publicInfo(): PublicInfo {
  // Bản Mắt Bão không đặt orgName → đơn vị vận hành là Mắt Bão (tên pháp nhân tiếng Anh).
  const org = env("PUBLIC_ORG_NAME") ?? companiesConfig().orgName?.trim() ?? "Mat Bao Corporation"
  return {
    appName: env("PUBLIC_APP_NAME") ?? "AdsCommand",
    orgName: org || "Mat Bao Corporation",
    contactEmail: env("PUBLIC_CONTACT_EMAIL"),
    orgAddress: env("PUBLIC_ORG_ADDRESS"),
    policyUpdated: env("PUBLIC_POLICY_UPDATED") ?? "2026-10-15",
  }
}
