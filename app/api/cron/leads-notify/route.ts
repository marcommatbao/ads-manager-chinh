// ============================================================
// Cron — Poll Odoo for new matbao.in leads → Teams notification
// GET /api/cron/leads-notify  (every 5 minutes via dcron)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { searchRead } from "@/lib/odoo-client";
import {
  getNotifiedIds, markNotified,
  wasCustomerRecentlyNotified, markCustomerNotified,
} from "@/lib/leads-notify";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface OdooLead {
  id: number;
  name: string;
  partner_name: string | false;
  contact_name: string | false;
  phone: string | false;
  create_date: string;
  source_id: [number, string] | false;
  team_id: [number, string] | false;
}

// Odoo can spawn several distinct crm.lead records (real, different IDs) for
// the same customer within a short span — e.g. a sale touching an existing
// customer re-creates an opportunity. Identify the underlying customer so
// repeats can be rate-limited independent of lead.id. Priority: Odoo's own
// customer code (the "[MB1234567]" prefix already used the same way in
// orders-notify.ts's extractCustomerName()) > phone > normalized name.
function customerKey(lead: OdooLead): string {
  const mbCode = lead.name.match(/\[MB(\d+)\]/i);
  if (mbCode) return `mb:${mbCode[1]}`;

  const digits = (lead.phone || "").replace(/\D/g, "");
  if (digits.length >= 8) return `phone:${digits}`;

  const name = ((lead.partner_name || lead.contact_name || lead.name || "") as string)
    .trim().toLowerCase();
  return `name:${name}`;
}

async function sendTeamsCard(name: string, team: string): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_MATBAOIN;
  if (!webhookUrl) throw new Error("TEAMS_WEBHOOK_MATBAOIN env not set");

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
              text: "🔔 Lead mới — matbao.in",
              weight: "Bolder",
              size: "Medium",
              color: "Accent",
            },
            {
              type: "FactSet",
              facts: [
                { title: "Sales Team:", value: team },
                { title: "Họ và tên:", value: name },
              ],
            },
          ],
        },
      }],
    }),
  });

  if (!res.ok) throw new Error(`Teams webhook ${res.status}: ${await res.text().catch(() => "")}`);
}

function toVnTime(odooDateStr: string): string {
  // Odoo stores datetime in UTC without timezone suffix
  const dt = new Date(odooDateStr.includes("T") ? odooDateStr : odooDateStr.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
}

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/leads_notify");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("leads_notify", triggeredBy);
  if (guard.blocked) return guard.response;

  const startMs = Date.now();

  try {
    // Validate env early so missing webhook shows as job failure (not silent skip)
    const webhookConfigured = !!process.env.TEAMS_WEBHOOK_MATBAOIN;
    if (!webhookConfigured) {
      console.warn("[leads-notify] TEAMS_WEBHOOK_MATBAOIN not set — notifications will not be sent");
    }

    // Nới 24h → 72h ngày 17/09/2026. Dedup theo id đã lưu (giữ 90 ngày) nên
    // nới cửa sổ KHÔNG làm gửi trùng — nó chỉ quyết định lead cũ tới đâu còn
    // được NHÌN THẤY.
    //
    // Vì sao cần: hôm đó máy chủ hết dung lượng đĩa, hai cron thông báo ngừng
    // chạy 16 tiếng. Với cửa sổ 24h, mọi lead sinh ra trong lúc ngừng mà không
    // được cứu trong vòng một ngày là mất THẲNG — cron hồi phục cũng không còn
    // nhìn thấy chúng nữa. 72h cho ba ngày để sửa hạ tầng trước khi mất thật.
    const LOOKBACK_HOURS = 72;
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .split(".")[0];

    // Filter by source_id directly in Odoo — Odoo has 1000+ leads/day so
    // fetching all and filtering TS-side would miss new leads beyond the limit.
    // source_id.name ilike gives case-insensitive substring match on source name.
    //
    // TEMPORARILY back to source_id-only (2026-07-16, by request) — a team_id
    // "M-*" OR fallback was tried to also catch leads with a blank/different
    // source_id, but it surfaced a full 24h backlog of previously-invisible
    // M-* team leads all in one burst on first deploy (expected, since they'd
    // never matched before — see git history). Paused to let the team confirm
    // that backlog was legitimate before re-enabling. To restore: OR in
    // `"team_id.name", "=ilike", "m-%"` (same "M-*" convention proven in
    // orders-notify.ts's isMTeam()), and consider adding a one-time backlog
    // silence first (mirrors orders-notify's cancel backlog fix) so
    // re-enabling doesn't burst again.
    const leads = await searchRead<OdooLead>(
      "crm.lead",
      [["create_date", ">=", since], ["source_id.name", "ilike", "matbao.in"]],
      ["id", "name", "partner_name", "contact_name", "phone", "create_date", "source_id", "team_id"],
      { limit: 100, order: "create_date asc" }
    );

    console.log(`[leads-notify] Odoo returned ${leads.length} matbao.in leads in last ${LOOKBACK_HOURS}h`);

    const notifiedIds = getNotifiedIds();
    const newLeads = leads.filter(l => !notifiedIds.has(l.id));

    let sent = 0;
    let skippedDuplicateCustomer = 0;
    const sentIds: number[] = [];
    const errors: string[] = [];

    for (const lead of newLeads) {
      const name = (lead.partner_name || lead.contact_name || lead.name || "Không rõ") as string;
      const team = Array.isArray(lead.team_id) ? lead.team_id[1] : "Chưa phân";
      const custKey = customerKey(lead);

      // Same customer already got a card within the last 6h — a genuinely
      // new crm.lead.id for a repeat/duplicate opportunity shouldn't spam
      // Teams again. Still marked as seen (sentIds) so this lead.id itself
      // is never re-evaluated on a future run.
      if (wasCustomerRecentlyNotified(custKey)) {
        console.log(`[leads-notify] lead ${lead.id} (${name}) — customer dedup, skipped (key=${custKey})`);
        sentIds.push(lead.id);
        skippedDuplicateCustomer++;
        continue;
      }

      try {
        await sendTeamsCard(name, team);
        sentIds.push(lead.id);
        markCustomerNotified(custKey);
        sent++;
        if (newLeads.length > 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[leads-notify] lead ${lead.id} failed: ${msg}`);
        errors.push(msg);
      }
    }

    if (sentIds.length > 0) markNotified(sentIds);

    const summary = `${sent}/${newLeads.length} new sent; ${skippedDuplicateCustomer} customer-dedup skipped; ${leads.length - newLeads.length} already sent; ${leads.length} matbao.in leads ${LOOKBACK_HOURS}h`;
    await guard.finish("success", summary);

    return NextResponse.json({
      success: true,
      matbaoInLeads: leads.length,
      newLeads: newLeads.length,
      sent,
      skippedDuplicateCustomer,
      skipped: leads.length - newLeads.length,
      webhookConfigured,
      errors: errors.length ? errors : undefined,
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
