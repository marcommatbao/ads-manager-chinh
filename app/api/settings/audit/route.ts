// ============================================================
// GET /api/settings/audit?domain=budget&limit=50
// Returns audit log entries + rollback snapshots for a domain.
// Requires authenticated user; super_admin sees all, others
// only see domains matching their company scope.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, hasPermission } from "@/lib/permissions";
import { getAuditLog, getAuditSnapshots } from "@/lib/settings/audit";
import type { SettingsDomain } from "@/lib/settings/types";

const VALID_DOMAINS: SettingsDomain[] = [
  "budget", "credentials_meta", "credentials_google", "credentials_gemini",
  "credentials_telegram", "revenue", "cpl_thresholds", "users", "team",
  "notifications", "tracking", "kpi",
];

// Domains that aren't company-scoped at all (user/team management) — these
// carry no useful per-company split, so gate them the same as credentials.
const SUPER_ADMIN_ONLY_DOMAINS: SettingsDomain[] = ["users", "team"];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const domain = searchParams.get("domain") as SettingsDomain | null;
  const limit  = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  if (!domain || !VALID_DOMAINS.includes(domain)) {
    return NextResponse.json({ error: "domain param required (one of: " + VALID_DOMAINS.join(", ") + ")" }, { status: 400 });
  }

  // Credential + user/team-management domains: super_admin only
  if ((domain.startsWith("credentials_") || SUPER_ADMIN_ONLY_DOMAINS.includes(domain)) && user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Every remaining domain's entries carry a per-entry `company` field
  // (string /* mã công ty hoặc "ALL" */) — scope them to what this role can actually
  // access, same as every live budget/revenue/cpl route already does.
  // Was previously unfiltered: any authenticated viewer_mbc/viewer_mbi
  // could read the other company's full change history.
  const entries = getAuditLog(domain, limit).filter(
    e => e.company === "ALL" || canAccessCompany(user, e.company),
  );

  // Snapshots are full-config dumps (not split per company) used for
  // rollback — only expose them to roles that can actually edit this
  // domain, not to read-only viewers.
  const snapshots = hasPermission(user.role, "can_edit") ? getAuditSnapshots(domain) : [];

  return NextResponse.json({ domain, entries, snapshots });
}
