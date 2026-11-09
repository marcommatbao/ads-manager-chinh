// ============================================================
// NBA — campaign gather (server-side, no HTTP/auth)
// Gọi trực tiếp meta-client + google-client và merge metrics
// per-campaign → Campaign[] đầy đủ. Dùng chung cho API route + cron.
// (Lưu ý: /api/meta KHÔNG có metrics per-campaign, nên không tái dùng được.)
// ============================================================

import { metaClient, graphFetch, isMetaRateLimitError, noteMetaRateLimit, isMetaTransientInsightError, describeMetaError, type MetaInsightRaw } from "@/lib/meta-client";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import { detectCompany } from "@/lib/company-detect";
import type { Campaign, CampaignMetrics } from "@/types/ads.types";
import { promises as fsPromises } from "fs";
import path from "path";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { isNotConfigured } from "@/lib/not-configured";

// ── Đếm chuyển đổi của Meta: CHỈ lấy tên TRẦN, tuyệt đối không thêm namespace ──
//
// Meta trả CÙNG MỘT sự kiện dưới nhiều tên khác nhau. Đo trên tài khoản thật
// ngày 19/09/2026 (82 campaign, 30 ngày):
//
//     purchase                               3.959
//     offsite_conversion.fb_pixel_purchase   3.959   ← cùng 3.959 lượt mua đó
//     omni_purchase                          3.959   ← vẫn là nó
//     onsite_web_purchase                    3.959
//     web_in_store_purchase                  3.959
//     offsite_purchase_add_20_s_calls        3.959
//
// Cộng thêm các bản có namespace là ĐẾM ĐÔI, không phải "đếm đủ hơn". Đo
// được: cộng hết mọi biến thể thì +79.284 so với 3.967 — thổi phồng ~20 lần.
//
// ĐÃ CÓ NGƯỜI ĐỊNH "SỬA" CHỖ NÀY. Lý do nghe rất hợp lý: các tệp khác trong
// repo (dashboard/unified, improvements) dùng "offsite_conversion.fb_pixel_purchase",
// nên trông như gather.ts đang khớp thiếu. Nhưng hai chỗ đó lọc THEO PIXEL cụ
// thể cho mục đích khác; ở đây cần TỔNG chuyển đổi của campaign, và tên trần
// đã là tổng rồi. Đo trước khi sửa: bộ lọc hiện tại và bộ lọc "đã sửa" cho ra
// ĐÚNG CÙNG MỘT SỐ (3.967), tức không hề thiếu.
//
// Bỏ "offsite_conversion" khỏi danh sách: chuỗi trần đó KHÔNG BAO GIỜ xuất
// hiện trong dữ liệu thật (Meta luôn kèm hậu tố), nên nó là mục chết — giữ lại
// chỉ khiến người đọc sau tưởng namespace có được xử lý.
const CONV_ACTIONS = ["purchase", "lead", "complete_registration"];
const REV_ACTIONS = ["purchase"];

function defaultRange(): { from: string; to: string } {
  return {
    from: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  };
}

function metaMetrics(raw: MetaInsightRaw): CampaignMetrics {
  // reach/frequency có trong response (INSIGHT_FIELDS) nhưng không có trên type MetaInsightRaw.
  const extra = raw as MetaInsightRaw & { reach?: string; frequency?: string };
  const spend = parseFloat(raw.spend ?? "0");
  const conversions = raw.actions
    ?.filter(a => CONV_ACTIONS.includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value), 0) ?? 0;
  const revenue = raw.action_values
    ?.filter(a => REV_ACTIONS.includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value), 0) ?? 0;
  return {
    impressions: parseInt(raw.impressions ?? "0", 10),
    clicks: parseInt(raw.clicks ?? "0", 10),
    spend,
    ctr: parseFloat(raw.ctr ?? "0"),
    cpc: parseFloat(raw.cpc ?? "0"),
    cpm: parseFloat(raw.cpm ?? "0"),
    roas: spend > 0 ? revenue / spend : 0,
    conversions,
    revenue,
    reach: extra.reach ? parseInt(extra.reach, 10) : undefined,
    frequency: extra.frequency ? parseFloat(extra.frequency) : undefined,
  };
}

const META_BASE = META_GRAPH_BASE;

/**
 * Insight cấp tài khoản, level=campaign — 1 (vài) call có phân trang, lấy
 * spend + metrics của TẤT CẢ campaign (thay vì 488 call lẻ). Tránh sót & chậm.
 */
