// ============================================================
// Google Ads API Client — AdsCommand (Multi-Account)
// ============================================================

import { GoogleAdsApi } from "google-ads-api";
import { gatewayEnabled } from "./connect/gateway";
import { gatewayCustomerIdFor, loginCustomerIdFor } from "./connect/store";
import { companyIds } from "./companies/registry";
import { envFor } from "./companies";
import { gatewayGoogleCustomer, googleDevToken } from "./google-ads-client";

// ─────────────────────────────────────────────
// Patch Node.js built-in https.request to add "Accept-Encoding: identity"
// for all googleapis.com requests.
//
// Root cause: node-fetch v3 requests gzip encoding by default; Google's OAuth
// server sends a gzip-compressed response; the Gunzip decompression stream
// fails with ERR_STREAM_PREMATURE_CLOSE inside Coolify Docker containers.
//
// Fix: override Accept-Encoding to "identity" (no compression) so the
// response body is plain text and no Gunzip stream is needed.
//
// This patches at the Node.js built-in level — works regardless of webpack
// bundling, minification, or how gaxios/google-auth-library are loaded.
// ─────────────────────────────────────────────
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require("https") as typeof import("https");
  const _origRequest = https.request;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https as any).request = function patchedHttpsRequest(options: any, ...args: any[]) {
    const host: string =
      typeof options === "string"
        ? (() => { try { return new URL(options).hostname; } catch { return ""; } })()
        : (options?.hostname ?? options?.host ?? "");
    if (host.includes("googleapis.com") && typeof options === "object") {
      options = {
        ...options,
        headers: { ...(options.headers ?? {}), "accept-encoding": "identity" },
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_origRequest as any).apply(https, [options, ...args]);
  };
  console.log("[GoogleAds] https.request patched → identity encoding for googleapis.com");
}

// ─────────────────────────────────────────────
// Raw API Types
// ─────────────────────────────────────────────

export interface GoogleCampaignRaw {
  id: string;
  name: string;
  status: string;                  // ENABLED | PAUSED | REMOVED
  advertisingChannelType: string;  // SEARCH | DISPLAY | VIDEO | SHOPPING
  dailyBudgetMicros: number;
  startDate: string;               // YYYY-MM-DD
  endDate: string | null;
  accountId: string;               // customer ID this campaign belongs to
  accountName: string;             // human-readable account name
}

export interface GoogleInsightRaw {
  campaignId: string;
  campaignName: string;
  date: string;                    // YYYY-MM-DD  (segments.date)
  impressions: number;
  clicks: number;
  costMicros: number;
  ctr: number;
  averageCpcMicros: number;
  conversions: number;
  conversionsValue: number;
  accountId: string;
  accountName: string;
}

export interface GoogleSummaryRaw {
  impressions: number;
  clicks: number;
  costMicros: number;
  ctr: number;
  averageCpcMicros: number;
  conversions: number;
  conversionsValue: number;
}

