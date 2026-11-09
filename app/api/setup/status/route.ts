// Đợt 21 A6 — GET /api/setup/status: tình trạng từng bước của trình thiết lập.
// Mọi người đăng nhập: { enabled, pending } (để giao diện biết có chuyển về /setup không). Super Admin: thêm chi tiết từng bước.
// KHÔNG trả giá trị khoá nào — chỉ "đã có / chưa có" và trạng thái kết nối.
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { companiesConfig, companiesConfigError, envFor } from "@/lib/companies"
import { companiesFileExists, WIZARD_COLORS, WIZARD_MODULES } from "@/lib/companies/write"
import { MODULE_LABEL } from "@/lib/companies/defaults"
import { readSetupState, setupEnabled, setupPending } from "@/lib/setup/state"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import { readLastRun } from "@/lib/smoke/run"
import { getAllMembers } from "@/lib/team"
import { allowedLoginDomains, savedLoginAllowlist } from "@/lib/login-domain"
import { savedBrandProfile } from "@/lib/brand/store"
import { listTargets } from "@/lib/case/targets"
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import { gatewayEnabled } from "@/lib/connect/gateway"

export const dynamic = "force-dynamic"

const KEY_CONNECTORS = ["google_ads", "meta", "gemini"] as const // 08/10: bỏ Telegram (xem setup/page.tsx)

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ success: false, error: "Chưa đăng nhập" }, { status: 401 })
  const enabled = setupEnabled(), pending = setupPending()
  if (!enabled || !isSuperAdmin(user.role)) return NextResponse.json({ success: true, enabled, pending })

  const state = readSetupState()
  const fileExists = companiesFileExists()
  const cfg = companiesConfig()
  const snap = snapshotAllConnectors()
  const keys = KEY_CONNECTORS.map((id) => {
    const r = snap[id]
    return { id, status: r?.status ?? "missing_config", configComplete: !!r?.configComplete, lastSuccess: r?.lastSuccess ?? null, failureReason: r?.failureReason ?? null }
  })
  const companies = fileExists ? cfg.companies.filter((c) => c.ads) : []
  const perCompany = companies.map((c) => ({
    id: c.id, label: c.label,
    // Cả hai chế độ: dán khoá (biến môi trường) và cổng (tài khoản đã chọn ở data/connect.json).
    googleCustomerId: !!GOOGLE_CUSTOMER_IDS[c.id],
    metaPixelId: !!envFor(c.id, "NEXT_PUBLIC_META_PIXEL_ID"),
    metaPageId: !!envFor(c.id, "NEXT_PUBLIC_META_PAGE_ID"),
    brandProfile: !!savedBrandProfile(c.id),
    // Đợt 23: chưa có mục tiêu → Xử lý chiến dịch hiện "chưa đặt mục tiêu" cho mọi chiến dịch, không bao giờ chấm đỏ.
    caseTarget: listTargets().some((t) => t.company === c.id),
  }))
  const last = readLastRun()
  const smoke = last ? {
    at: last.at,
    ok: last.results.filter((r) => r.ok && !r.skipped).length,
    failed: last.results.filter((r) => !r.ok).map((r) => ({ company: r.company, label: r.label, detail: r.detail })),
    skipped: last.results.filter((r) => r.skipped).length,
  } : null
  const members = (await getAllMembers()).map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, company_access: m.company_access, is_active: m.is_active }))

  return NextResponse.json({
    success: true, enabled, pending, connectMode: gatewayEnabled() ? "gateway" : "keys",
    completedAt: state.completedAt ?? null, completedBy: state.completedBy ?? null,
    options: { colors: WIZARD_COLORS, modules: WIZARD_MODULES.map((id) => ({ id, label: MODULE_LABEL[id] })) },
    companies: { fileExists, config: fileExists ? cfg : null, error: companiesConfigError() },
    keys, perCompany, smoke, members,
    allowlist: { saved: savedLoginAllowlist(), effectiveDomains: allowedLoginDomains(), envDomains: !!process.env.ALLOWED_LOGIN_DOMAINS?.trim(), envEmails: !!process.env.ALLOWED_LOGIN_EMAILS?.trim() },
    me: { email: user.email },
  })
}
