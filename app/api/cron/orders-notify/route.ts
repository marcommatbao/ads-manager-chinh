// ============================================================
// Cron — Poll Odoo for new matbao.in orders → 3 Teams notification types
// GET /api/cron/orders-notify  (every 5 minutes via dcron)
//
//  1. "Đơn chờ thanh toán" — draft orders → sales follows up to convert
//  2. "Đơn đã thanh toán"  — newly confirmed orders → success signal
//  3. "Đơn bị hủy"         — order flipped draft→cancel (e.g. abandoned
//     online payment) between two poll ticks, so the draft pipeline above
//     never saw it in time → sales calls back to try to save the sale
//     TẮT từ 26/10/2026 theo user (task #7108) — bật lại: ORDERS_NOTIFY_CANCEL=on
//     (lib/orders/notify-settings.ts). Khi tắt vẫn đánh dấu "đã xem" để không xả dồn lúc bật lại.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { cancelCardsEnabled } from "@/lib/orders/notify-settings";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { searchRead } from "@/lib/odoo-client";
import { NOTIFY_ORDER_DOMAIN, isNotifiableOrder, mbiSourceLabel } from "@/lib/mbi-order-sources";
import {
  getNotifiedDraftIds,
  getNotifiedPaidIds,
  getNotifiedCancelIds,
  getLastCheckedAt,
  touchLastChecked,
  markNotifiedDraft,
  markNotifiedPaid,
  markNotifiedCancel,
  wasPhoneRecentlyNotified,
  markPhoneNotified,
  getBacklogSilencedAt,
  markBacklogSilenced,
  getPaidBacklogSilencedAt,
  markPaidBacklogSilenced,
  getCancelBacklogSilencedAt,
  markCancelBacklogSilenced,
  getNoFilterRolloutSilencedAt,
  markNoFilterRolloutSilenced,
  getCustomerSourceRolloutSilencedAt,
  markCustomerSourceRolloutSilenced,
  logNotifyEvents,
  type NotifyEvent,
} from "@/lib/orders-notify";
import { wasLeadRecentlyNotified } from "@/lib/leads-notify";
import { odooUrl } from "@/lib/odoo-config";
import { friendlyError } from "@/lib/not-configured";

// Bounded label list for a job-history resultSummary line — e.g.
// "S6537276(sent), S6537999(skip: no real name)" — capped so a run with
// many orders doesn't blow up the summary string.
function summarizeNames(entries: string[], max = 6): string {
  if (entries.length === 0) return "none";
  const shown = entries.slice(0, max).join(", ");
  return entries.length > max ? `${shown}, +${entries.length - max} more` : shown;
}

export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface OdooOrder {
  id: number;
  name: string;
  create_date: string;
  write_date: string;
  team_id: [number, string] | false;
  partner_id: [number, string] | false;
  amount_total: number;
  opportunity_id: [number, string] | false;
  customer_source: [number, string] | false;
}

interface CrmLead {
  id: number;
  contact_name: string | false;
  phone: string | false;
  email_from: string | false;
}

// NOTIFY_ORDER_DOMAIN / isNotifiableOrder / mbiSourceLabel live in
// lib/mbi-order-sources.ts. 2026-09-03: this cron moved off the shared
// MBI_ORDER_DOMAIN onto the NARROWER notify-only domain — cards now fire
// for the self-service "Đơn hàng MBI online" source ONLY. The shared MBI
// lists are untouched because they also drive MBI revenue and Audience
// Builder; see the block comment in lib/mbi-order-sources.ts.
// That module is also reused by lib/odoo-mbi-audience.ts
// (Audience Builder's real MBI offline_orders query) so both consumers
// can never drift on the team/source definition. OdooOrder below
// satisfies that module's OdooOrderSourceTeam shape structurally (same
// customer_source/team_id field shapes). Filters on `customer_source`
// ("Customer Source"), NOT `source_id` ("Source") — confirmed 2026-07-25
// these are two separate Odoo fields; the old source_id-based rule
// undercounted real MBI/MKT orders by ~72%.

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  const visible = digits.slice(-3);
  return `${"•".repeat(digits.length - 3)}${visible}`;
}

function extractCustomerName(partnerStr: string): string {
  return partnerStr.replace(/^\[MB\d+\]\s*/i, "").trim().replace(/^Undefine Partner$/i, "");
}

function isUndefinedPartner(partnerVal: [number, string] | false): boolean {
  if (!Array.isArray(partnerVal)) return true;
  const name = partnerVal[1].replace(/^\[MB\d+\]\s*/i, "").trim();
  return !name || name === "Undefine Partner";
}

