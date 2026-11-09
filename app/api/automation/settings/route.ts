// ============================================================
// GET  /api/automation/settings?company=MBC — read auto-apply rules/mode
// POST /api/automation/settings              — save them
//
// The Auto-Apply settings page has always called this route; it was never
// implemented, so every toggle read `undefined` and every save 404'd.
// ============================================================
import { getT } from "@/lib/i18n/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, hasPermission } from "@/lib/permissions";
import {
  AUTO_APPLY_ACTIONS,
  getAutoApplySettings,
  saveAutoApplySettings,
  effectiveMode,
  envMode,
  type AutoApplyMode,
  type Company,
} from "@/lib/auto-apply-settings";
import { isCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";

function parseCompany(value: string | null): Company | null {
  return isCompany(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const company = parseCompany(request.nextUrl.searchParams.get("company"));
  if (!company) return NextResponse.json({ error: t("libcase.r.as.1") }, { status: 400 });
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  const settings = getAutoApplySettings(company);

  return NextResponse.json({
    company,
    enabledRules: settings.enabledRules,
    enabled: settings.enabledRules.length > 0,
    mode: settings.mode,
    effectiveMode: effectiveMode(company),
    envMode: envMode(),
    availableRules: AUTO_APPLY_ACTIONS,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  });
}

export async function POST(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Enabling a rule authorises real budget/keyword mutations to run unattended.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: t("libcase.r.as.2") }, { status: 403 });
  }

  let body: { company?: string; enabledRules?: string[]; mode?: AutoApplyMode | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const company = parseCompany(body.company ?? null);
  if (!company) return NextResponse.json({ error: t("libcase.r.as.1") }, { status: 400 });
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  if (body.enabledRules !== undefined && !Array.isArray(body.enabledRules)) {
    return NextResponse.json({ error: t("libcase.r.as.3") }, { status: 400 });
  }
  // Reject unknown rule ids loudly instead of silently dropping them — a
  // toggle that reports saved but was discarded is exactly the failure this
  // page had before.
  const unknown = (body.enabledRules ?? []).filter(
    (r) => !(AUTO_APPLY_ACTIONS as readonly string[]).includes(r),
  );
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: t("libcase.r.as.4", { v1: unknown.join(", ") }) },
      { status: 400 },
    );
  }

  if (body.mode !== undefined && body.mode !== null && body.mode !== "dry_run" && body.mode !== "auto_apply") {
    return NextResponse.json({ error: t("libcase.r.as.5") }, { status: 400 });
  }

  const saved = await saveAutoApplySettings(
    company,
    { enabledRules: body.enabledRules, mode: body.mode },
    user.email,
  );

  return NextResponse.json({
    success: true,
    company,
    enabledRules: saved.enabledRules,
    enabled: saved.enabledRules.length > 0,
    mode: saved.mode,
    effectiveMode: effectiveMode(company),
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  });
}
