// ============================================================
// Odoo → MBI Offline-Order Customers (Audience Builder "offline_orders")
// ============================================================
//
// Real Odoo query backing the "offline_orders" (KH đã mua) Audience Builder
// source — MBI ONLY. Reuses the exact MBI-source classification already
// proven live in app/api/cron/orders-notify/route.ts (lib/mbi-order-sources.ts)
// so this can never drift from what that cron considers a real matbao.in
// order — same sale.order domain (team_id in MBI_TEAM_IDS AND
// customer_source in MBI_CUSTOMER_SOURCE_IDS — see lib/mbi-order-sources.ts
// for why this replaced the earlier, undercounting source_id-based rule).
//
// MBC has NO equivalent here. There is no proven Odoo company-split query
// for MBC's sale.order records in this codebase — the only MBC revenue
// path (lib/finance/company-pnl.ts) goes through a separate, aggregate-only
// internal Report API (MATBAO_REPORT_API) with no customer records at all.
// Guessing an MBC source filter (or a "not MBI = MBC" exclusion) risks
// mixing the wrong company's customers into an audience — worse than
// leaving MBC on the honest CSV-upload path. See the "offline_orders" entry
// in lib/audience-builder.ts's AUDIENCE_SOURCES for the UI-facing version
// of this note.

import { searchRead } from "@/lib/odoo-client";
import { MBI_ORDER_DOMAIN, isQualifiedMbiOrder, type OdooOrderSourceTeam } from "@/lib/mbi-order-sources";
import type { CustomerRecord } from "@/lib/audience-builder";

interface OdooSaleOrderForAudience extends OdooOrderSourceTeam {
  id: number;
  partner_id: [number, string] | false;
  amount_total: number;
  create_date: string;
}

interface OdooPartner {
  id: number;
  name: string | false;
  phone: string | false;
  mobile: string | false;
  email: string | false;
}

// Same placeholder-name cleanup already used live in orders-notify.ts's
// extractCustomerName() — strips Odoo's internal "[MB1234567]" customer-code
// prefix and the "Undefine Partner" placeholder text.
function cleanPartnerName(raw: string | false): string {
  if (!raw) return "";
  return raw.replace(/^\[MB\d+\]\s*/i, "").trim().replace(/^Undefine Partner$/i, "");
}

export interface MbiOfflineCustomersResult {
  customers: CustomerRecord[];
  /** Qualified MBI sale.order count in range, BEFORE partner de-dup / drop of contact-less partners. */
  orderCount: number;
}

export async function getMbiOfflineOrderCustomers(opts: {
  days: number;
  minAmount?: number;
}): Promise<MbiOfflineCustomersResult> {
  const sinceMs = Date.now() - Math.max(1, opts.days) * 24 * 60 * 60 * 1000;
  const since = new Date(sinceMs).toISOString().replace("T", " ").split(".")[0];

  const domain: unknown[] = [
    ["state", "=", "sale"],
    ["create_date", ">=", since],
    ...MBI_ORDER_DOMAIN,
  ];
  if (opts.minAmount && opts.minAmount > 0) {
    domain.push(["amount_total", ">=", opts.minAmount]);
  }

  const orders = await searchRead<OdooSaleOrderForAudience>(
    "sale.order",
    domain,
    ["id", "partner_id", "amount_total", "customer_source", "team_id", "create_date"],
    { limit: 2000, order: "create_date desc" }
  );

  // Defensive re-check — domain above already applies MBI_ORDER_DOMAIN.
  const qualified = orders.filter(isQualifiedMbiOrder);

  const partnerIds = [...new Set(
    qualified
      .filter(o => Array.isArray(o.partner_id))
      .map(o => (o.partner_id as [number, string])[0])
  )];

  if (partnerIds.length === 0) {
    return { customers: [], orderCount: qualified.length };
  }

  const partners = await searchRead<OdooPartner>(
    "res.partner",
    [["id", "in", partnerIds]],
    ["id", "name", "phone", "mobile", "email"],
    { limit: partnerIds.length }
  );

  const customers: CustomerRecord[] = [];
  for (const p of partners) {
    const name = cleanPartnerName(p.name);
    const phone = (p.phone || p.mobile || "") as string;
    const email = (p.email || "") as string;
    // A record with neither contact point can never match on Meta anyway
    // (lib/audience-builder.ts's buildAudiencePayload already drops these
    // silently) — drop it here instead of reporting a customer count Meta
    // would discard.
    if (!phone && !email) continue;
    customers.push({
      name: name || undefined,
      phone: phone || undefined,
      email: email || undefined,
    });
  }

  return { customers, orderCount: qualified.length };
}