// 2026-07-22: "+84-397604893" (contact_name "AAA") looked like a spam bot at
// first glance (one identity behind hundreds of leads/day) — but it's
// actually a shared PLACEHOLDER phone Odoo's own customer-matching uses
// before the real distinct customer is resolved. Confirmed live: several
// much-older orders that used this same placeholder are now correctly
// attributed to different real people (Nguyễn Trần Thịnh, Nguyễn Quang
// Thông, Dương Hoàng Trung...). So this can't be blocked — some of these
// really are real customers whose data just hasn't resolved yet.
// Instead: give unresolved orders a bounded grace window to resolve before
// ever sending. Sending immediately with "Undefine Partner"/placeholder
// data would show sales a useless card for an order that self-resolves in
// minutes; waiting forever (the pre-2026-07-21 behavior) means an order
// that NEVER resolves (many don't — some have sat unresolved over a year)
// silently never gets reported at all, which isn't right either now that
// the whole point is "report it so staff can chase it down themselves."
const UNRESOLVED_PARTNER_WAIT_MINUTES = 30;

type PartnerResolution = "resolved" | "waiting" | "expired";

function partnerResolution(order: OdooOrder): PartnerResolution {
  if (!isUndefinedPartner(order.partner_id)) return "resolved";
  const createdMs = new Date(order.create_date.replace(" ", "T") + "Z").getTime();
  const ageMinutes = (Date.now() - createdMs) / 60000;
  return ageMinutes > UNRESOLVED_PARTNER_WAIT_MINUTES ? "expired" : "waiting";
}

// Tên giả: ký tự lặp (aaa, xxx), test*, admin*, chỉ số
function isFakeName(name: string | false | null | undefined): boolean {
  if (!name || typeof name !== "string") return false;
  const n = name.trim().toLowerCase();
  if (!n) return true;
  // if (/^(.)\1+$/.test(n)) return true;          // aaa, xxx, bbb, 111… (tạm tắt)
  if (/^(test|admin|null|none|na|n\/a|abc|xyz|asdf|qwerty)/.test(n)) return true;
  if (/^\d+$/.test(n)) return true;              // thuần số
  return false;
}

// By request 2026-07-21: report every qualified order regardless of data
// quality (no name / no phone / test-looking data / the old phone
// blacklist) — sales wants to see it and resolve it themselves rather than
// have the bot silently decide an order isn't worth a call. isFakeName
// above is kept only for display fallback text ("Chưa xác định") in the
// card builders below, not as a send/skip gate.

// ─── Sales Team display ───────────────────────────────────
//
// Ghi lại để người sau khỏi điều tra lại (xác minh live 03/09/2026 trên
// Odoo production, ca đơn S6584586):
//
// `team_id` trên sale.order là trường COMPUTED, store=true,
// depends = (partner_id, user_id) — nên khi người phụ trách đổi, Odoo tự
// tính lại team theo team của người đó. Kèm theo, luật phân quyền của nhóm
// "Sales / User: Own Documents Only" là
//   ['|', ('user_id','=',user.id), ('user_id','=',False)]
// — KHÔNG có điều kiện team, nên đơn chưa có người phụ trách thì mọi nhân
// viên kinh doanh toàn công ty đều nhận được, bất kể thuộc team nào.
//
// Hệ quả: nhãn team in ra dưới đây là ẢNH CHỤP tại thời điểm cron quét.
// Đơn có thể mang team khác khi mở Odoo sau đó, nếu người nhận thuộc team
// khác. Đó là hành vi của Odoo, không phải lỗi của cron này.
function teamLabel(order: OdooOrder): string {
  const rawTeam = Array.isArray(order.team_id) ? order.team_id[1] : null;
  return rawTeam && rawTeam.toLowerCase() !== "unknown" ? rawTeam : "Chưa xác định";
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + " đ";
}

function formatOdooDate(odooDate: string): string {
  const d = new Date(odooDate.replace(" ", "T") + "Z");
  return d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function odooOrderUrl(orderId: number): string {
  // Không còn host mặc định trong mã (đổi 17/09/2026) — xem lib/odoo-config.ts.
  // Thiếu biến → trả link rỗng, thẻ thông báo sẽ không có nút mở đơn, thay vì
  // trỏ tới một host ghi cứng trong repo công khai.
  const base = odooUrl();
  if (!base) return "";
  return `${base}/web#id=${orderId}&model=sale.order&view_type=form`;
}

// ─── Card: chờ thanh toán ──────────────────────────────────

async function sendDraftCard(order: OdooOrder, lead?: CrmLead): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_ORDERS_MATBAOIN;
  if (!webhookUrl) throw new Error("TEAMS_WEBHOOK_ORDERS_MATBAOIN not set");

  const partnerName = Array.isArray(order.partner_id)
    ? extractCustomerName(order.partner_id[1])
    : "";
  const rawContact = lead?.contact_name as string | false | null;
  const customerName = (!isFakeName(rawContact) && rawContact)
    ? rawContact
    : (partnerName || "Chưa xác định");
  const phone = lead?.phone || "";
  const email = lead?.email_from || "";
  const team = teamLabel(order);

  const facts: { title: string; value: string }[] = [
    { title: "Mã đơn:", value: order.name },
    { title: "Ngày tạo:", value: formatOdooDate(order.create_date) },
    { title: "Khách hàng:", value: customerName },
    { title: "SĐT:", value: phone ? maskPhone(phone) : "Không có" },
    { title: "Sales Team:", value: team },
    // Nguồn (customer_source) — vd "Kênh chat" nghĩa là nhân viên đã tư vấn
    // và tạo đơn rồi (đã có người phụ trách), khác với đơn online tự phát
    // sinh chưa ai touch.
    { title: "Nguồn:", value: mbiSourceLabel(order) },
  ];

  await postCard(webhookUrl, {
    title: "🔔 Đơn chờ thanh toán — matbao.in",
    color: "Warning",
    facts,
    orderId: order.id,
    orderName: order.name,
  });
}

