// ============================================================
// GA4 API Route — /api/ga4
// Fetches GA4 campaign data, manages connection status
// ============================================================
//
// Connection configs (data/ga4-settings.json) — persisted to disk with
// accessToken/refreshToken encrypted at rest, same pattern as
// app/api/settings/meta|google|gemini|telegram/route.ts. Previously this
// was a plain module-scope `let ga4Configs = []`, wiped on every
// redeploy/restart — flagged in the 2026-07 feature audit. Note: as of
// this fix, no UI anywhere in the app actually calls connect_property /
// disconnect_property / update_mapping (confirmed — no call sites in
// app/ or components/), so this closes the persistence gap but doesn't by
// itself make GA4 connectable; a connect UI is still a separate, unbuilt
// piece.
//
// Fetched campaign/conversion data (ga4DataCache) stays in-memory — it's
// a re-fetchable cache, not configuration, fine to lose on restart.

import { isAdmin, canAccessCompany, canAccessAllCompanies } from "@/lib/permissions";
import { isCompany } from "@/lib/companies";
import type { SessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  fetchGA4ByCampaign,
  fetchGA4ConversionEvents,
  transformGA4Response,
  type GA4CampaignData,
  type GA4ConversionEvent,
} from "@/lib/ga4-client";
import type { GA4PropertyMapping } from "@/types/ads.types";
import { getCurrentUser } from "@/lib/auth";
import { guardEditCredentials } from "@/lib/settings/guards";
import { writeAuditEntry } from "@/lib/settings/audit";
import { maskSecret } from "@/lib/settings/validators/credentials";
import {
  readGA4Connections as readConfigs,
  mutateGA4Connections as mutateConfigs,
} from "@/lib/ga4-connections";
import {
  readGA4OAuth,
  clearGA4OAuth,
  getAccessToken,
  invalidateAccessToken,
} from "@/lib/ga4-oauth";
import { friendlyError } from "@/lib/not-configured";

// ── Persistent connection configs ───────────────────────────

// Never send raw tokens to the browser — same convention as every other
// credentials GET endpoint in Settings.
function toPublicView(c: GA4PropertyMapping) {
  return {
    id: c.id,
    propertyId: c.propertyId,
    propertyName: c.propertyName,
    measurementId: c.measurementId,
    status: c.status,
    mappedCompany: c.mappedCompany,
    accessToken: maskSecret(c.accessToken),
    hasAccessToken: !!c.accessToken,
    hasRefreshToken: !!c.refreshToken,
  };
}

// ── In-memory fetch cache (re-fetchable, not config — fine to lose on restart) ──
// Đợt 21 A5b: cả hai bộ đệm theo propertyId để lọc được theo công ty người xem.
const ga4DataCache: Map<string, GA4CampaignData[]> = new Map();
const conversionCache: Map<string, GA4ConversionEvent[]> = new Map();
let lastFetchedAt: string | null = null;

/** Property gán cho một công ty → người được giao công ty đó; chưa gán / "ALL" → chỉ người được giao MỌI công ty. */
function canSeeConnection(user: SessionUser, c: GA4PropertyMapping): boolean {
  return c.mappedCompany && c.mappedCompany !== "ALL" ? canAccessCompany(user, c.mappedCompany) : canAccessAllCompanies(user);
}
function visibleData(user: SessionUser) {
  const connections = readConfigs().filter((c) => canSeeConnection(user, c));
  const ids = connections.map((c) => c.propertyId);
  return {
    connections,
    campaigns: ids.flatMap((id) => ga4DataCache.get(id) ?? []),
    conversionEvents: ids.flatMap((id) => conversionCache.get(id) ?? []),
  };
}

// ── GET: Return cached data + connection status ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Đợt 21 A4: phản hồi không có token (chỉ trạng thái + số liệu) → admin+ như cũ, không cần quyền xem khoá.
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });

  const { connections: configs, campaigns: allCampaigns, conversionEvents } = visibleData(user);
  const oauth = readGA4OAuth();
  return NextResponse.json({
    success: true,
    data: {
      oauth: oauth
        ? { connected: true, connectedAt: oauth.connectedAt, connectedBy: oauth.connectedBy }
        : { connected: false },
      connections: configs.map(toPublicView),
      campaigns: allCampaigns,
      conversionEvents,
      lastFetchedAt,
      totalSessions: allCampaigns.reduce((s, c) => s + c.sessions, 0),
      totalConversions: allCampaigns.reduce((s, c) => s + c.conversions, 0),
    },
  });
}

