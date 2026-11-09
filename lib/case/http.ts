// Phần chung của các route /api/cases/** — xác thực, quyền, công ty, lỗi.
// Công ty của phiên lấy TỪ PHIÊN đã lưu (phía server), không tin client.

import { NextResponse } from "next/server"
import { getCurrentUser, type SessionUser } from "@/lib/auth"
import { canAccessCompany, hasPermission, type PermissionKey } from "@/lib/permissions"
import { CaseError } from "./service"
import { readCase, type CampaignCase } from "./store"
import type { Company } from "./types"
import { isCompany } from "@/lib/companies/registry";
import { friendlyError, isNotConfigured } from "@/lib/not-configured"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

const h = (k: string): MessageKey => `libcase.s.http.${k}` as MessageKey

export type Guarded<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

export async function requireUser(perm?: PermissionKey, t: TFunction = makeT("vi")): Promise<Guarded<SessionUser>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, response: NextResponse.json({ success: false, error: t(h("notLoggedIn")) }, { status: 401 }) }
  if (perm && !hasPermission(user.role, perm)) {
    return { ok: false, response: NextResponse.json({ success: false, error: t(h("forbidden")) }, { status: 403 }) }
  }
  return { ok: true, value: user }
}

export function requireCompany(user: SessionUser, company: unknown, t: TFunction = makeT("vi")): Guarded<Company> {
  if (!isCompany(company)) {
    return { ok: false, response: NextResponse.json({ success: false, error: t(h("noCompany")) }, { status: 400 }) }
  }
  if (!canAccessCompany(user, company)) {
    return { ok: false, response: NextResponse.json({ success: false, error: t(h("companyForbidden")) }, { status: 403 }) }
  }
  return { ok: true, value: company }
}

/** Người dùng + phiên + quyền với công ty của phiên. */
export async function requireCase(id: string, perm?: PermissionKey, t: TFunction = makeT("vi")): Promise<Guarded<{ user: SessionUser; c: CampaignCase }>> {
  const u = await requireUser(perm, t)
  if (!u.ok) return u
  const c = readCase(id)
  if (!c) return { ok: false, response: NextResponse.json({ success: false, error: t(h("caseNotFound")) }, { status: 404 }) }
  const co = requireCompany(u.value, c.company, t)
  if (!co.ok) return co
  return { ok: true, value: { user: u.value, c } }
}

export function actorOf(user: SessionUser): string {
  return user.email || user.name || user.id
}

export function fail(err: unknown, t: TFunction = makeT("vi")): NextResponse {
  if (err instanceof CaseError) return NextResponse.json({ success: false, error: err.localized(t) }, { status: err.status })
  const e = err as { errors?: { message?: string }[]; message?: string }
  const msg = e?.errors?.[0]?.message ?? e?.message ?? t(h("unknown"))
  // Đợt 25: "chưa kết nối" là trạng thái, không phải sự cố — câu dễ hiểu, không ghi log lỗi.
  if (isNotConfigured(msg)) return NextResponse.json({ success: false, error: friendlyError(msg), notConfigured: true }, { status: 500 })
  console.error("[cases]", msg)
  return NextResponse.json({ success: false, error: msg }, { status: msg === "Không tìm thấy phiên" ? 404 : 500 })
}