// ─── Card: đã thanh toán ──────────────────────────────────

async function sendPaidCard(order: OdooOrder): Promise<void> {
  const webhookUrl =
    process.env.TEAMS_WEBHOOK_PAID_MATBAOIN ||
    process.env.TEAMS_WEBHOOK_ORDERS_MATBAOIN;
  if (!webhookUrl) throw new Error("TEAMS_WEBHOOK_ORDERS_MATBAOIN not set");

  const partnerName = Array.isArray(order.partner_id)
    ? extractCustomerName(order.partner_id[1])
    : "";
  const customerName = partnerName || "Chưa xác định";
  const team = teamLabel(order);

  // "write_date" is NOT reliable as a payment timestamp — this order may
  // have been confirmed long ago and only just got picked up because an
  // unrelated field changed (e.g. an internal "Contract State" approval
  // step bumps write_date too, confirmed live on order S6515670: confirmed
  // 13 days earlier, re-surfaced here because someone clicked an unrelated
  // approval button today). Show create_date (always true) instead of
  // asserting a "Ngày thanh toán" that may just be today's unrelated edit.
  const facts: { title: string; value: string }[] = [
    { title: "Mã đơn:", value: order.name },
    { title: "Ngày tạo đơn:", value: formatOdooDate(order.create_date) },
    { title: "Cập nhật gần nhất:", value: formatOdooDate(order.write_date) },
    { title: "Khách hàng:", value: customerName },
    { title: "Sales Team:", value: team },
    { title: "Nguồn:", value: mbiSourceLabel(order) },
  ];

  await postCard(webhookUrl, {
    title: "✅ Đơn đã thanh toán — matbao.in",
    color: "Good",
    facts,
    orderId: order.id,
    orderName: order.name,
  });
}

// ─── Card: bị hủy / khách bỏ ngang ─────────────────────────

async function sendCancelledCard(order: OdooOrder, lead?: CrmLead): Promise<void> {
  const webhookUrl =
    process.env.TEAMS_WEBHOOK_CANCELLED_MATBAOIN ||
    process.env.TEAMS_WEBHOOK_ORDERS_MATBAOIN;
  if (!webhookUrl) throw new Error("TEAMS_WEBHOOK_ORDERS_MATBAOIN not set");

  const partnerName = Array.isArray(order.partner_id)
    ? extractCustomerName(order.partner_id[1])
    : "";
  const rawContact = lead?.contact_name as string | false | null;
  const customerName = (!isFakeName(rawContact) && rawContact)
    ? rawContact
    : (partnerName || "Chưa xác định");
  const phone = lead?.phone || "";
  const team = teamLabel(order);

  // Same false-precision risk as the paid card had (fixed on S6515670):
  // write_date bumps on ANY field edit, not just the cancel transition —
  // an unrelated touch on an already-cancelled order would relabel today
  // as "the cancel date". Label honestly instead of asserting precision
  // we can't actually verify.
  const facts: { title: string; value: string }[] = [
    { title: "Mã đơn:", value: order.name },
    { title: "Ngày tạo:", value: formatOdooDate(order.create_date) },
    { title: "Cập nhật gần nhất:", value: formatOdooDate(order.write_date) },
    { title: "Khách hàng:", value: customerName },
    { title: "SĐT:", value: phone ? maskPhone(phone) : "Không có" },
    { title: "Sales Team:", value: team },
    { title: "Nguồn:", value: mbiSourceLabel(order) },
  ];

  await postCard(webhookUrl, {
    title: "⚠️ Đơn bị hủy — cần gọi lại chăm sóc",
    color: "Warning",
    facts,
    orderId: order.id,
    orderName: order.name,
  });
}

// ─── Shared card poster ───────────────────────────────────