// ── POST: Actions (fetch, connect, disconnect, update_mapping) ──
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  // fetch is a read of already-connected properties — view permission is
  // enough. Every action that changes stored connections needs edit.
  const guard = action === "fetch" ? (isAdmin(user.role) ? null : NextResponse.json({ error: "Không có quyền" }, { status: 403 })) : guardEditCredentials(user);
  if (guard) return guard;

  switch (action) {
    case "connect_property": {
      const { propertyId, propertyName, measurementId, mappedCompany } = body;
      if (mappedCompany && mappedCompany !== "ALL" && !isCompany(mappedCompany)) {
        return NextResponse.json({ success: false, error: "Công ty không hợp lệ" }, { status: 400 });
      }

      // Tokens are no longer accepted from the client. They come from the
      // OAuth grant made in Settings → GA4 (/api/ga4/auth), so a connection
      // can refresh itself instead of dying with the pasted access token
      // about an hour later.
      const oauth = readGA4OAuth();
      if (!oauth) {
        return NextResponse.json(
          { success: false, error: "Chưa kết nối Google Analytics — bấm 'Kết nối Google Analytics' trước.", needsConnect: true },
          { status: 409 },
        );
      }
      if (!propertyId) {
        return NextResponse.json({ success: false, error: "Thiếu propertyId" }, { status: 400 });
      }
      if (readConfigs().some((c) => c.propertyId === propertyId)) {
        return NextResponse.json({ success: false, error: "Property này đã được kết nối" }, { status: 409 });
      }

      const result = await mutateConfigs((configs) => {
        const newConfig: GA4PropertyMapping = {
          id: crypto.randomUUID(),
          propertyId,
          propertyName: propertyName || propertyId,
          measurementId: measurementId || "",
          // Access tokens are derived per request from the refresh token;
          // nothing long-lived is stored here.
          accessToken: "",
          refreshToken: oauth.refreshToken,
          status: "CONNECTED",
          mappedCompany: mappedCompany || null,
        };
        const next = [...configs, newConfig];
        return { configs: next, result: next };
      });
      await writeAuditEntry("credentials_ga4", user, "update", "connect_property", null, propertyId, "ALL");
      return NextResponse.json({ success: true, data: result.map(toPublicView) });
    }

    case "disconnect_oauth": {
      // Revoking the grant makes every stored property unusable, so drop
      // them together rather than leaving connections that can never fetch.
      const oauth = readGA4OAuth();
      if (oauth) invalidateAccessToken(oauth.refreshToken);
      await clearGA4OAuth();
      await mutateConfigs(() => ({ configs: [], result: null }));
      ga4DataCache.clear();
      conversionCache.clear();
      await writeAuditEntry("credentials_ga4", user, "update", "disconnect_oauth", null, null, "ALL");
      return NextResponse.json({ success: true, data: [] });
    }

    case "disconnect_property": {
      const { id } = body;
      const { remaining, target } = await mutateConfigs((configs) => {
        const target = configs.find((c) => c.id === id);
        const remaining = configs.filter((c) => c.id !== id);
        return { configs: remaining, result: { remaining, target } };
      });
      if (target) {
        ga4DataCache.delete(target.propertyId);
        conversionCache.delete(target.propertyId);
        await writeAuditEntry("credentials_ga4", user, "update", "disconnect_property", null, null, "ALL");
      }
      return NextResponse.json({ success: true, data: remaining.map(toPublicView) });
    }

    case "update_mapping": {
      const { id, mappedCompany } = body;
      if (mappedCompany && mappedCompany !== "ALL" && !isCompany(mappedCompany)) {
        return NextResponse.json({ success: false, error: "Công ty không hợp lệ" }, { status: 400 });
      }
      const { configs: updated, found } = await mutateConfigs((configs) => {
        const config = configs.find((c) => c.id === id);
        if (config) config.mappedCompany = mappedCompany;
        return { configs, result: { configs, found: !!config } };
      });
      if (found) {
        await writeAuditEntry("credentials_ga4", user, "update", "mappedCompany", null, mappedCompany, "ALL");
      }
      return NextResponse.json({ success: true, data: updated.map(toPublicView) });
    }

    // ── Fetch real GA4 data ──
    case "fetch": {
      // Soát bảo mật 03/10: chỉ kéo property người này được xem (trước đây kéo hết → lỗi lộ tên property công ty khác).
      const configs = visibleData(user).connections;
      if (configs.length === 0) {
        return NextResponse.json(
          { success: false, error: "GA4 not connected" },
          { status: 400 }
        );
      }

      try {
        const today = new Date().toISOString().split("T")[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
        const dateRange = { startDate: thirtyDaysAgo, endDate: today };

        ga4DataCache.clear();
        conversionCache.clear();
        for (const config of configs) {
          if (config.status !== "CONNECTED") continue;
          if (!config.refreshToken) {
            throw new Error(`Property ${config.propertyName} chưa có quyền OAuth — hãy kết nối lại Google Analytics.`);
          }
          // Always mint a fresh access token: the stored one (if any) is
          // from an older build and is certainly expired.
          const accessToken = await getAccessToken(config.refreshToken);
          const [campaignReport, conversionReport] = await Promise.all([
            fetchGA4ByCampaign(config.propertyId, dateRange, accessToken),
            fetchGA4ConversionEvents(config.propertyId, dateRange, accessToken),
          ]);
          ga4DataCache.set(config.propertyId, transformGA4Response(campaignReport));
          conversionCache.set(config.propertyId, conversionReport);
        }

        lastFetchedAt = new Date().toISOString();
        const allCampaigns = visibleData(user).campaigns;

        return NextResponse.json({
          success: true,
          data: {
            campaigns: allCampaigns,
            lastFetchedAt,
            count: allCampaigns.length,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to fetch GA4 data";
        return NextResponse.json(
          { success: false, error: friendlyError(message) },
          { status: 500 }
        );
      }
    }

    default:
      return NextResponse.json(
        { success: false, error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