export interface GoogleAccountBreakdown extends GoogleSummaryRaw {
  accountId: string;
  accountName: string;
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

/** Convert micros (Google's money unit) to dollars/VND. */
export function convertMicros(micros: number): number {
  return micros / 1_000_000;
}

function devLog(method: string, query: string) {
  if (process.env.NODE_ENV === "development") {
    console.log(`[GoogleAdsClient] ${method}:`, query.trim().split("\n")[0]);
  }
}
// Google Ads enums (API returns numbers not strings)

const CAMPAIGN_STATUS_MAP: Record<number, string> = { 1: 'UNSPECIFIED', 2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED' };

const CHANNEL_TYPE_MAP: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'SEARCH',
  3: 'DISPLAY',
  4: 'SHOPPING',
  5: 'HOTEL',
  6: 'VIDEO',
  7: 'MULTI_CHANNEL',
  8: 'LOCAL',
  9: 'SMART',
  10: 'PERFORMANCE_MAX',
  11: 'LOCAL_SERVICES',
  12: 'DISCOVERY',
  13: 'TRAVEL',
  14: 'DEMAND_GEN',
};

function resolveStatus(raw: unknown): string { if (typeof raw === 'number') return CAMPAIGN_STATUS_MAP[raw] ?? String(raw); return typeof raw === 'string' ? raw : ''; }

function resolveChannelType(raw: unknown): string { if (typeof raw === 'number') return CHANNEL_TYPE_MAP[raw] ?? String(raw); return typeof raw === 'string' ? raw : ''; }



/**

 * google-ads-api throws an object with a nested `errors` array, not a plain Error.
 * This helper extracts a readable message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGoogleError(err: unknown): string {
  if (err instanceof Error) return err.message;

  // google-ads-api error object shape
  const e = err as Record<string, unknown>;

  // Nested errors array
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = e.errors[0] as any;
    const msg = first?.message || first?.error_code || JSON.stringify(first);
    return `GoogleAdsError: ${msg}`;
  }

  // Direct message field
  if (typeof e.message === "string") return e.message;

  // Fallback
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ─────────────────────────────────────────────
// Account name mapping
// ─────────────────────────────────────────────

const ACCOUNT_NAMES: Record<string, string> = {
  "2275457986": "MIFI Active",
  "2190685994": "Mắt Bão - VND",
};

// ─────────────────────────────────────────────
// Module-level singleton Customer instances
// Prevents concurrent OAuth token refresh flood when multiple cron jobs fire at once.
// A single GoogleAdsApi + Customer instance per account shares the internal
// google-auth-library OAuth2Client → access token is cached and reused.
// ─────────────────────────────────────────────

let _apiInstance: GoogleAdsApi | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _customers = new Map<string, any>();
let _credKey = "";

// ─────────────────────────────────────────────
// GoogleAdsClient Class (Multi-Account)
// ─────────────────────────────────────────────

/** Kết quả lấy "số người dùng duy nhất" — tách rõ "không có số" khỏi "số bằng 0". */
export interface UniqueUsersResult {
  /** campaignId → số người dùng duy nhất. KHÔNG có khoá = Google không trả cho chiến dịch đó. */
  byCampaign: Map<string, number>;
  /** Lý do lấy hụt, để giao diện nói thật thay vì hiện 0. null = không có lỗi. */
  error: string | null;
}

class GoogleAdsClient {
  /** All configured customer IDs (filtered for truthy values). */
  get customerIds(): string[] {
    // Theo danh sách công ty của bản cài (bản Mắt Bão = MBC, MBI như cũ). Trước 26/10/2026 viết cứng MBC/MBI → bản cài
    // khách (công ty khác) không thấy tài khoản nào dù đã chọn (mini-spec GATEWAY-CONNECT-1, điểm B).
    if (gatewayEnabled()) return companyIds().map((id) => gatewayCustomerIdFor(id) ?? "").filter(Boolean);
    return companyIds().map((id) => envFor(id, "GOOGLE_ADS_CUSTOMER_ID")).filter(Boolean);
  }

  private get baseCredentials() {
    const clientId       = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret   = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = googleDevToken(); // 12/10: không còn bắt buộc (Google bỏ từ 09/2026) — xem lib/google-ads-client.ts
    const refreshToken   = process.env.GOOGLE_ADS_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Google Ads credentials not configured. " +
          "Set GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, " +
          "GOOGLE_ADS_REFRESH_TOKEN in .env.local."
      );
    }