type MetaInsightWithName = MetaInsightRaw & { campaign_name?: string };

/** Lỗi gần nhất của lần lấy insight Meta — dùng để phân biệt "chi 0đ thật" với
 *  "không lấy được số". Meta trả `Application request limit reached` khi vượt
 *  hạn mức gọi API; trước đây chỗ này chỉ warn rồi break, nên map rỗng và mọi
 *  campaign nhận spend = 0 — màn hình hiện "0đ" y như một phép đo thật. */
// KHÔNG dùng biến cấp module cho hai giá trị này nữa. Chúng sống qua các lần
// gọi trong cùng tiến trình server: khi `metaClient.getCampaigns()` NÉM lỗi
// (đúng lúc Meta chặn vì hạn mức), hàm đặt lại chúng không hề chạy, nên
// `lastMetaStaleAt` giữ mốc giờ của MỘT LẦN GỌI KHÁC. Hậu quả đúng như màn
// hình đang hiện: chi phí Facebook 0đ, dán nhãn "số cũ" kèm câu trấn an "con
// số vẫn đúng tại thời điểm đó", còn lỗi hạn mức thật thì bị nuốt bởi
// `metaError: staleAt ? null : fb.error` và tổng chi phí không được đánh dấu
// là THIẾU. Hai lần gọi song song cũng ghi đè lẫn nhau.
//
// Nay trả kèm kết quả, không ai đọc được trạng thái của lần gọi khác.
interface MetaInsightsOutcome {
  byId: Map<string, MetaInsightWithName>;
  error: string | null;
  /** Có giá trị = số đang dùng là số CŨ đọc lúc này. */
  staleAt: string | null;
}

// ── Kho số cũ trên đĩa ──────────────────────────────────────────────────────
// Ở bậc `development_access` (trần ~60 lượt gọi/giờ) việc bị chặn là chuyện
// THƯỜNG XUYÊN, không phải sự cố hiếm. Khi bị chặn, card P&L trước đây hiện
// "Không lấy được chi phí Facebook" và ô chi phí để trống — trong khi chi tiêu
// Facebook của một THÁNG gần như không đổi giữa hai lần xem.
//
// Giữ lần đọc thành công gần nhất trên đĩa (đĩa chứ không phải RAM: container
// khởi động lại là mất sạch bộ nhớ, mà mỗi lần deploy là một lần khởi động
// lại). Bị chặn thì trả số cũ KÈM MỐC THỜI GIAN, để người đọc biết đây là số
// lúc mấy giờ — khác hẳn việc lặng lẽ đưa ra một con số cũ như thể nó mới.
const INSIGHTS_CACHE_FILE = path.join(process.cwd(), "data", "meta-insights-cache.json");

interface InsightsCacheEntry { at: string; rows: Array<MetaInsightWithName & { campaign_id: string }> }

async function readInsightsCache(key: string): Promise<InsightsCacheEntry | null> {
  try {
    const all = JSON.parse(await fsPromises.readFile(INSIGHTS_CACHE_FILE, "utf-8")) as Record<string, InsightsCacheEntry>;
    return all[key] ?? null;
  } catch {
    return null;
  }
}

async function writeInsightsCache(key: string, rows: Array<MetaInsightWithName & { campaign_id: string }>): Promise<void> {
  try {
    let all: Record<string, InsightsCacheEntry> = {};
    try {
      all = JSON.parse(await fsPromises.readFile(INSIGHTS_CACHE_FILE, "utf-8")) as Record<string, InsightsCacheEntry>;
    } catch { /* chưa có tệp — bắt đầu từ rỗng */ }
    all[key] = { at: new Date().toISOString(), rows };
    // Giữ 12 khoảng ngày gần nhất là đủ (tháng này, tháng trước, vài tuần) —
    // không để tệp phình theo mỗi khoảng ngày người dùng từng bấm.
    const keys = Object.keys(all);
    if (keys.length > 12) {
      const sorted = keys.sort((a, b) => (all[a].at < all[b].at ? -1 : 1));
      for (const k of sorted.slice(0, keys.length - 12)) delete all[k];
    }
    await fsPromises.mkdir(path.dirname(INSIGHTS_CACHE_FILE), { recursive: true });
    await fsPromises.writeFile(INSIGHTS_CACHE_FILE, JSON.stringify(all), "utf-8");
  } catch {
    // Ghi hỏng thì thôi — không được làm hỏng lời gọi vì chuyện lưu đệm.
  }
}