async function postCard(webhookUrl: string, opts: {
  title: string;
  color: "Warning" | "Good" | "Accent";
  facts: { title: string; value: string }[];
  orderId: number;
  orderName: string;
}): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          body: [
            {
              type: "TextBlock",
              text: opts.title,
              weight: "Bolder",
              size: "Medium",
              color: opts.color,
            },
            { type: "FactSet", facts: opts.facts },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: `Xem đơn ${opts.orderName} trong Odoo`,
              url: odooOrderUrl(opts.orderId),
            },
          ],
        },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Teams webhook ${res.status}: ${await res.text().catch(() => "")}`);
}

// ─── Cron handler ─────────────────────────────────────────

// 2026-07-22 incident: flooded Teams with old backlog cards (e.g.
// S6513030/31/33, all dated 30/06/2026) right after an app crash+restart.
// Root cause: fs.writeFileSync on data/orders-notified.json is not atomic —
// the crash landed mid-write, corrupting the file; the next read failed
// JSON.parse and silently fell back to an empty store, so weeks of
// already-notified history looked brand new. Fixed by (1) atomic
// temp-file+rename writes (see writeFileAtomic in lib/orders-notify.ts) so
// a crash can never again leave a half-written file, and (2)
// ROLLOUT_CUTOFF_UTC below — a hardcoded floor that doesn't depend on that
// file at all, so even a future state loss for some other reason can't
// resurface backlog older than this constant.
const ROLLOUT_CUTOFF_UTC = "2026-07-22 03:20:00";

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/orders_notify");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("orders_notify", triggeredBy);
  if (guard.blocked) return guard.response;

  const startMs = Date.now();

  try {
    const webhookConfigured = !!(
      process.env.TEAMS_WEBHOOK_ORDERS_MATBAOIN ||
      process.env.TEAMS_WEBHOOK_PAID_MATBAOIN
    );

    // Look back to lastCheckedAt (with a small clock-skew buffer) so a draft order
    // created between two cron ticks is never permanently dropped once it ages out
    // of a fixed window. Capped so a long outage (redeploy, downtime) doesn't force
    // one run to backfill days of orders.
    const DEFAULT_LOOKBACK_MS = 2 * 60 * 60 * 1000;   // fallback: no prior run recorded
    const MAX_LOOKBACK_MS = 48 * 60 * 60 * 1000;      // safety cap after extended downtime
    const CLOCK_SKEW_BUFFER_MS = 5 * 60 * 1000;

    const lastCheckedAt = getLastCheckedAt();
    const nowMs = Date.now();
    let sinceMs = lastCheckedAt
      ? new Date(lastCheckedAt).getTime() - CLOCK_SKEW_BUFFER_MS
      : nowMs - DEFAULT_LOOKBACK_MS;
    const floorMs = nowMs - MAX_LOOKBACK_MS;
    if (sinceMs < floorMs) {
      console.warn(`[orders-notify] lastCheckedAt=${lastCheckedAt} too old — capping lookback to ${MAX_LOOKBACK_MS / 3600000}h`);
      sinceMs = floorMs;
    }
    const since = new Date(sinceMs).toISOString().replace("T", " ").split(".")[0];

    // ── 1. Draft orders (chờ thanh toán) — filter by CURRENT state, not by
    //    create_date >= since. Odoo's own async customer-matching can take
    //    anywhere from minutes to hours to fill in the real partner/phone
    //    (observed: "Undefine Partner" → real name+phone well after creation).
    //    A create_date-bound rolling window ages an order out of every future
    //    poll before that resolves — it just silently vanishes. Bounded only
    //    by a generous flat cap so the query doesn't scan unbounded history.
    //
    //    state in [draft, sent] — not just draft. "sent" (Quotation Sent, e.g.
    //    after "Send By Email") is still pre-payment and needs the same sales
    //    follow-up, but was previously invisible to all 3 pipelines here
    //    (draft wanted only "draft", paid only "sale", cancel only "cancel") —
    //    confirmed live on order S6530833, which sat in "sent" with a real
    //    customer name/phone for 11+ hours and was never notified at all.
    const DRAFT_LOOKBACK_DAYS = 30;
    const draftSince = new Date(nowMs - DRAFT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").split(".")[0];
    // order: desc + limit 500 — the 30-day scan's backlog has grown past
    // 500 (2714 open draft/sent orders confirmed live 2026-07-22), so an
    // ascending sort here made this query return only the 500 OLDEST
    // orders every single run — today's actual new orders were never
    // even fetched, let alone notified. Newest-first means the cap always
    // favors the time-sensitive leads sales actually needs to act on.
    const draftOrdersRaw = await searchRead<OdooOrder>(
      "sale.order",
      [
        ["create_date", ">=", draftSince],
        ["state", "in", ["draft", "sent"]],
        ...NOTIFY_ORDER_DOMAIN,
      ],
      ["id", "name", "create_date", "write_date", "team_id", "partner_id", "amount_total", "opportunity_id", "customer_source"],
      { limit: 500, order: "create_date desc" }
    );

    // ── 2. Paid orders (đã thanh toán) — filter by write_date so we catch
    //    orders that were created earlier (as draft) and just got confirmed ──
    const paidOrdersRaw = await searchRead<OdooOrder>(
      "sale.order",
      [
        ["write_date", ">=", since],
        ["state", "=", "sale"],
        ...NOTIFY_ORDER_DOMAIN,
      ],
      ["id", "name", "create_date", "write_date", "team_id", "partner_id", "amount_total", "opportunity_id", "customer_source"],
      { limit: 200, order: "write_date desc" }
    );

    // ── 3. Cancelled orders — filter by write_date so we catch orders that
    //    flipped draft→cancel (e.g. abandoned online payment) between two
    //    poll ticks, which the draft query above can never see once the
    //    state has moved past "draft" ──
    const cancelledOrdersRaw = await searchRead<OdooOrder>(
      "sale.order",
      [
        ["write_date", ">=", since],
        ["state", "=", "cancel"],
        ...NOTIFY_ORDER_DOMAIN,
      ],
      ["id", "name", "create_date", "write_date", "team_id", "partner_id", "amount_total", "opportunity_id", "customer_source"],
      { limit: 200, order: "write_date desc" }
    );

    // NOTIFY_ORDER_DOMAIN already enforces team_id + customer_source at the
    // Odoo query level — isNotifiableOrder below is a defensive re-check.
    // ROLLOUT_CUTOFF is a hard, permanent floor: orders older than it are
    // dropped here, before dedup ever runs — this doesn't depend on
    // notifiedDraftIds/notifiedCancelIds at all, so even a total loss of
    // that state (corrupted file, wiped volume, whatever) can never again
    // resurface weeks-old backlog the way it did 2026-07-21/22. Draft's
    // 30-day scan is the wide one that made that possible; cancel's
    // write_date `since` window is normally tighter but gets this floor
    // too for the same guarantee.
    const draftOrders = draftOrdersRaw.filter(isNotifiableOrder).filter(o => o.create_date >= ROLLOUT_CUTOFF_UTC);
    const paidOrders = paidOrdersRaw.filter(isNotifiableOrder);
    const cancelledOrders = cancelledOrdersRaw.filter(isNotifiableOrder).filter(o => o.write_date >= ROLLOUT_CUTOFF_UTC);

    console.log(`[orders-notify] draft=${draftOrders.length}/${draftOrdersRaw.length} paid=${paidOrders.length}/${paidOrdersRaw.length} cancel=${cancelledOrders.length}/${cancelledOrdersRaw.length} since ${since}`);

    // ── Batch-fetch CRM leads for ALL draft + cancelled orders (need phone for filters) ──
    const oppIds = [...draftOrders, ...cancelledOrders]
      .filter(o => Array.isArray(o.opportunity_id))
      .map(o => (o.opportunity_id as [number, string])[0]);

    const leadMap = new Map<number, CrmLead>();
    if (oppIds.length > 0) {
      const leads = await searchRead<CrmLead>(
        "crm.lead",
        [["id", "in", oppIds]],
        ["id", "contact_name", "phone", "email_from"]
      );
      for (const lead of leads) leadMap.set(lead.id, lead);
    }

    // ── First run seed (draft) ──
    const notifiedDraftIds = getNotifiedDraftIds();
    if (notifiedDraftIds.size === 0 && draftOrders.length > 0) {
      markNotifiedDraft(draftOrders.map(o => o.id));
      console.log(`[orders-notify] draft seed: ${draftOrders.length} IDs`);
    }

    // ── First run seed (paid) ──
    const notifiedPaidIds = getNotifiedPaidIds();
    if (notifiedPaidIds.size === 0 && paidOrders.length > 0) {
      markNotifiedPaid(paidOrders.map(o => o.id));
      console.log(`[orders-notify] paid seed: ${paidOrders.length} IDs`);
    }

    // ── First run seed (cancel) ──
    const notifiedCancelIds = getNotifiedCancelIds();
    if (notifiedCancelIds.size === 0 && cancelledOrders.length > 0) {
      markNotifiedCancel(cancelledOrders.map(o => o.id));
      console.log(`[orders-notify] cancel seed: ${cancelledOrders.length} IDs`);
    }

    // If all three were empty → first run, return early
    if (notifiedDraftIds.size === 0 && notifiedPaidIds.size === 0 && notifiedCancelIds.size === 0) {
      await guard.finish("success", `init seed: draft=${draftOrders.length} paid=${paidOrders.length} cancel=${cancelledOrders.length}`);
      return NextResponse.json({
        success: true, firstRun: true,
        seededDraft: draftOrders.length, seededPaid: paidOrders.length, seededCancel: cancelledOrders.length,
        duration: Date.now() - startMs,
      });
    }

    // ── One-time backlog silence: "start fresh from today" ──
    // The draft query's 30-day state scan surfaces every pre-existing
    // long-stuck draft/sent order as "new" the first time it runs — by
    // request, that catch-up burst is silenced instead of sent: every
    // currently-open draft/sent order is marked as already-notified
    // (no card sent) exactly once, so only orders that are new or change
    // state/identity AFTER this point ever fire a notification.
    if (!getBacklogSilencedAt()) {
      const toSilence = draftOrders.filter(o => !notifiedDraftIds.has(o.id)).map(o => o.id);
      if (toSilence.length > 0) {
        markNotifiedDraft(toSilence);
        toSilence.forEach(id => notifiedDraftIds.add(id));
      }
      markBacklogSilenced();
      console.log(`[orders-notify] backlog silenced (start fresh from today): ${toSilence.length} draft/sent IDs`);
    }

    // ── One-time "no-filter rollout" backlog silence — 2026-07-21 ──
    // By request, the name/phone quality gate (skipReason) is removed
    // entirely below — every qualified order gets reported now, including
    // ones with an unresolved partner or test-looking data. Without this
    // one-time silence, the entire existing backlog that was previously
    // sitting in permanent/transient skip (thousands of orders) would all
    // become sendable at once on the first run after this change and flood
    // Teams. Silence it exactly once at rollout (same "start fresh from
    // today" pattern used elsewhere in this file) — only orders new or
    // freshly re-evaluated AFTER this point ever fire.
    if (!getNoFilterRolloutSilencedAt()) {
      const toSilenceDraft = draftOrders.filter(o => !notifiedDraftIds.has(o.id)).map(o => o.id);
      if (toSilenceDraft.length > 0) {
        markNotifiedDraft(toSilenceDraft);
        toSilenceDraft.forEach(id => notifiedDraftIds.add(id));
      }
      const toSilenceCancel = cancelledOrders.filter(o => !notifiedCancelIds.has(o.id)).map(o => o.id);
      if (toSilenceCancel.length > 0) {
        markNotifiedCancel(toSilenceCancel);
        toSilenceCancel.forEach(id => notifiedCancelIds.add(id));
      }
      markNoFilterRolloutSilenced();
      console.log(`[orders-notify] no-filter rollout backlog silenced: draft=${toSilenceDraft.length} cancel=${toSilenceCancel.length}`);
    }

    // ── One-time "customer_source rollout" backlog silence — 2026-07-25 ──
    // Switched the qualification rule from source_id (undercounted real
    // MBI/MKT orders by ~72%) to customer_source (confirmed correct — see
    // lib/mbi-order-sources.ts). The new rule catches real orders (mostly
    // "Kênh chat") that the old rule NEVER checked at all, for their
    // entire history. Without this, that whole pre-existing backlog would
    // flood Teams the instant this deploys. Silence draft/paid/cancel
    // backlogs exactly once at rollout — by request, so only orders new or
    // freshly re-evaluated AFTER this point ever fire under the wider rule.
    if (!getCustomerSourceRolloutSilencedAt()) {
      const toSilenceDraft = draftOrders.filter(o => !notifiedDraftIds.has(o.id)).map(o => o.id);
      if (toSilenceDraft.length > 0) {
        markNotifiedDraft(toSilenceDraft);
        toSilenceDraft.forEach(id => notifiedDraftIds.add(id));
      }
      const toSilencePaid = paidOrders.filter(o => !notifiedPaidIds.has(o.id)).map(o => o.id);
      if (toSilencePaid.length > 0) {
        markNotifiedPaid(toSilencePaid);
        toSilencePaid.forEach(id => notifiedPaidIds.add(id));
      }
      const toSilenceCancel = cancelledOrders.filter(o => !notifiedCancelIds.has(o.id)).map(o => o.id);
      if (toSilenceCancel.length > 0) {
        markNotifiedCancel(toSilenceCancel);
        toSilenceCancel.forEach(id => notifiedCancelIds.add(id));
      }
      markCustomerSourceRolloutSilenced();
      console.log(`[orders-notify] customer_source rollout backlog silenced: draft=${toSilenceDraft.length} paid=${toSilencePaid.length} cancel=${toSilenceCancel.length}`);
    }

    // ── Send draft notifications ──
    const newDraft = draftOrders.filter(o => !notifiedDraftIds.has(o.id));
    let sentDraft = 0;
    const sentDraftIds: number[] = [];
    const draftRunDetail: string[] = []; // e.g. "S6537276(sent)" — for this run's resultSummary
    const draftEvents: Omit<NotifyEvent, "ts">[] = []; // flushed once after the loop — see logNotifyEvents

    for (const order of newDraft) {
      const oppId = Array.isArray(order.opportunity_id) ? order.opportunity_id[0] : null;
      const lead = oppId ? leadMap.get(oppId) : undefined;
      const phone = (lead?.phone as string | false) || "";

      // By request 2026-08-17: order converted straight from a matbao.in
      // Lead (e.g. "THIEN TRAN" → S6564734) was double-reporting — one
      // "Lead mới" card at lead creation, one "Đơn chờ thanh toán" card at
      // order creation, for what staff see as a single event. Skip the
      // order card when the underlying lead already got its own card
      // recently (see lib/leads-notify.ts wasLeadRecentlyNotified).
      if (oppId !== null && wasLeadRecentlyNotified(oppId)) {
        sentDraftIds.push(order.id); // seen — never re-check under this pipeline
        draftEvents.push({ pipeline: "draft", action: "skipped_dedup", orderId: order.id, orderName: order.name, reason: `lead ${oppId} already sent as "Lead mới" recently` });
        draftRunDetail.push(`${order.name}(skip: lead-notified)`);
        continue;
      }

      const resolution = partnerResolution(order);
      if (resolution === "waiting") {
        draftEvents.push({ pipeline: "draft", action: "skipped_retry", orderId: order.id, orderName: order.name, reason: `partner unresolved, waiting (age < ${UNRESOLVED_PARTNER_WAIT_MINUTES}m)` });
        draftRunDetail.push(`${order.name}(waiting)`);
        continue; // not marked seen — re-evaluated next run
      }
      if (resolution === "expired") {
        sentDraftIds.push(order.id); // gave it its window — never re-check
        draftEvents.push({ pipeline: "draft", action: "skipped_permanent", orderId: order.id, orderName: order.name, reason: `partner never resolved within ${UNRESOLVED_PARTNER_WAIT_MINUTES}m` });
        draftRunDetail.push(`${order.name}(expired)`);
        continue;
      }

      // ── Cùng SĐT đã báo trong 2h — TẠM TẮT để kiểm tra đơn ──
      // if (phone && wasPhoneRecentlyNotified(phone)) {
      //   console.log(`[orders-notify] skip ${order.name} — phone dedup`);
      //   continue;
      // }

      try {
        await sendDraftCard(order, lead);
        sentDraftIds.push(order.id);
        draftEvents.push({ pipeline: "draft", action: "sent", orderId: order.id, orderName: order.name, reason: null });
        draftRunDetail.push(`${order.name}(sent)`);
        if (phone) markPhoneNotified(phone);
        sentDraft++;
        if (newDraft.length > 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[orders-notify] draft ${order.name}: ${msg}`);
        draftEvents.push({ pipeline: "draft", action: "error", orderId: order.id, orderName: order.name, reason: msg });
        draftRunDetail.push(`${order.name}(error)`);
      }
    }
    if (sentDraftIds.length > 0) markNotifiedDraft(sentDraftIds);
    logNotifyEvents(draftEvents);

    // ── One-time paid backlog silence: "start fresh from today" ──
    // Mirrors the draft backlog silence above — closes the S6515670 class of
    // bug (confirmed weeks earlier, never notified, then re-surfaced by an
    // unrelated field edit bumping write_date) at the root instead of only
    // fixing the date label. Runs exactly once.
    if (!getPaidBacklogSilencedAt()) {
      const toSilencePaid = paidOrders.filter(o => !notifiedPaidIds.has(o.id)).map(o => o.id);
      if (toSilencePaid.length > 0) {
        markNotifiedPaid(toSilencePaid);
        toSilencePaid.forEach(id => notifiedPaidIds.add(id));
      }
      markPaidBacklogSilenced();
      console.log(`[orders-notify] paid backlog silenced (start fresh from today): ${toSilencePaid.length} IDs`);
    }

    // ── Send paid notifications ──
    // Skip (but still mark as seen) any order that already got a "chờ thanh
    // toán" card — sales was already pinged about it once; a second "đã
    // thanh toán" ping for the exact same order is a duplicate, not a new
    // signal. Orders that pay immediately online (never sat in draft/sent
    // long enough to be caught) still get the "đã thanh toán" card as the
    // first and only notification for that order.
    const newPaid = paidOrders.filter(o => !notifiedPaidIds.has(o.id));
    let sentPaid = 0;
    let skippedPaidAlreadyDrafted = 0;
    const sentPaidIds: number[] = [];
    const paidRunDetail: string[] = [];
    const paidEvents: Omit<NotifyEvent, "ts">[] = [];

    for (const order of newPaid) {
      if (notifiedDraftIds.has(order.id)) {
        console.log(`[orders-notify] skip-paid ${order.name} — already sent as "chờ thanh toán"`);
        paidEvents.push({
          pipeline: "paid", action: "skipped_dedup",
          orderId: order.id, orderName: order.name, reason: `already sent as "chờ thanh toán"`,
        });
        paidRunDetail.push(`${order.name}(skip: already-drafted)`);
        sentPaidIds.push(order.id);
        skippedPaidAlreadyDrafted++;
        continue;
      }

      // Same lead→order cross-dedup as the draft pipeline — covers orders
      // that pay immediately online and skip draft entirely, so this is the
      // only pipeline that would otherwise send a card for them.
      const oppId = Array.isArray(order.opportunity_id) ? order.opportunity_id[0] : null;
      if (oppId !== null && wasLeadRecentlyNotified(oppId)) {
        sentPaidIds.push(order.id);
        paidEvents.push({ pipeline: "paid", action: "skipped_dedup", orderId: order.id, orderName: order.name, reason: `lead ${oppId} already sent as "Lead mới" recently` });
        paidRunDetail.push(`${order.name}(skip: lead-notified)`);
        continue;
      }
      try {
        await sendPaidCard(order);
        sentPaidIds.push(order.id);
        paidEvents.push({ pipeline: "paid", action: "sent", orderId: order.id, orderName: order.name, reason: null });
        paidRunDetail.push(`${order.name}(sent)`);
        sentPaid++;
        if (newPaid.length > 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[orders-notify] paid ${order.name}: ${msg}`);
        paidEvents.push({ pipeline: "paid", action: "error", orderId: order.id, orderName: order.name, reason: msg });
        paidRunDetail.push(`${order.name}(error)`);
      }
    }
    if (sentPaidIds.length > 0) markNotifiedPaid(sentPaidIds);
    logNotifyEvents(paidEvents);

    // ── One-time cancel backlog silence: "start fresh from today" ──
    // Mirrors the draft/paid backlog silence above. Was missing here, which
    // is exactly why old, already-cancelled orders (never notified because
    // the cancel pipeline didn't exist yet, or hadn't seen them) resurfaced
    // as "new" cancellations the moment something unrelated touched the
    // record and bumped write_date — confirmed live on S6500112/S6492833.
    // Runs exactly once; only cancellations that happen AFTER this point
    // ever fire a card from here on.
    if (!getCancelBacklogSilencedAt()) {
      const toSilenceCancel = cancelledOrders.filter(o => !notifiedCancelIds.has(o.id)).map(o => o.id);
      if (toSilenceCancel.length > 0) {
        markNotifiedCancel(toSilenceCancel);
        toSilenceCancel.forEach(id => notifiedCancelIds.add(id));
      }
      markCancelBacklogSilenced();
      console.log(`[orders-notify] cancel backlog silenced (start fresh from today): ${toSilenceCancel.length} IDs`);
    }

    // ── Send cancelled notifications ──
    const newCancel = cancelledOrders.filter(o => !notifiedCancelIds.has(o.id));
    let sentCancel = 0;
    const sentCancelIds: number[] = [];
    const cancelRunDetail: string[] = [];
    const cancelEvents: Omit<NotifyEvent, "ts">[] = [];

    // Thẻ đơn hủy đang tắt → đánh dấu đã xem, không gửi (xem đầu tệp).
    const cancelOn = cancelCardsEnabled();
    if (!cancelOn) {
      for (const order of newCancel) {
        sentCancelIds.push(order.id);
        cancelEvents.push({ pipeline: "cancel", action: "skipped_permanent", orderId: order.id, orderName: order.name, reason: "thẻ đơn hủy đang tắt (ORDERS_NOTIFY_CANCEL)" });
        cancelRunDetail.push(`${order.name}(off)`);
      }
    }

    for (const order of (cancelOn ? newCancel : [])) {
      const oppId = Array.isArray(order.opportunity_id) ? order.opportunity_id[0] : null;
      const lead = oppId ? leadMap.get(oppId) : undefined;

      const resolution = partnerResolution(order);
      if (resolution === "waiting") {
        cancelEvents.push({ pipeline: "cancel", action: "skipped_retry", orderId: order.id, orderName: order.name, reason: `partner unresolved, waiting (age < ${UNRESOLVED_PARTNER_WAIT_MINUTES}m)` });
        cancelRunDetail.push(`${order.name}(waiting)`);
        continue;
      }
      if (resolution === "expired") {
        sentCancelIds.push(order.id);
        cancelEvents.push({ pipeline: "cancel", action: "skipped_permanent", orderId: order.id, orderName: order.name, reason: `partner never resolved within ${UNRESOLVED_PARTNER_WAIT_MINUTES}m` });
        cancelRunDetail.push(`${order.name}(expired)`);
        continue;
      }

      try {
        await sendCancelledCard(order, lead);
        sentCancelIds.push(order.id);
        cancelEvents.push({ pipeline: "cancel", action: "sent", orderId: order.id, orderName: order.name, reason: null });
        cancelRunDetail.push(`${order.name}(sent)`);
        sentCancel++;
        if (newCancel.length > 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[orders-notify] cancel ${order.name}: ${msg}`);
        cancelEvents.push({ pipeline: "cancel", action: "error", orderId: order.id, orderName: order.name, reason: msg });
        cancelRunDetail.push(`${order.name}(error)`);
      }
    }
    if (sentCancelIds.length > 0) markNotifiedCancel(sentCancelIds);
    logNotifyEvents(cancelEvents);

    // Advance checkpoint regardless of whether anything new was found this run.
    touchLastChecked();

    const summary = `draft ${sentDraft}/${newDraft.length} sent [${summarizeNames(draftRunDetail)}]; `
      + `paid ${sentPaid}/${newPaid.length} sent (already-drafted ${skippedPaidAlreadyDrafted}) [${summarizeNames(paidRunDetail)}]; `
      + `cancel ${sentCancel}/${newCancel.length} sent [${summarizeNames(cancelRunDetail)}]`;
    await guard.finish("success", summary);

    return NextResponse.json({
      success: true,
      draft:  { inWindow: draftOrders.length,     new: newDraft.length,   sent: sentDraft },
      paid:   { inWindow: paidOrders.length,      new: newPaid.length,    sent: sentPaid,   alreadyDrafted: skippedPaidAlreadyDrafted },
      cancel: { inWindow: cancelledOrders.length, new: newCancel.length,  sent: sentCancel },
      webhookConfigured,
      duration: Date.now() - startMs,
    });

  } catch (err) {
    await guard.finish("failure", null, err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