    return { clientId, clientSecret, developerToken, refreshToken };
  }

  /** Return a cached Customer instance so the internal OAuth token is shared and not re-fetched per call. */
  private getCustomer(customerId: string) {
    // Chế độ cổng: token từ Cổng kết nối Mắt Bão, MCC theo từng tài khoản đã chọn (lib/connect/store.ts).
    if (gatewayEnabled()) return gatewayGoogleCustomer(customerId, loginCustomerIdFor(customerId));
    // Đợt 21 A4: khoá đổi (dán ở Cài đặt) → bỏ bộ đệm, tạo lại — có hiệu lực ngay, không cần khởi động lại.
    {
      const c = this.baseCredentials;
      const key = [c.clientId, c.clientSecret, c.developerToken, c.refreshToken, process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? ""].join("\u0000");
      if (key !== _credKey) { _credKey = key; _apiInstance = null; _customers.clear(); }
    }
    if (!_customers.has(customerId)) {
      const { clientId, clientSecret, developerToken, refreshToken } = this.baseCredentials;
      if (!_apiInstance) {
        _apiInstance = new GoogleAdsApi({
          client_id:       clientId,
          client_secret:   clientSecret,
          developer_token: developerToken as string, // undefined = không gửi header (đúng); "" bị Google từ chối
        });
      }
      const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId;
      _customers.set(customerId, _apiInstance.Customer({
        customer_id:        customerId,
        refresh_token:      refreshToken,
        login_customer_id:  loginCustomerId,
      }));
    }
    return _customers.get(customerId);
  }

  /** Resolve a human-readable name for a customer ID. */
  private accountName(customerId: string): string {
    return ACCOUNT_NAMES[customerId] || customerId;
  }

  // ── 1. Get campaigns (all accounts) ──
  async getCampaigns(): Promise<GoogleCampaignRaw[]> {
    const ids = this.customerIds;
    if (ids.length === 0) throw new Error("No Google Ads customer IDs configured.");

    const allCampaigns = await Promise.all(
      ids.map(customerId => this.fetchCampaignsForAccount(customerId))
    );
    return allCampaigns.flat();
  }

  /** Fetch campaigns for a single account. */
  private async fetchCampaignsForAccount(customerId: string): Promise<GoogleCampaignRaw[]> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `;

    devLog(`getCampaigns[${customerId}]`, query);

    try {
      const customer = this.getCustomer(customerId);
      const rows = await customer.query(query);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((row: any) => ({
        id:                     String(row.campaign?.id ?? ""),
        name:                   String(row.campaign?.name ?? ""),
        status:                 resolveStatus(row.campaign?.status),
        advertisingChannelType: resolveChannelType(row.campaign?.advertising_channel_type),
        dailyBudgetMicros:      Number(row.campaign_budget?.amount_micros ?? 0),
        // campaign.start_date/end_date are NOT recognized fields in this
        // API version (confirmed live 2026-07-29 — "Unrecognized fields in
        // the query" broke campaign sync account-wide). Reverted; "Thời
        // gian chạy" shows "—" for Google campaigns until a working field/
        // resource for this is found. DO NOT re-add these two fields here
        // without live-verifying against a real account first.
        startDate:              "",
        endDate:                null,
        accountId:              customerId,
        accountName:            this.accountName(customerId),
      }));
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleAdsClient] getCampaigns[${customerId}] error:`, message);
      throw new Error(`Google Ads getCampaigns[${customerId}] failed: ${message}`);
    }
  }

  // ── 2. Get campaign insights (all accounts, daily breakdown) ──
  async getCampaignInsights(dateRange: {
    from: string;
    to: string;
  }, includeRemoved = false): Promise<GoogleInsightRaw[]> {
    const ids = this.customerIds;
    if (ids.length === 0) throw new Error("No Google Ads customer IDs configured.");

    const allInsights = await Promise.all(
      ids.map(customerId => this.fetchInsightsForAccount(customerId, dateRange, includeRemoved))
    );
    return allInsights.flat();
  }

  /** Fetch daily insights for a single account. */
  private async fetchInsightsForAccount(
    customerId: string,
    dateRange: { from: string; to: string },
    includeRemoved = false,
  ): Promise<GoogleInsightRaw[]> {
    // includeRemoved=true: tính cả campaign đã REMOVED nhưng còn spend trong kỳ
    // (để tổng chi tiêu khớp Google Ads). Mặc định false giữ nguyên hành vi cũ.
    const statusFilter = includeRemoved ? "" : "AND campaign.status != 'REMOVED'";
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,
        segments.date
      FROM campaign
      WHERE segments.date BETWEEN '${dateRange.from}' AND '${dateRange.to}'
        ${statusFilter}
      ORDER BY segments.date
    `;

    devLog(`getCampaignInsights[${customerId}]`, query);

    try {
      const customer = this.getCustomer(customerId);
      const rows = await customer.query(query);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((row: any) => ({
        campaignId:       String(row.campaign?.id ?? ""),
        campaignName:     row.campaign?.name ?? "",
        date:             row.segments?.date ?? "",
        impressions:      Number(row.metrics?.impressions ?? 0),
        clicks:           Number(row.metrics?.clicks ?? 0),
        costMicros:       Number(row.metrics?.cost_micros ?? 0),
        ctr:              Number(row.metrics?.ctr ?? 0) * 100, // API returns 0–1 → %
        averageCpcMicros: Number(row.metrics?.average_cpc ?? 0),
        conversions:      Number(row.metrics?.conversions ?? 0),
        conversionsValue: Number(row.metrics?.conversions_value ?? 0),
        accountId:        customerId,
        accountName:      this.accountName(customerId),
      }));
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleAdsClient] getCampaignInsights[${customerId}] error:`, message);
      throw new Error(`Google Ads getCampaignInsights[${customerId}] failed: ${message}`);
    }
  }

  // ── 3. Get account summary (aggregated across all accounts) ──
  async getAccountSummary(dateRange: {
    from: string;
    to: string;
  }): Promise<GoogleSummaryRaw> {
    const breakdown = await this.getAccountBreakdown(dateRange);
    return this.mergeSummaries(breakdown);
  }

  // ── 4. Get per-account breakdown (NEW) ──
  async getAccountBreakdown(dateRange: {
    from: string;
    to: string;
  }): Promise<GoogleAccountBreakdown[]> {
    const ids = this.customerIds;
    if (ids.length === 0) throw new Error("No Google Ads customer IDs configured.");

    const results = await Promise.allSettled(
      ids.map(customerId => this.fetchSummaryForAccount(customerId, dateRange))
    );

    // Tài khoản nào lỗi thì GHI LẠI, không lặng lẽ biến mất. Bản cũ chỉ lọc
    // `fulfilled` rồi trả về — một tài khoản hỏng nghĩa là tổng chi tiêu Google
    // trên Dashboard THIẾU HẲN phần đó, mà giao diện vẫn báo thành công và
    // không có gì để người dùng nghi ngờ.
    this.lastBreakdownErrors = results
      .map((r, i) => ({ r, customerId: ids[i] }))
      .filter(x => x.r.status === "rejected")
      .map(x => {
        const reason = (x.r as PromiseRejectedResult).reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        console.error(`[GoogleAdsClient] getAccountBreakdown[${x.customerId}] failed:`, message);
        return { accountId: x.customerId, accountName: this.accountName(x.customerId), message };
      });

    return results
      .filter((r): r is PromiseFulfilledResult<GoogleAccountBreakdown> => r.status === "fulfilled")
      .map(r => r.value);
  }

  /**
   * Các tài khoản lấy hụt ở lần gọi getAccountBreakdown gần nhất.
   *
   * Để riêng thay vì đổi kiểu trả về của getAccountBreakdown, để không phải sửa
   * mọi nơi gọi cùng lúc — nơi nào cần cảnh báo thì đọc thêm trường này.
   */
  lastBreakdownErrors: Array<{ accountId: string; accountName: string; message: string }> = [];

  /** Fetch summary for a single account. */
  private async fetchSummaryForAccount(
    customerId: string,
    dateRange: { from: string; to: string }
  ): Promise<GoogleAccountBreakdown> {
    const query = `
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${dateRange.from}' AND '${dateRange.to}'
        AND campaign.status != 'REMOVED'
    `;

    devLog(`getAccountSummary[${customerId}]`, query);

    try {
      const customer = this.getCustomer(customerId);
      const rows = await customer.query(query);

      // Aggregate manually (GAQL doesn't support SUM without segments)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totals = (rows as any[]).reduce(
        (acc, row) => ({
          impressions:      acc.impressions      + Number(row.metrics?.impressions      ?? 0),
          clicks:           acc.clicks           + Number(row.metrics?.clicks           ?? 0),
          costMicros:       acc.costMicros       + Number(row.metrics?.cost_micros      ?? 0),
          conversions:      acc.conversions      + Number(row.metrics?.conversions      ?? 0),
          conversionsValue: acc.conversionsValue + Number(row.metrics?.conversions_value ?? 0),
        }),
        { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionsValue: 0 }
      );

      const ctr = totals.impressions > 0
        ? (totals.clicks / totals.impressions) * 100
        : 0;
      const avgCpcMicros = totals.clicks > 0
        ? totals.costMicros / totals.clicks
        : 0;

      return {
        accountId:        customerId,
        accountName:      this.accountName(customerId),
        impressions:      totals.impressions,
        clicks:           totals.clicks,
        costMicros:       totals.costMicros,
        ctr,
        averageCpcMicros: avgCpcMicros,
        conversions:      totals.conversions,
        conversionsValue: totals.conversionsValue,
      };
    } catch (err: unknown) {
      const message = extractGoogleError(err);
      console.error(`[GoogleAdsClient] getAccountSummary[${customerId}] error:`, message);
      throw new Error(`Google Ads getAccountSummary[${customerId}] failed: ${message}`);
    }
  }

  /** Merge multiple account summaries into one aggregate. */
  private mergeSummaries(summaries: GoogleSummaryRaw[]): GoogleSummaryRaw {
    if (summaries.length === 0) {
      return {
        impressions: 0, clicks: 0, costMicros: 0, ctr: 0,
        averageCpcMicros: 0, conversions: 0, conversionsValue: 0,
      };
    }

    const merged = summaries.reduce(
      (acc, s) => ({
        impressions:      acc.impressions      + s.impressions,
        clicks:           acc.clicks           + s.clicks,
        costMicros:       acc.costMicros       + s.costMicros,
        conversions:      acc.conversions      + s.conversions,
        conversionsValue: acc.conversionsValue + s.conversionsValue,
      }),
      { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionsValue: 0 }
    );

    const ctr = merged.impressions > 0
      ? (merged.clicks / merged.impressions) * 100
      : 0;
    const avgCpcMicros = merged.clicks > 0
      ? merged.costMicros / merged.clicks
      : 0;

    return {
      impressions:      merged.impressions,
      clicks:           merged.clicks,
      costMicros:       merged.costMicros,
      ctr,
      averageCpcMicros: avgCpcMicros,
      conversions:      merged.conversions,
      conversionsValue: merged.conversionsValue,
    };
  }

  // ── 5. Unique users (reach) theo campaign ──
  //
  // TÁCH HẲN khỏi getCampaignInsights CÓ CHỦ Ý. metrics.unique_users là chỉ số
  // "reach", Google chỉ trả cho một số loại chiến dịch (Video/Display) và có
  // ràng buộc riêng về khoảng ngày. Nhét nó vào truy vấn insights chính nghĩa
  // là: Google từ chối một field → CẢ bảng campaign trắng. Đúng chuyện đã xảy
  // ra ngày 2026-07-29 với campaign.start_date/end_date, hỏng đồng bộ toàn tài
  // khoản (xem ghi chú ở fetchCampaignsForAccount).
  //
  // Nên hàm này KHÔNG BAO GIỜ ném lỗi: hỏng thì trả map rỗng kèm lý do, cột
  // trên giao diện hiện "—" và nói được vì sao. Chi phí tối đa của việc hỏng
  // là mất đúng một cột.
  async getUniqueUsersByCampaign(dateRange: { from: string; to: string }): Promise<UniqueUsersResult> {
    const ids = this.customerIds;
    if (ids.length === 0) {
      return { byCampaign: new Map(), error: "Chưa cấu hình tài khoản Google Ads." };
    }

    // Google giới hạn chỉ số reach trong ~92 ngày gần nhất. Gọi ngoài khoảng đó
    // chắc chắn hỏng, nên chặn trước cho đỡ một vòng API và báo đúng lý do.
    const daysAgo = Math.floor((Date.now() - new Date(`${dateRange.from}T00:00:00Z`).getTime()) / 86_400_000);
    if (!Number.isFinite(daysAgo)) {
      return { byCampaign: new Map(), error: "Khoảng ngày không hợp lệ." };
    }
    if (daysAgo > 92) {
      return { byCampaign: new Map(), error: "Google chỉ trả số người dùng duy nhất trong vòng 92 ngày gần nhất." };
    }

    const query = `
      SELECT
        campaign.id,
        metrics.unique_users
      FROM campaign
      WHERE segments.date BETWEEN '${dateRange.from}' AND '${dateRange.to}'
        AND campaign.status != 'REMOVED'
    `;

    devLog("getUniqueUsersByCampaign", query);

    const byCampaign = new Map<string, number>();
    const errors: string[] = [];

    await Promise.all(ids.map(async (customerId) => {
      try {
        const customer = this.getCustomer(customerId);
        const rows = await customer.query(query);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const row of rows as any[]) {
          const id = String(row.campaign?.id ?? "");
          const raw = row.metrics?.unique_users;
          // Chỉ ghi nhận khi Google THỰC SỰ trả số. Thiếu field (chiến dịch
          // Search/PMax) phải để trống, không được hạ thành 0 — 0 người dùng
          // và "không đo được" là hai chuyện khác hẳn nhau.
          if (id && raw !== null && raw !== undefined) {
            byCampaign.set(id, Number(raw));
          }
        }
      } catch (err: unknown) {
        const message = extractGoogleError(err);
        console.error(`[GoogleAdsClient] getUniqueUsersByCampaign[${customerId}] error:`, message);
        errors.push(`${this.accountName(customerId)}: ${message}`);
      }
    }));

    return {
      byCampaign,
      error: errors.length > 0 ? errors.join(" | ") : null,
    };
  }
}

// ─────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────
export const googleAdsClient = new GoogleAdsClient();