async function accountCampaignInsights(range: { from: string; to: string }): Promise<MetaInsightsOutcome> {
  let insightError: string | null = null;
  let staleAt: string | null = null;
  const out = new Map<string, MetaInsightWithName>();
  const token = process.env.META_ACCESS_TOKEN;
  const acct = process.env.META_AD_ACCOUNT_ID;
  if (!token || !acct) return { byId: out, error: null, staleAt: null };

  const cacheKey = `${acct}|${range.from}|${range.to}`;

  // Dùng đệm đĩa TRƯỚC khi gọi Meta, không chỉ khi đã bị chặn.
  // Bản cũ gọi Meta ở MỌI lần mở trang rồi mới lấy đệm ra khi hỏng — tức là
  // luôn tiêu hạn mức trước, đệm chỉ để chữa cháy. Với trần ~60 lượt/giờ của
  // bậc DEVELOPMENT ACCESS thì vài lần tải trang là hết. Số của Meta vốn đã
  // trễ vài giờ nên đệm vài phút không làm sai lệch gì đáng kể.
  const FRESH_MS = Number(process.env.META_INSIGHTS_DISK_FRESH_MS ?? 600_000);
  const preCached = await readInsightsCache(cacheKey);
  if (preCached?.rows?.length && Date.now() - Date.parse(preCached.at) < FRESH_MS) {
    for (const row of preCached.rows) out.set(row.campaign_id, row);
    // KHÔNG đánh dấu "số cũ": còn trong hạn tươi thì đây đúng là số Meta sẽ
    // trả về nếu gọi lại. Dán nhãn cũ ở đây sẽ làm nhãn đó mất ý nghĩa đúng
    // lúc cần nó nhất — khi thật sự bị chặn.
    return { byId: out, error: null, staleAt: null };
  }

  const fetched: Array<MetaInsightWithName & { campaign_id: string }> = [];

  const fields = "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values";
  const tr = encodeURIComponent(JSON.stringify({ since: range.from, until: range.to }));
  let url: string | undefined =
    `${META_BASE}/act_${acct}/insights?level=campaign&fields=${fields}&time_range=${tr}&limit=500&access_token=${token}`;

  for (let page = 0; page < 20 && url; page++) {
    // graphFetch: đọc header hạn mức của Meta và tôn trọng thời gian nghỉ nếu
    // một đường gọi khác vừa bị chặn — đây là đường nuôi số cho card P&L nên
    // nó phải biết chuyện đang xảy ra ở phần còn lại của app.
    type InsightPayload = {
      data?: Array<MetaInsightWithName & { campaign_id: string }>;
      paging?: { next?: string };
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
    };

    // Thử lại có giãn cách cho nhóm "Meta quá tải / hết giờ chờ" (code 2,
    // subcode 1504018…). Đây là vòng lặp THỨ BA trong app tự gọi insights rồi
    // ném ngay lỗi đầu tiên; hai vòng kia ở lib/meta-client.ts đã được sửa,
    // còn vòng này thì chưa — nên hôm 11/09/2026 card P&L vẫn nhận nguyên văn
    // "Service temporarily unavailable" trong khi trang Nội dung quảng cáo đã
    // hết lỗi. Lỗi thiếu quyền / hạn mức vẫn thoát ngay, thử lại vô nghĩa.
    let data: InsightPayload | null = null;
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await graphFetch(url, { signal: AbortSignal.timeout(20_000) });
      data = (await res.json()) as InsightPayload;
      if (!data.error) break;
      if (isMetaTransientInsightError(data.error) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      break;
    }

    if (!data || data.error) {
      const err = data?.error;
      const raw = err?.message ?? "Meta API error";
      // Bị chặn vì hạn mức thì nói rõ là hạn mức (và bao giờ thử lại), đồng
      // thời bật thời gian nghỉ chung để cả app thôi gọi thêm cho nặng hơn.
      // Các lỗi còn lại đi qua describeMetaError để người đọc biết PHẢI LÀM GÌ
      // thay vì nhận nguyên văn chữ Meta.
      insightError = err && isMetaRateLimitError(err)
        ? noteMetaRateLimit(raw, err as unknown as Record<string, unknown>)
        : describeMetaError(raw, err?.code);
      console.warn(`[nba/gather] meta insights error: code=${err?.code ?? "?"} subcode=${err?.error_subcode ?? "?"} — ${raw}`);
      break;
    }
    for (const row of data.data ?? []) {
      if (!row.campaign_id) continue;
      out.set(row.campaign_id, row);
      fetched.push(row);
    }
    url = data.paging?.next;
  }

  if (insightError) {
    // Bị chặn → dùng lần đọc thành công gần nhất thay vì trả rỗng. Trả rỗng
    // nghĩa là card P&L hiện chi phí trống, đọc thành "tháng này chưa chi đồng
    // Facebook nào" — sai hẳn về nghiệp vụ. Số cũ KÈM mốc giờ thì đọc đúng.
    const cached = await readInsightsCache(cacheKey);
    if (cached?.rows?.length) {
      for (const row of cached.rows) out.set(row.campaign_id, row);
      staleAt = cached.at;
    }
    return { byId: out, error: insightError, staleAt };
  }

  if (fetched.length > 0) await writeInsightsCache(cacheKey, fetched);
  return { byId: out, error: null, staleAt: null };
}

