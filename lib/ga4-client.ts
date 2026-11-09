// ============================================================
// GA4 Client — Google Analytics 4 Data Integration
// Fetches real sessions, bounce rate, conversions per campaign
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface GA4Connection {
  propertyId: string;       // "properties/123456789"
  propertyName: string;     // "MBC Website"
  measurementId: string;    // "G-XXXXXXXXXX"
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectedAt: string;
  status: "CONNECTED" | "EXPIRED" | "ERROR" | "NOT_CONNECTED";
}

export interface GA4CampaignData {
  campaignName: string;
  source: string;           // "facebook" | "google" | "cpc"
  medium: string;           // "cpc" | "paid"
  sessions: number;
  bounceRate: number;       // 0-1
  avgSessionDuration: number; // seconds
  pagesPerSession: number;
  newUsers: number;
  engagementRate: number;   // 0-1
  conversions: number;
  revenue: number;
  // Computed
  conversionRate: number;   // conversions / sessions
  propertyId?: string;      // Identifies which GA4 property this row came from
}

export interface GA4ConversionEvent {
  eventName: string;        // "purchase", "generate_lead"
  campaignName: string;
  source: string;
  eventCount: number;
  revenue: number;
}

// ─────────────────────────────────────────────
// GA4 Data API — Fetch by UTM Campaign
// ─────────────────────────────────────────────

export async function fetchGA4ByCampaign(
  propertyId: string,
  dateRange: { startDate: string; endDate: string },
  accessToken: string
): Promise<any> {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [dateRange],
        dimensions: [
          { name: "sessionCampaignName" },
          { name: "sessionSource" },
          { name: "sessionMedium" },
        ],
        metrics: [
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
          { name: "screenPageViewsPerSession" },
          { name: "conversions" },
          { name: "totalRevenue" },
          { name: "newUsers" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
        ],
        dimensionFilter: {
          orGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "sessionMedium",
                  stringFilter: { matchType: "EXACT", value: "cpc" },
                },
              },
              {
                filter: {
                  fieldName: "sessionMedium",
                  stringFilter: { matchType: "EXACT", value: "paid" },
                },
              },
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: { matchType: "CONTAINS", value: "facebook" },
                },
              },
            ],
          },
        },
        limit: 1000,
      }),
    }
  );
  return response.json();
}

// ─────────────────────────────────────────────
// GA4 Conversion Events
// ─────────────────────────────────────────────

export async function fetchGA4ConversionEvents(
  propertyId: string,
  dateRange: { startDate: string; endDate: string },
  accessToken: string
): Promise<any> {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [dateRange],
        dimensions: [
          { name: "eventName" },
          { name: "sessionCampaignName" },
          { name: "sessionSource" },
        ],
        metrics: [
          { name: "eventCount" },
          { name: "totalRevenue" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "isKeyEvent",
            stringFilter: { matchType: "EXACT", value: "true" },
          },
        },
      }),
    }
  );
  return response.json();
}

// ─────────────────────────────────────────────
// Transform raw GA4 response → typed array
// ─────────────────────────────────────────────

export function transformGA4Response(rawReport: any, propertyId?: string): GA4CampaignData[] {
  if (!rawReport?.rows) return [];

  return rawReport.rows.map((row: any) => {
    const dims = row.dimensionValues.map((d: any) => d.value);
    const mets = row.metricValues.map((m: any) => parseFloat(m.value) || 0);

    const sessions = mets[0];
    const conversions = mets[4];

    return {
      campaignName: dims[0] || "(not set)",
      source: dims[1] || "",
      medium: dims[2] || "",
      sessions,
      bounceRate: mets[1],
      avgSessionDuration: mets[2],
      pagesPerSession: mets[3],
      conversions,
      revenue: mets[5],
      newUsers: mets[6],
      engagementRate: mets[8],
      conversionRate: sessions > 0 ? conversions / sessions : 0,
      propertyId,
    };
  });
}

export function transformConversionEvents(rawReport: any): GA4ConversionEvent[] {
  if (!rawReport?.rows) return [];

  return rawReport.rows.map((row: any) => {
    const dims = row.dimensionValues.map((d: any) => d.value);
    const mets = row.metricValues.map((m: any) => parseFloat(m.value) || 0);
    return {
      eventName: dims[0],
      campaignName: dims[1] || "(not set)",
      source: dims[2] || "",
      eventCount: mets[0],
      revenue: mets[1],
    };
  });
}

// ─────────────────────────────────────────────
// Matching: GA4 campaign names → Ad campaigns
// ─────────────────────────────────────────────

export function matchGA4ToCampaign(
  campaignName: string,
  campaignId: string,
  ga4Data: GA4CampaignData[]
): GA4CampaignData | null {
  // Strategy 1: Exact match on campaign name
  const exact = ga4Data.find(
    (g) => g.campaignName.toLowerCase() === campaignName.toLowerCase()
  );
  if (exact) return exact;

  // Strategy 2: Campaign ID in UTM
  const idMatch = ga4Data.find((g) => g.campaignName.includes(campaignId));
  if (idMatch) return idMatch;

  // Strategy 3: Partial / fuzzy match — first 15 chars
  const prefix = campaignName.toLowerCase().substring(0, 15);
  if (prefix.length >= 5) {
    const fuzzy = ga4Data.find((g) =>
      g.campaignName.toLowerCase().includes(prefix)
    );
    if (fuzzy) return fuzzy;
  }

  return null;
}

// ─────────────────────────────────────────────
// Helper: format duration (seconds → "m:ss")
// ─────────────────────────────────────────────

export function formatGA4Duration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
