// ============================================================
// MBI Order-Source Classification — single source of truth
// ------------------------------------------------------------
// "Rule B" — confirmed correct 2026-07-25 via direct Odoo verification
// against production data, and matches lib/finance/company-pnl.ts's
// MBI_ORDER_FILTER (teamId + customerSource) exactly.
//
// This REPLACES an earlier "Rule A" that filtered on `source_id`
// ("Source") — confirmed live 2026-07-25 to be the WRONG Odoo field:
// `source_id` and `customer_source` ("Customer Source") are two
// SEPARATE fields on the same utm.source model, populated independently
// per order. Rule A only caught 22 of the 78 real MKT-team orders in a
// June-2026 sample (undercounting by ~72%) because 34 of those 78 had
// `source_id` empty despite having a valid `customer_source`.
//
// Shared by:
//   - app/api/cron/orders-notify/route.ts (Teams notification cron)
//   - lib/odoo-mbi-audience.ts (Audience Builder "offline_orders" source, MBI-only)
//
// Pulled into its own module so both consumers read the EXACT same
// team/source lists — duplicating this across files would risk one
// getting updated without the other, silently drifting which orders
// count as "real MBI/MKT".
// ============================================================

/** Sales Team IDs whose orders count as MBI/MKT — matches
 *  lib/finance/company-pnl.ts's MBI_ORDER_FILTER.teamId exactly. */
export const MBI_TEAM_IDS = [60, 59, 39, 35, 53, 42, 54, 50];

/** utm.source IDs (via sale.order.customer_source) that count as a real
 *  MBI/MKT order — matches lib/finance/company-pnl.ts's
 *  MBI_ORDER_FILTER.customerSource exactly. */
export const MBI_CUSTOMER_SOURCE_IDS = [17, 29, 16, 27, 243, 30];

/** utm.source id → human label (+ emoji) for display in Teams cards, so
 *  recipients can tell at a glance whether an order already has a known
 *  staff member engaged (e.g. "Kênh chat" — a rep already chatted with
 *  the customer and created the order) vs. a self-service channel
 *  nobody's touched yet (e.g. "Đơn hàng MBI online"). Real display names
 *  confirmed via direct Odoo lookup 2026-07-25 (utm.source), not guessed. */
export const MBI_SOURCE_LABELS: Record<number, string> = {
  17: "💬 Kênh chat",
  29: "🌐 Đơn hàng MBI online",
  16: "☎️ Điện thoại vào công ty",
  27: "🌐 matbao.in",
  243: "💬 Chat web - sale.ai.vn",
  30: "🆔 Đơn hàng ID",
};

export interface OdooOrderSourceTeam {
  team_id: [number, string] | false;
  customer_source: [number, string] | false;
}

/** Odoo domain fragment identifying a real MBI/MKT-team order — splice
 *  directly into any sale.order search domain (array concat). */
export const MBI_ORDER_DOMAIN: unknown[] = [
  ["team_id", "in", MBI_TEAM_IDS],
  ["customer_source", "in", MBI_CUSTOMER_SOURCE_IDS],
];

// ─────────────────────────────────────────────────────────────
// Notification-only source filter — NARROWER than MBI_* above
// ─────────────────────────────────────────────────────────────
//
// By request 2026-09-03: the Teams order cards must cover ONLY the
// self-service online channel ("Đơn hàng MBI online"). The other MBI
// sources — Kênh chat, matbao.in, Điện thoại vào công ty, Chat web
// sale.ai.vn, Đơn hàng ID — are channels where a staff member is already
// engaged with the customer, so a "nobody has picked this up" card is
// noise there.
//
// This is deliberately a SEPARATE constant, not a narrowing of
// MBI_CUSTOMER_SOURCE_IDS: that list also drives the MBI revenue report
// (app/api/odoo/revenue/route.ts) and Audience Builder's offline_orders
// source (lib/odoo-mbi-audience.ts), and must keep matching
// lib/finance/company-pnl.ts's MBI_ORDER_FILTER. Narrowing the shared
// list to notify fewer cards would silently rewrite what counts as MBI
// revenue and who lands in an MBI audience.
//
// Measured on production before the change (30 days, after the team
// filter) — cards this removes per pipeline:
//   chờ thanh toán  58 → 46   (bỏ 9 Kênh chat, 2 matbao.in, 1 Đơn hàng ID)
//   đã thanh toán   71 → 33   (bỏ 31 Kênh chat, 7 matbao.in)
//   bị hủy          37 → 36   (bỏ 1 Đơn hàng ID)
// "Điện thoại vào công ty" (16) and "Chat web - sale.ai.vn" (243) had 0
// orders in that window, so dropping them changes nothing today.

/** utm.source IDs that trigger a Teams order card. Only the self-service
 *  online channel — see the block comment above for why this is separate
 *  from MBI_CUSTOMER_SOURCE_IDS. */
export const NOTIFY_CUSTOMER_SOURCE_IDS = [29];

/** Odoo domain fragment for the notification cron — same team rule as
 *  MBI_ORDER_DOMAIN, narrower source rule. */
export const NOTIFY_ORDER_DOMAIN: unknown[] = [
  ["team_id", "in", MBI_TEAM_IDS],
  ["customer_source", "in", NOTIFY_CUSTOMER_SOURCE_IDS],
];

/** Defensive re-check for the notification cron — mirrors
 *  isQualifiedMbiOrder but against the narrower notify source list. */
export function isNotifiableOrder(order: OdooOrderSourceTeam): boolean {
  const teamId = Array.isArray(order.team_id) ? order.team_id[0] : null;
  const srcId = Array.isArray(order.customer_source) ? order.customer_source[0] : null;
  return teamId != null && MBI_TEAM_IDS.includes(teamId)
      && srcId != null && NOTIFY_CUSTOMER_SOURCE_IDS.includes(srcId);
}

/** Defensive re-check on already-fetched records — cheap insurance in
 *  case a query domain elsewhere doesn't (or can't) apply
 *  MBI_ORDER_DOMAIN directly. Every real call site should already filter
 *  via MBI_ORDER_DOMAIN at the Odoo query level; this just guards against
 *  silently including a wrong-team/wrong-source record if that ever
 *  drifts. */
export function isQualifiedMbiOrder(order: OdooOrderSourceTeam): boolean {
  const teamId = Array.isArray(order.team_id) ? order.team_id[0] : null;
  const srcId = Array.isArray(order.customer_source) ? order.customer_source[0] : null;
  return teamId != null && MBI_TEAM_IDS.includes(teamId)
      && srcId != null && MBI_CUSTOMER_SOURCE_IDS.includes(srcId);
}

/** Display label for an order's customer_source, for Teams card facts. */
export function mbiSourceLabel(order: OdooOrderSourceTeam): string {
  const srcId = Array.isArray(order.customer_source) ? order.customer_source[0] : null;
  return (srcId != null && MBI_SOURCE_LABELS[srcId]) || "❔ Khác";
}