interface GatherOutcome { campaigns: Campaign[]; error: string | null; staleAt?: string | null }

async function gatherMeta(range: { from: string; to: string }): Promise<GatherOutcome> {
  try {
    // limit 500 để lấy hết campaign (mặc định client là 50 → sót!)
    const raw = await metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED"], limit: 500 });
    if (!raw.length) return { campaigns: [], error: null };
    const insights = await accountCampaignInsights(range);
    const byId = insights.byId;

    const result: Campaign[] = raw.map((c): Campaign => {
      const ins = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        platform: "facebook",
        company: detectCompany(c.name),
        status: c.status === "ACTIVE" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED",
        objective: c.objective ?? "",
        dailyBudget: parseInt(c.daily_budget ?? "0", 10),
        totalBudget: parseInt(c.lifetime_budget ?? "0", 10),
        startDate: c.start_time?.split("T")[0] ?? range.from,
        endDate: c.stop_time ? c.stop_time.split("T")[0] : null,
        metrics: ins
          ? metaMetrics(ins)
          : { impressions: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0, roas: 0, conversions: 0, revenue: 0 },
      };
    });

    // ── Campaign có spend trong kỳ nhưng KHÔNG nằm trong list ACTIVE/PAUSED
    //    (đã ARCHIVED/DELETED) → vẫn phải tính để tổng khớp chi tiêu thật của
    //    tài khoản. Tên lấy từ insight (campaign_name). ──
    const rawIds = new Set(raw.map(c => c.id));
    for (const [id, ins] of byId) {
      if (rawIds.has(id)) continue;
      const spend = parseFloat(ins.spend ?? "0");
      if (spend <= 0) continue;
      const name = ins.campaign_name ?? "";
      result.push({
        id,
        name,
        platform: "facebook",
        company: detectCompany(name),
        status: "ARCHIVED",
        objective: "",
        dailyBudget: 0,
        totalBudget: 0,
        startDate: range.from,
        endDate: null,
        metrics: metaMetrics(ins),
      });
    }

    return { campaigns: result, error: insights.error, staleAt: insights.staleAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isNotConfigured(msg)) console.warn("[nba/gather] meta failed:", msg);
    // staleAt PHẢI là null ở đây: không lấy được campaign nào thì không có số
    // cũ nào đang được dùng. Bản trước để trạng thái cấp module rớt lại từ lần
    // gọi khác, nên nhánh này lặng lẽ biến thành "số cũ 0đ".
    return { campaigns: [], error: msg, staleAt: null };
  }
}

