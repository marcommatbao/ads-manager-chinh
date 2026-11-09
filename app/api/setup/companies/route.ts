// Đợt 21 A6 — PUT /api/setup/companies: lưu tổ chức + công ty + mô-đun (data/companies.json). Xem lib/companies/write.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireSetupAdmin } from "@/lib/setup/guard"
import { readSetupState } from "@/lib/setup/state"
import { buildWizardConfig, saveWizardCompanies, type WizardCompaniesInput } from "@/lib/companies/write"
import { companiesConfig } from "@/lib/companies"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function PUT(req: NextRequest) {
  const g = await requireSetupAdmin()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as WizardCompaniesInput | null
  if (!body) return NextResponse.json({ success: false, error: "Dữ liệu không hợp lệ" }, { status: 400 })
  const cfg = buildWizardConfig(body)
  const errors = saveWizardCompanies(cfg, { lockIds: !!readSetupState().completedAt })
  if (errors.length) return NextResponse.json({ success: false, errors }, { status: 422 })
  await writeAuditEntry("companies", g.user, "update", "companies.json", null, { companies: cfg.companies.map((c) => c.id), modules: cfg.modules, orgName: cfg.orgName ?? null }, "ALL")
  return NextResponse.json({ success: true, config: companiesConfig() })
}
