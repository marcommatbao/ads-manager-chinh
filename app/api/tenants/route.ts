// ============================================================
// GET  /api/tenants          → list all tenants (super_admin)
// GET  /api/tenants?id=mbc   → single tenant detail
// POST /api/tenants          → upsert tenant (super_admin)
// PATCH /api/tenants?id=mbc  → update tenant settings
//
// Auth: super_admin only for write; any authenticated user can
// read their own accessible tenants.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin, getCompaniesForRole } from "@/lib/permissions";
import {
  readTenants,
  getTenant,
  upsertTenant,
  updateTenantSettings,
} from "@/lib/tenants/registry";
import { isValidTenantId } from "@/lib/tenants/resolver";
import { getEffectiveSettings } from "@/lib/tenants/settings-layer";
import type { Tenant, TenantId } from "@/lib/tenants/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── GET ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") as TenantId | null;

  if (id) {
    if (!isValidTenantId(id)) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Non-super_admin: can only read their own company's tenant
    if (!isSuperAdmin(user.role)) {
      const allowed = getCompaniesForRole(user);
      const tenant  = getTenant(id);
      if (!tenant || !allowed.includes(tenant.legacyCompanyKey as never)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const tenant = getTenant(id)!;
    const effectiveSettings = getEffectiveSettings(id);
    return NextResponse.json({
      success: true,
      data: { ...sanitize(tenant), effectiveSettings },
    });
  }

  // List all tenants
  const all = readTenants();

  if (isSuperAdmin(user.role)) {
    return NextResponse.json({ success: true, data: all.map(sanitize) });
  }

  // Non-super: return only accessible tenants
  const allowed = getCompaniesForRole(user);
  const filtered = all.filter(t => allowed.includes(t.legacyCompanyKey as never));
  return NextResponse.json({ success: true, data: filtered.map(sanitize) });
}

// ── POST (upsert full tenant) ─────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
  }

  let body: Partial<Tenant>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id || !body.name || !body.legacyCompanyKey) {
    return NextResponse.json({
      error: "Required fields: id, name, legacyCompanyKey",
    }, { status: 400 });
  }

  const tenant: Tenant = {
    id:            body.id.toLowerCase() as TenantId,
    name:          body.name,
    shortLabel:    body.shortLabel ?? body.id.toUpperCase(),
    domain:        body.domain,
    color:         body.color,
    status:        body.status   ?? "active",
    plan:          body.plan     ?? "internal",
    createdAt:     body.createdAt ?? new Date().toISOString(),
    legacyCompanyKey: body.legacyCompanyKey,
    metadata:      body.metadata     ?? {},
    integrations:  body.integrations ?? {},
    settings:      body.settings     ?? {},
  };

  await upsertTenant(tenant);
  return NextResponse.json({ success: true, data: sanitize(tenant) }, { status: 201 });
}

// ── PATCH (update settings only) ─────────────────────────

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") as TenantId | null;

  if (!id || !isValidTenantId(id)) {
    return NextResponse.json({ error: "?id= required and must be a valid tenant" }, { status: 400 });
  }

  let body: Partial<Tenant["settings"]>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updated = await updateTenantSettings(id, body);
  if (!updated) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  return NextResponse.json({ success: true, data: sanitize(updated) });
}

// ── Sanitise (never expose credentials or ownerEmail to non-admin) ──

function sanitize(t: Tenant): Omit<Tenant, "metadata"> & { metadata: Omit<Tenant["metadata"], "ownerEmail"> } {
  const { ownerEmail: _, ...safeMeta } = t.metadata;
  return { ...t, metadata: safeMeta };
}