async function gatherGoogle(range: { from: string; to: string }): Promise<GatherOutcome> {
  try {
    const [raw, insights] = await Promise.all([
      googleAdsClient.getCampaigns(),
      // includeRemoved=true → tính cả campaign đã REMOVED còn spend trong kỳ
      googleAdsClient.getCampaignInsights(range, true),
    ]);

    // Gộp insight (daily rows) theo campaignId 1 lần — O(n) thay vì O(raw*insights)
    const byCampaign = new Map<string, {
      impressions: number; clicks: number; costMicros: number;
      conversions: number; revenue: number; name: string; accountId: string; accountName: string;
    }>();
    for (const i of insights) {
      const e = byCampaign.get(i.campaignId) ?? {
        impressions: 0, clicks: 0, costMicros: 0, conversions: 0, revenue: 0,
        name: i.campaignName, accountId: i.accountId, accountName: i.accountName,
      };
      e.impressions += i.impressions;
      e.clicks      += i.clicks;
      e.costMicros  += i.costMicros;
      e.conversions += i.conversions;
      e.revenue     += i.conversionsValue;
      byCampaign.set(i.campaignId, e);
    }

    const toMetrics = (agg: { impressions: number; clicks: number; costMicros: number; conversions: number; revenue: number }) => {
      const spend = convertMicros(agg.costMicros);
      return {
        impressions: agg.impressions,
        clicks: agg.clicks,
        spend,
        ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
        cpc: agg.clicks > 0 ? spend / agg.clicks : 0,
        cpm: agg.impressions > 0 ? (spend / agg.impressions) * 1000 : 0,
        roas: spend > 0 ? Math.round((agg.revenue / spend) * 100) / 100 : 0,
        conversions: agg.conversions,
        revenue: agg.revenue,
      };
    };

    const result: Campaign[] = raw.map((c): Campaign => {
      const agg = byCampaign.get(c.id) ?? { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, revenue: 0 };
      return {
        id: c.id,
        name: c.name,
        platform: "google",
        company: detectCompany(c.name, c.accountName, c.accountId),
        accountId: c.accountId,
        accountName: c.accountName,
        status: c.status === "ENABLED" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED",
        objective: c.advertisingChannelType ?? "",
        dailyBudget: convertMicros(c.dailyBudgetMicros),
        totalBudget: 0,
        startDate: c.startDate ?? range.from,
        endDate: c.endDate ?? null,
        metrics: toMetrics(agg),
      };
    });

    // ── Campaign có spend nhưng KHÔNG nằm trong list hiện tại (đã REMOVED) →
    //    bổ sung để tổng khớp chi tiêu thật của Google Ads. ──
    const rawIds = new Set(raw.map(c => c.id));
    for (const [id, agg] of byCampaign) {
      if (rawIds.has(id)) continue;
      if (convertMicros(agg.costMicros) <= 0) continue;
      result.push({
        id,
        name: agg.name,
        platform: "google",
        company: detectCompany(agg.name, agg.accountName, agg.accountId),
        accountId: agg.accountId,
        accountName: agg.accountName,
        status: "ARCHIVED",
        objective: "",
        dailyBudget: 0,
        totalBudget: 0,
        startDate: range.from,
        endDate: null,
        metrics: toMetrics(agg),
      });
    }

    return { campaigns: result, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isNotConfigured(msg)) console.warn("[nba/gather] google failed:", msg);
    return { campaigns: [], error: msg };
  }
}

/** Lấy toàn bộ campaign (Meta + Google) đã chuẩn hoá + có metrics thật. */
export async function gatherCampaigns(range?: { from: string; to: string }): Promise<Campaign[]> {
  return (await gatherCampaignsWithStatus(range)).campaigns;
}

export interface GatherStatus {
  campaigns: Campaign[];
  /** Có giá trị khi KHÔNG lấy được số của nền tảng đó — người gọi phải hiển thị
   *  "không lấy được" thay vì 0đ. `[]` + error = null mới là "thật sự 0". */
  metaError: string | null;
  googleError: string | null;
  /** Có giá trị = số Meta đang dùng là số CŨ đọc lúc này (bị chặn nên lấy từ
   *  đệm đĩa). Số vẫn ĐÚNG, chỉ là không mới — hiển thị kèm mốc giờ, đừng báo
   *  lỗi như thể không có số. */
  metaStaleAt: string | null;
}

/** Như gatherCampaigns nhưng nói rõ nền tảng nào lấy hụt số. */
export async function gatherCampaignsWithStatus(range?: { from: string; to: string }): Promise<GatherStatus> {
  const r = range ?? defaultRange();
  const [fb, gg] = await Promise.all([gatherMeta(r), gatherGoogle(r)]);
  const staleAt = fb.staleAt ?? null;
  return {
    campaigns: [...fb.campaigns, ...gg.campaigns],
    // Dùng được số cũ thì KHÔNG còn là lỗi — nuốt error đi và báo "số cũ" thay
    // vào. Giữ cả hai thì UI hiện đồng thời một con số và một câu "không lấy
    // được", tự mâu thuẫn.
    // Chỉ coi là "số cũ dùng được" khi THẬT SỰ có campaign Facebook lấy ra
    // được. Có mốc giờ mà không có campaign nào nghĩa là chẳng có số nào để
    // dùng — lúc đó phải báo lỗi, không phải dán nhãn "số cũ" lên con số 0.
    metaError: staleAt && fb.campaigns.length > 0 ? null : fb.error,
    googleError: gg.error,
    metaStaleAt: fb.campaigns.length > 0 ? staleAt : null,
  };
}
