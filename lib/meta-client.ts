// ============================================================
// Meta (Facebook) Marketing API Client — AdsCommand
// ============================================================

import { log } from "@/lib/logger";
import { pixelOptions } from "@/lib/meta-accounts";
import { promises as fsPromises } from "fs";
import path from "path";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const BASE_URL = META_GRAPH_BASE;
const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 500;

// ─────────────────────────────────────────────
// Raw API Types
// ─────────────────────────────────────────────

export interface MetaCampaignRaw {
  id: string;
  name: string;
  status: string;
  /** Trạng thái Meta THẬT SỰ áp cho chiến dịch: ACTIVE, PAUSED, DISAPPROVED,
   *  WITH_ISSUES, PENDING_REVIEW, ADSET_PAUSED, IN_PROCESS… Khác `status` (chỉ
   *  là công tắc người dùng bật/tắt). Đây là nơi DUY NHẤT biết được chiến dịch
   *  có bị từ chối hay không — đừng suy ra từ "0 impression". */
  effective_status: string;
  objective: string;
  daily_budget: string;     // cents as string
  lifetime_budget: string;  // cents as string
  start_time: string;       // ISO
  stop_time: string | null;
  created_time: string;
}

export interface MetaInsightRaw {
  campaign_id: string;
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
  cpc: string;
  cpm: string;
  // Requested via INSIGHT_FIELDS below — always present in the real Graph
  // API response, just previously missing from this type (which caused
  // campaigns/compare/route.ts to hardcode reach/frequency to 0 instead of
  // reading real values that were already in the payload).
  reach: string;
  frequency: string;
  actions: Array<{ action_type: string; value: string }> | null;
  action_values: Array<{ action_type: string; value: string }> | null;
  cost_per_action_type: Array<{ action_type: string; value: string }> | null;
  date_start: string;
}

export interface MetaAccountInsightRaw extends MetaInsightRaw {
  date_stop: string;
}

/** Exactly the fields getCampaignInsightsForAccount() asks Meta for — not
 *  MetaInsightRaw, which promises ctr/cpc/reach/frequency this call does not
 *  request. */
export interface MetaCampaignInsightRaw {
  campaign_id: string;
  campaign_name: string;
  spend: string;
  impressions: string;
  clicks: string;
  actions: Array<{ action_type: string; value: string }> | null;
  action_values: Array<{ action_type: string; value: string }> | null;
}

// ── Ad-set-level targeting (Audience Overlap proxy) ──

export interface MetaAdSetTargetingRaw {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign?: { name?: string };
  daily_budget?: string;
  targeting?: {
    geo_locations?: { countries?: string[]; regions?: Array<{ key: string }>; cities?: Array<{ key: string }> };
    flexible_spec?: Array<{
      interests?: Array<{ id: string; name: string }>;
      behaviors?: Array<{ id: string; name: string }>;
    }>;
    custom_audiences?: Array<{ id: string }>;
    age_min?: number;
    age_max?: number;
    genders?: number[];
  };
}

// ── Ad-level (Ads Content) ──

export interface MetaAdInsightRaw {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  // Video engagement — action-list shaped like `actions`, only present on
  // video creatives. Absent/empty on image ads (nothing to sum).
  video_p25_watched_actions?: Array<{ action_type: string; value: string }>;
  video_thruplay_watched_actions?: Array<{ action_type: string; value: string }>;
  date_start: string;
  date_stop: string;
}

export interface MetaAdCreativeRaw {
  id?: string;
  name?: string;
  thumbnail_url?: string;
  image_url?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
  object_story_spec?: {
    link_data?: {
      message?: string;
      name?: string;
      description?: string;
      call_to_action?: { type?: string };
      link?: string;
      picture?: string;
      image_hash?: string;
    };
    video_data?: {
      message?: string;
      title?: string;
      call_to_action?: { type?: string };
      image_url?: string;
    };
  };
}

export interface MetaAdRaw {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  adset_id: string;
  creative?: MetaAdCreativeRaw;
}

// ── Ad-set optimization goal (which `actions[].action_type` = "Kết quả") ──

export interface MetaAdSetGoalRaw {
  id: string;
  campaign_id: string;
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string; pixel_id?: string };
}

// ─────────────────────────────────────────────
// Shared field list for insights
// ─────────────────────────────────────────────

const INSIGHT_FIELDS = [
  "impressions",
  "clicks",
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
  "actions",
  "action_values",
  "cost_per_action_type",
] as const;

// ─────────────────────────────────────────────
// Hạn mức gọi API của Meta — nhìn thấy được, và không tự đâm đầu vào
// ─────────────────────────────────────────────
// Meta tính hạn mức theo APP ID (mọi công cụ dùng chung một App thì dùng chung
// hạn mức) và trả mức đã dùng trong header `x-app-usage` của MỌI phản hồi, kể
// cả phản hồi thành công. Trước đây file này vứt header đó đi, nên lúc bị chặn
// người dùng chỉ nhận đúng một câu "Application request limit reached": không
// biết đang ở mức bao nhiêu, không biết bao giờ hết, không có gì để chẩn đoán.

export interface MetaUsageSnapshot {
  /** % hạn mức đã dùng (0–100), theo cách Meta tự chấm. */
  callCount: number;
  totalCputime: number;
  totalTime: number;
  at: string;
  /** Xô nào đang căng nhất: "app" | "ad_account" | "buc:<type>". Meta có NHIỀU
   *  hạn mức song song; đọc mỗi `x-app-usage` rồi kết luận "mới dùng 2%" là đo
   *  nhầm xô — xô chặn thật thường là Business Use Case của Marketing API. */
  worstBucket: string;
  worstPct: number;
  /** Meta tự nói bao nhiêu phút nữa mới gọi lại được (chỉ có ở xô BUC). */
  minutesToRegain: number | null;
}

let lastUsage: MetaUsageSnapshot | null = null;
let lastUsageLoggedAt = 0;
let throttledUntil = 0;
let throttleReason = "";

/** Nhịp ghi mức hạn mức vào log. Không ghi mọi lượt (ồn), không chỉ ghi lúc đã
 *  quá tay (thì chỉ biết khi đã muộn) — ghi đều đặn để còn dựng được đường
 *  cong "app này tiêu hạn mức nhanh cỡ nào". Đọc bằng log container. */
const USAGE_LOG_EVERY_MS = 5 * 60 * 1000;

/** Mã lỗi nghĩa là "bị chặn vì gọi quá nhiều" — khác hẳn lỗi dữ liệu/quyền. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014]);
const RATE_LIMIT_HINTS = ["request limit reached", "rate limit", "too many calls", "reduce the amount of data"];
/** Đã bị chặn thì nghỉ hẳn: gọi tiếp chỉ làm cửa sổ hạn mức trượt dài thêm. */
const THROTTLE_COOLDOWN_MS = 10 * 60 * 1000;

export function readMetaUsage(): MetaUsageSnapshot | null {
  return lastUsage;
}

export function getMetaThrottleState(): {
  throttled: boolean;
  untilIso: string | null;
  reason: string;
  usage: MetaUsageSnapshot | null;
} {
  const throttled = Date.now() < throttledUntil;
  return {
    throttled,
    untilIso: throttled ? new Date(throttledUntil).toISOString() : null,
    reason: throttled ? throttleReason : "",
    usage: lastUsage,
  };
}

/** Header hạn mức thô của lượt gọi gần nhất — để in nguyên văn vào log khi bị
 *  chặn. Chẩn đoán bằng số Meta nói, không bằng suy đoán. */
let lastRawUsageHeaders: Record<string, string> = {};

/** Ghi lỗi bị chặn xuống đĩa: mỗi lần deploy là container khởi động lại và mọi
 *  biến trong tiến trình về rỗng — đúng thứ vừa xảy ra, nên lần chặn lúc 10:57
 *  không còn dấu vết nào để đọc mã phụ. Lỗi này thưa và không đoán trước được,
 *  bỏ lỡ một lần là phải chờ lần sau. */
const RATE_LIMIT_FILE = path.join(process.cwd(), "data", "meta-rate-limit-last.json");

function persistRateLimitError(payload: Record<string, unknown>): void {
  // Không await: đường ghi này nằm trong nhánh xử lý lỗi, không được phép làm
  // chậm hay ném thêm lỗi mới.
  fsPromises
    .mkdir(path.dirname(RATE_LIMIT_FILE), { recursive: true })
    .then(() => fsPromises.writeFile(RATE_LIMIT_FILE, JSON.stringify(payload, null, 2), "utf-8"))
    .catch(() => { /* ghi hỏng thì thôi, log đã có bản của nó */ });
}

export async function readPersistedRateLimitError(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsPromises.readFile(RATE_LIMIT_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Payload lỗi ĐẦY ĐỦ của lần bị chặn gần nhất. Mã chính (code 4) chỉ nói "hết
 *  hạn mức"; thứ phân biệt được "gọi quá nhiều" với "app bị hạn chế quyền" /
 *  "tạm khoá" là **error_subcode** — mà trước đây bị vứt đi, chỉ giữ message. */
let lastRateLimitError: Record<string, unknown> | null = null;

export function readMetaLastRateLimitError(): Record<string, unknown> | null {
  return lastRateLimitError;
}

export function readMetaRawUsageHeaders(): Record<string, string> {
  return lastRawUsageHeaders;
}

interface BucketReading {
  bucket: string;
  pct: number;
  minutesToRegain: number | null;
  callCount: number;
  cputime: number;
  time: number;
}

/** Bậc truy cập Marketing API, đọc từ `x-ad-account-usage.ads_api_access_tier`.
 *
 *  ĐO THẬT 26/08/2026 ĐÚNG LÚC BỊ CHẶN — đây là phát hiện quan trọng nhất về
 *  hạn mức Meta của app này:
 *
 *      x-app-usage        = {"call_count":2,...}          ← 2%
 *      x-ad-account-usage = {"acc_id_util_pct":0, "ads_api_access_tier":"development_access"}
 *      → Meta VẪN trả "Application request limit reached"
 *
 *  Tức là app bị chặn khi MỌI xô đo được đều gần như rỗng. Lý do: bậc
 *  `development_access` có trần cứng riêng (~60 lượt gọi/giờ cho mỗi tài khoản
 *  quảng cáo) KHÔNG phản ánh vào bất kỳ header phần trăm nào. Bao nhiêu công
 *  tối ưu số lượt gọi cũng không gỡ được trần đó — chỉ nâng lên
 *  `standard_access` trong Meta App Dashboard mới gỡ được.
 *
 *  Nói ra bậc này trong thông điệp lỗi là bắt buộc: không có nó, người đọc thấy
 *  "xô căng nhất 2%" rồi đi tìm nhầm chỗ. */
let lastAccessTier: string | null = null;

export function readMetaAccessTier(): string | null {
  return lastAccessTier;
}

/** ỨNG DỤNG THẬT SỰ cấp ra token đang dùng — đọc từ Meta, KHÔNG lấy từ
 *  `META_APP_ID`.
 *
 *  VÌ SAO KHÔNG DÙNG `META_APP_ID`: đo ngày 21/09/2026, biến đó đang trỏ tới
 *  app `696800406015008` tên "n8n", trong khi token lại do app
 *  `754532870834472` tên "Mắt Bão" cấp. `META_APP_SECRET` cũng thuộc app sai
 *  (đúc `appsecret_proof` thì Meta trả "Invalid appsecret_proof").
 *
 *  Chưa gây lỗi gọi API vì không đường nào gửi `appsecret_proof`, và phép kiểm
 *  kết nối chỉ dùng token. NHƯNG thông điệp lỗi quyền bảo người dùng "vào Meta
 *  App Dashboard xin Advanced Access" — mà App ID duy nhất trong hệ thống lại
 *  là app sai. Người đọc đi xin quyền cho "n8n", xin xong vẫn lỗi y nguyên và
 *  không hiểu vì sao. Nên chỗ này phải hỏi Meta token thuộc app nào, đừng tin
 *  biến môi trường.
 *
 *  Không đoán bừa: dò hỏng thì để null, thông điệp lỗi nói "chưa đọc được". */
let tokenApp: { id: string; name?: string } | null = null;
let tokenAppProbeStarted = false;

export function readMetaTokenApp(): { id: string; name?: string } | null {
  return tokenApp;
}

/** Dò MỘT lần cho mỗi tiến trình, chạy nền, không chặn lượt gọi nào.
 *  Ở bậc development_access (~60 lượt/giờ) thì một lượt cũng đáng tiếc — nên
 *  chỉ dò khi ĐÃ gặp lỗi quyền, tức lúc thông tin này thật sự cần. */
async function probeTokenApp(token: string): Promise<void> {
  if (tokenAppProbeStarted || !token) return;
  tokenAppProbeStarted = true;
  try {
    const r = await fetch(`${BASE_URL}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const j = (await r.json()) as { data?: { app_id?: string | number } };
    const id = j?.data?.app_id != null ? String(j.data.app_id) : null;
    if (!id) return;
    let name: string | undefined;
    try {
      const r2 = await fetch(`${BASE_URL}/${id}?fields=name&access_token=${encodeURIComponent(token)}`);
      const j2 = (await r2.json()) as { name?: string };
      if (typeof j2?.name === "string" && j2.name) name = j2.name;
    } catch {
      // Tên chỉ để dễ đọc — thiếu tên vẫn còn ID, vẫn mở đúng App Dashboard được.
    }
    tokenApp = { id, name };
  } catch {
    // Dò hỏng thì thôi. Thà nói "chưa đọc được" còn hơn in ra một App ID đoán.
  }
}

/** Chờ dò xong rồi mới dựng thông điệp — gọi NGAY TRƯỚC describeMetaError khi
 *  đã biết đó là lỗi quyền. Tốn thêm 2 lượt gọi Meta, nhưng chỉ đúng lần gặp
 *  lỗi quyền và chỉ một lần cho mỗi tiến trình. Đổi lại người dùng có ngay tên
 *  app ở lần báo lỗi ĐẦU TIÊN, không phải mở lại trang mới thấy. */
export async function ensureMetaTokenApp(token: string | undefined): Promise<void> {
  if (token) await probeTokenApp(token);
}

function readSimpleBucket(raw: string | null, bucket: string): BucketReading | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { call_count?: number; total_cputime?: number; total_time?: number };
    const callCount = p.call_count ?? 0;
    const cputime = p.total_cputime ?? 0;
    const time = p.total_time ?? 0;
    return { bucket, pct: Math.max(callCount, cputime, time), minutesToRegain: null, callCount, cputime, time };
  } catch {
    return null;
  }
}

/** `x-business-use-case-usage` = { "<id>": [ { type, call_count, total_cputime,
 *  total_time, estimated_time_to_regain_access } ] }. Đây là xô thật sự chặn
 *  các lời gọi Marketing API, và là xô DUY NHẤT nói được bao lâu nữa hết chặn. */
function readBucBuckets(raw: string | null): BucketReading[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<{
      type?: string;
      call_count?: number;
      total_cputime?: number;
      total_time?: number;
      estimated_time_to_regain_access?: number;
    }>>;
    const out: BucketReading[] = [];
    for (const [id, entries] of Object.entries(parsed)) {
      for (const e of entries ?? []) {
        const callCount = e.call_count ?? 0;
        const cputime = e.total_cputime ?? 0;
        const time = e.total_time ?? 0;
        out.push({
          bucket: `buc:${e.type ?? "unknown"}@${id}`,
          pct: Math.max(callCount, cputime, time),
          minutesToRegain: e.estimated_time_to_regain_access ?? null,
          callCount, cputime, time,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Đọc header hạn mức. Gọi cho mọi phản hồi, kể cả phản hồi 200. */
export function noteMetaUsageHeaders(headers: Headers): void {
  const rawApp = headers.get("x-app-usage");
  const rawAcct = headers.get("x-ad-account-usage");
  const rawBuc = headers.get("x-business-use-case-usage");
  if (!rawApp && !rawAcct && !rawBuc) return;

  lastRawUsageHeaders = {
    ...(rawApp ? { "x-app-usage": rawApp } : {}),
    ...(rawAcct ? { "x-ad-account-usage": rawAcct } : {}),
    ...(rawBuc ? { "x-business-use-case-usage": rawBuc } : {}),
  };

  if (rawAcct) {
    try {
      const acct = JSON.parse(rawAcct) as { ads_api_access_tier?: string };
      if (acct.ads_api_access_tier) lastAccessTier = acct.ads_api_access_tier;
    } catch { /* header méo thì bỏ qua, không làm hỏng lời gọi */ }
  }

  const readings: BucketReading[] = [
    readSimpleBucket(rawApp, "app"),
    readSimpleBucket(rawAcct, "ad_account"),
    ...readBucBuckets(rawBuc),
  ].filter((r): r is BucketReading => r !== null);

  if (readings.length === 0) return;

  // Lấy xô CĂNG NHẤT, không lấy xô đầu tiên: bị chặn là do xô nào chạm trần
  // trước, không phải trung bình của tất cả.
  const worst = readings.reduce((a, b) => (b.pct > a.pct ? b : a));

  lastUsage = {
    callCount: worst.callCount,
    totalCputime: worst.cputime,
    totalTime: worst.time,
    at: new Date().toISOString(),
    worstBucket: worst.bucket,
    worstPct: worst.pct,
    minutesToRegain: worst.minutesToRegain,
  };

  const now = Date.now();
  const fields = {
    worstBucket: worst.bucket,
    worstPct: worst.pct,
    minutesToRegain: worst.minutesToRegain,
    buckets: readings.map((r) => `${r.bucket}=${r.pct}%`).join(" "),
  };
  if (worst.pct >= 80) {
    log.warn("meta_quota", `Hạn mức Meta đã dùng ${worst.pct}% ở xô ${worst.bucket}`, fields);
    lastUsageLoggedAt = now;
  } else if (now - lastUsageLoggedAt >= USAGE_LOG_EVERY_MS) {
    log.info("meta_quota", `Hạn mức Meta đang dùng ${worst.pct}% ở xô ${worst.bucket}`, fields);
    lastUsageLoggedAt = now;
  }
}

export function isMetaRateLimitError(err: { message?: string; code?: number } | null | undefined): boolean {
  if (!err) return false;
  if (err.code !== undefined && RATE_LIMIT_CODES.has(err.code)) return true;
  const m = (err.message ?? "").toLowerCase();
  return RATE_LIMIT_HINTS.some((h) => m.includes(h));
}

/** Ghi nhận "đang bị chặn" và trả về câu nói được cho người dùng. Dùng được cả
 *  ở những chỗ fetch thẳng Graph API không đi qua MetaClient. */
export function noteMetaRateLimit(message: string, rawError?: Record<string, unknown> | null): string {
  if (rawError && typeof rawError === "object") {
    lastRateLimitError = {
      code: rawError.code,
      error_subcode: rawError.error_subcode,
      type: rawError.type,
      message: rawError.message,
      error_user_title: rawError.error_user_title,
      error_user_msg: rawError.error_user_msg,
      fbtrace_id: rawError.fbtrace_id,
      at: new Date().toISOString(),
    };
    persistRateLimitError({
      ...lastRateLimitError,
      worstBucket: lastUsage?.worstBucket ?? null,
      worstPct: lastUsage?.worstPct ?? null,
      rawUsageHeaders: lastRawUsageHeaders,
    });
  }
  // Nghỉ bao lâu: ưu tiên con số CHÍNH META NÓI
  // (`estimated_time_to_regain_access` trong x-business-use-case-usage). Trước
  // đây luôn nghỉ cứng 10 phút — một con số tôi tự đặt, có thể ngắn hơn thời
  // gian Meta thật sự chặn (gọi lại sớm chỉ làm cửa sổ trượt dài thêm) hoặc dài
  // hơn (bắt người dùng chờ vô cớ).
  const metaMinutes = lastUsage?.minutesToRegain ?? null;
  const waitMs = metaMinutes && metaMinutes > 0
    ? metaMinutes * 60_000
    : THROTTLE_COOLDOWN_MS;

  throttledUntil = Date.now() + waitMs;
  throttleReason = message;

  // In nguyên văn header hạn mức: khi Meta bảo "hết hạn mức" mà xô app-usage chỉ
  // 2%, thứ duy nhất trả lời được "xô nào chặn" là chính mấy header này.
  log.warn("meta_quota", `Meta chặn vì vượt hạn mức — tạm ngưng gọi tới ${new Date(throttledUntil).toISOString()}`, {
    metaMessage: message,
    waitMinutes: Math.round(waitMs / 60_000),
    waitFromMeta: metaMinutes !== null,
    worstBucket: lastUsage?.worstBucket ?? null,
    worstPct: lastUsage?.worstPct ?? null,
    rawHeaders: lastRawUsageHeaders,
    // Mã phụ là thứ phân biệt "gọi quá nhiều" với "app bị hạn chế quyền":
    // các xô hạn mức đo được đều thấp (ads_insights 11%) mà Meta vẫn chặn, nên
    // nguyên nhân gần như chắc chắn KHÔNG nằm ở khối lượng gọi.
    metaError: lastRateLimitError,
  });

  return describeMetaError(message);
}

/** Lỗi hạn mức nói bằng tiếng người + kèm mức đã dùng, thay vì nguyên văn Meta. */
/** Mã lỗi nghĩa là "app KHÔNG CÓ QUYỀN làm việc này" — khác hẳn hết hạn mức.
 *  Hết hạn mức thì chờ là xong; thiếu quyền thì chờ bao lâu cũng vậy, phải vào
 *  Meta App Dashboard xin. Gộp hai loại vào một câu "lỗi Meta" khiến người đọc
 *  ngồi chờ một thứ không bao giờ tự hết. */
const PERMISSION_CODES = new Set([3, 10, 200, 294, 299]);
const PERMISSION_HINTS = [
  "does not have the capability",
  "permission",
  "requires ads_management",
  "not have sufficient administrative privilege",
];

export function isMetaPermissionError(err: { message?: string; code?: number } | null | undefined): boolean {
  if (!err) return false;
  if (err.code !== undefined && PERMISSION_CODES.has(err.code)) return true;
  const m = (err.message ?? "").toLowerCase();
  return PERMISSION_HINTS.some((h) => m.includes(h));
}

/** Nhóm lỗi "truy vấn insights quá nặng / Meta đang quá tải" — KHÁC hết hạn
 *  mức (chờ theo đồng hồ là hết) và KHÁC sai tham số (chờ bao lâu cũng vậy).
 *
 *  Ca thật 10/09/2026 trên /campaigns/ads-content: cả
 *  getAdInsightsForAccount lẫn getAdInsightsWindowAggregate cùng trả
 *  "(#2) Service temporarily unavailable" trong khi hạn mức mới dùng 1% và
 *  các lệnh tạo campaign/ad set/ad ngay trước đó đều OK — tức KHÔNG phải hết
 *  hạn mức, KHÔNG phải hỏng token. Tài liệu Meta (Insights Best Practices)
 *  xếp nhóm này vào lỗi hết giờ chờ: khuyên thu hẹp khoảng ngày, lấy ít dữ
 *  liệu hơn, hoặc chờ rồi gọi lại. Mã cũ ném ngay từ lần đầu nên một trục
 *  trặc thoáng qua đủ làm cả trang trống trơn.
 *
 *  Cố ý KHÔNG bắt theo code 1 (code 1 cũng là "Unknown error" cho vô số lỗi
 *  thật khác, thử lại chỉ tổ chậm). */
const TRANSIENT_INSIGHT_SUBCODES = new Set([1504018, 1504022, 1504033]);
const TRANSIENT_INSIGHT_HINTS = [
  "service temporarily unavailable",
  "please reduce the amount of data",
  "please try a smaller date range",
  "request timed out",
];

export function isMetaTransientInsightError(
  err: { message?: string; code?: number; error_subcode?: number } | null | undefined
): boolean {
  if (!err) return false;
  if (err.error_subcode !== undefined && TRANSIENT_INSIGHT_SUBCODES.has(err.error_subcode)) return true;
  if (err.code === 2) return true;
  const m = (err.message ?? "").toLowerCase();
  return TRANSIENT_INSIGHT_HINTS.some((h) => m.includes(h));
}

export function describeMetaError(message: string, code?: number): string {
  // Thiếu quyền phải xét TRƯỚC hạn mức: hai loại này đòi hai hành động trái
  // ngược nhau (chờ vs. đi xin quyền), và đoán nhầm thì người đọc mất hàng
  // ngày ngồi chờ. Ca thật 04/09/2026 trên /automation/audience: thêm interest
  // vào ad set trả "(#3) Application does not have the capability to make this
  // API call" — ĐỌC thì được (trang vừa đọc xong targeting hiện tại và 6 gợi ý
  // của Meta), chỉ GHI mới bị chặn ⇒ token có ads_read, không có quyền ghi
  // hiệu lực.
  // ĐÃ ĐO LẠI 21/09/2026 — bản trước nói SAI ở đây.
  //
  // Bản trước khẳng định "(#3) = ứng dụng không có quyền ghi, phải xin Advanced
  // Access trong App Dashboard", rồi in nguyên văn hướng dẫn đó ra màn hình.
  // Đó là lời khuyên đẩy người dùng đi làm App Review mất nhiều ngày cho một
  // thứ KHÔNG phải nguyên nhân. Đo thật trên tài khoản MBC, cùng token, cùng
  // lệnh `POST /{adsetId}` với trường `targeting`:
  //
  //   120252620445890736  PAUSED            ghi ĐƯỢC (2 lượt, cách nhau 25')
  //   120252571918500736  ACTIVE/CAMP_PAUSED ghi ĐƯỢC
  //   120252571959030736  ACTIVE/CAMP_PAUSED ghi được 2 lượt đầu, rồi (#3)
  //                                          suốt 8 lượt trong 30 phút
  //
  // Tức ứng dụng VẪN ghi được targeting. Token có scope `ads_management`
  // (kiểm bằng debug_token). Cả ba ad set đều có ô `work_positions` nên cũng
  // không phải do loại nhắm đó. Khác biệt duy nhất đo được: cái bị chặn vừa bị
  // sửa 3 lượt liên tiếp — `last_sig_edit_ts` mới hơn hẳn.
  //
  // Cơ chế chính xác thì KHÔNG khẳng định được từ bên ngoài. Nên câu báo dưới
  // đây chỉ nói đúng phần đo được và đề nghị việc rẻ trước (đợi rồi thử lại),
  // KHÔNG hứa đó là nguyên nhân duy nhất.
  //
  // `validate_only` vô dụng ở đây: thử ghi đúng payload đang hỏng ở chế độ đó
  // trên cả v19→v23 thì Meta đều trả success — nó kiểm DỮ LIỆU, không kiểm
  // quyền. Muốn biết chỉ có cách ghi thật.
  if (isMetaPermissionError({ message, code })) {
    const tier = lastAccessTier
      ? `Bậc truy cập đo được gần nhất: ${lastAccessTier}.`
      : "";
    const app = tokenApp
      ? `Ứng dụng đang dùng: ${tokenApp.name ? `"${tokenApp.name}" ` : ""}ID ${tokenApp.id}.`
      : "";
    return (
      `Meta chặn lượt GHI này — mã (#3). Đọc thì vẫn được. ` +
      `KHÔNG phải do dữ liệu bạn chọn sai. ` +
      `Nhiều khả năng do ad set này vừa bị sửa liên tiếp: đo ngày 21/09/2026 trên tài khoản MBC, ` +
      `cùng một token và cùng lệnh ghi thì HAI ad set khác chấp nhận bình thường, ` +
      `riêng ad set vừa bị sửa 3 lượt liền thì chặn suốt 8 lượt trong 30 phút. ` +
      `Nên việc nên làm trước là: ĐỢI rồi thử lại ad set đó sau, hoặc sửa tay trong Ads Manager. ` +
      `${app} ${tier} (Meta: ${message})`
    );
  }
  // Quá tải/hết giờ chờ phải nói khác hết hạn mức: người đọc "Service
  // temporarily unavailable" không đoán được là nên bấm lại hay nên đi báo lỗi.
  if (isMetaTransientInsightError({ message, code })) {
    return (
      `Meta chưa trả được số liệu cho khoảng thời gian này — truy vấn quá nặng nên bị hết giờ chờ ở phía Meta, ` +
      `không phải do hết hạn mức hay sai cấu hình. Hệ thống đã tự thử lại và tự chia nhỏ khoảng ngày nhưng vẫn chưa qua. ` +
      `Thử bấm Refresh sau vài phút, hoặc chọn khoảng thời gian ngắn hơn. (Meta: ${message})`
    );
  }
  if (!isMetaRateLimitError({ message })) return message;
  const mins = Math.max(1, Math.ceil((throttledUntil - Date.now()) / 60000));
  const u = lastUsage;

  // Meta có NHIỀU hạn mức song song. Nói rõ xô nào đang căng, và đừng khẳng
  // định "do App ID" khi xô app mới dùng vài phần trăm — đó chính là câu nói
  // sai mà bản trước hiện lên màn hình.
  const usage = u
    ? ` Xô căng nhất đo được: ${u.worstBucket} = ${u.worstPct}%.`
    : " (chưa đo được xô nào — lượt gọi bị chặn trước khi đọc được header.)";
  const source = u?.minutesToRegain
    ? " Thời gian chờ do chính Meta báo."
    : "";

  // Bậc truy cập ĐÈ LÊN mọi con số phần trăm ở trên. Ở `development_access`,
  // Meta chặn khi mọi xô còn gần rỗng (đo thật 26/08: app 2%, tài khoản 0% mà
  // vẫn bị chặn) — nên nếu không nói ra, người đọc sẽ đi tối ưu số lượt gọi
  // trong khi thứ chặn họ là cái trần cứng của bậc.
  if (lastAccessTier === "development_access") {
    return (
      `Meta chặn vì ứng dụng đang ở bậc DEVELOPMENT ACCESS của Marketing API — ` +
      `bậc này có trần cứng rất thấp (khoảng 60 lượt gọi mỗi giờ cho mỗi tài khoản quảng cáo), ` +
      `và trần đó KHÔNG hiện ra ở các con số phần trăm bên dưới.${usage} ` +
      `Giảm số lượt gọi chỉ hoãn được lỗi, không gỡ được: phải xin nâng lên STANDARD ACCESS ` +
      `trong Meta App Dashboard → Marketing API. Sẽ thử lại sau ~${mins} phút.${source} (Meta: ${message})`
    );
  }

  return (
    `Meta tạm chặn vì vượt hạn mức gọi API. Meta có nhiều hạn mức song song ` +
    `(theo App, theo tài khoản quảng cáo, và theo Business Use Case của Marketing API) — ` +
    `chỉ cần một xô đầy là chặn.${usage} Sẽ thử lại sau ~${mins} phút.${source}` +
    `${lastAccessTier ? ` Bậc truy cập: ${lastAccessTier}.` : ""} (Meta: ${message})`
  );
}

/** Đang trong thời gian nghỉ thì hỏng ngay tại chỗ, không gọi thêm. */
function assertNotThrottled(): void {
  if (Date.now() < throttledUntil) throw new Error(describeMetaError(throttleReason));
}

/** Mọi lời gọi Graph API nên đi qua đây: tôn trọng thời gian nghỉ + đọc header
 *  hạn mức. Không tự parse body để chỗ gọi vẫn xử lý phản hồi theo cách của nó. */
export async function graphFetch(url: string, init?: RequestInit): Promise<Response> {
  assertNotThrottled();
  const res = await fetch(url, init);
  noteMetaUsageHeaders(res.headers);
  return res;
}

/** Ném lỗi có phân loại từ payload Graph API. */
export function throwIfMetaError(payload: { error?: { message?: string; code?: number } } | null | undefined): void {
  const e = payload?.error;
  if (!e) return;
  const msg = e.message ?? "Meta API error";
  if (isMetaRateLimitError(e)) throw new Error(noteMetaRateLimit(msg, e as Record<string, unknown>));
  throw new Error(msg);
}

/** Memo ngắn cho insights cấp campaign: một lần mở trang gọi nhiều endpoint
 *  cùng khoảng ngày thì chỉ tốn một lượt gọi Meta, không phải ba. */
// Ứng dụng đang ở bậc DEVELOPMENT ACCESS: trần cứng khoảng 60 lượt/giờ cho
// mỗi tài khoản quảng cáo. Giữ đệm 60 giây nghĩa là chỉ riêng MỘT truy vấn
// được lặp lại đã đủ ăn hết hạn mức trong một giờ. Chi tiêu Meta của một
// khoảng ngày thay đổi rất chậm (Meta còn tự trễ vài giờ), nên đệm lâu hơn
// gần như không làm số kém chính xác, mà cắt được phần lớn lượt gọi.
// Chỉnh được bằng biến môi trường để không phải deploy lại khi cần siết thêm.
const INSIGHTS_MEMO_MS = Number(process.env.META_INSIGHTS_MEMO_MS ?? 600_000);
const INSIGHTS_MEMO_MAX = 50;
const insightsMemo = new Map<string, { rows: MetaInsightRaw[]; expires: number }>();

/** Memo cho danh sách campaign và danh sách ad set.
 *
 *  Vì sao cần: trang /campaigns gọi `/api/meta/campaigns` HAI LẦN cho một lần
 *  mở màn hình (một lần status=ACTIVE, một lần status=PAUSED). Mỗi lần chạy
 *  `getAdSetsGoalInfo()` — hàm này KHÔNG lọc theo trạng thái campaign nên hai
 *  lần trả về ĐÚNG CÙNG một dữ liệu, tức một nửa số lượt gọi là thừa sạch.
 *  Ở bậc development_access (~60 lượt/giờ) thì mỗi lượt thừa đều đắt.
 *
 *  TTL ngắn để số liệu không cũ đi trong lúc người dùng bấm Sync. */
// Danh sách campaign/ad set đổi còn chậm hơn số liệu — để lâu hơn nữa.
const LIST_MEMO_MS = Number(process.env.META_LIST_MEMO_MS ?? 900_000);
const adSetsGoalMemo = new Map<string, { rows: MetaAdSetGoalRaw[]; expires: number }>();
const campaignsMemo = new Map<string, { rows: MetaCampaignRaw[]; expires: number }>();

/** Xoá memo — dùng khi người dùng bấm Sync và cố ý muốn số mới. */
export function clearMetaListMemo(): void {
  adSetsGoalMemo.clear();
  campaignsMemo.clear();
  insightsMemo.clear();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chia một khoảng ngày thành các lát liền nhau, không chồng lấn, không hở.
 *  Dùng khi Meta từ chối một truy vấn insights vì quá nặng.
 *
 *  Cộng ngày qua `setDate` chứ không cộng mili-giây: cộng 7*86400000 sẽ lệch
 *  một giờ ở các mốc đổi giờ mùa, còn `setDate` thì tháng/năm/đổi giờ đều do
 *  Date tự xử lý. Định dạng lại bằng toISOString nên kết quả luôn là ngày UTC,
 *  khớp với `time_range` mà Meta hiểu. */
export function sliceDateRange(
  range: { from: string; to: string },
  days: number,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const last = new Date(range.to);
  let cursor = new Date(range.from);
  let guard = 0;
  while (cursor <= last && guard++ < 400) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + days - 1);
    out.push({ from: fmt(cursor), to: fmt(chunkEnd > last ? last : chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function devLog(method: string, endpoint: string, params?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.log(`[MetaClient] ${method} ${endpoint}`, params ?? "");
  }
}

// ─────────────────────────────────────────────
// MetaClient Class
// ─────────────────────────────────────────────

class MetaClient {
  private get token(): string {
    const t = process.env.META_ACCESS_TOKEN;
    if (!t) throw new Error("META_ACCESS_TOKEN not configured");
    return t;
  }

  private get adAccountId(): string {
    const id = process.env.META_AD_ACCOUNT_ID;
    if (!id) throw new Error("META_AD_ACCOUNT_ID not configured");
    return id;
  }

  // ── Core fetch with retry ──
  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    devLog(method, endpoint, params);

    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set("access_token", this.token);

    let body: string | undefined;
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    } else {
      body = JSON.stringify(params);
    }

    let attempt = 0;
    while (true) {
      const res = await graphFetch(url.toString(), {
        method,
        headers: method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
        body,
      });

      // Retry on 5xx
      if (res.status >= 500 && attempt < RETRY_LIMIT) {
        attempt++;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const data = await res.json() as { error?: { message?: string; code?: number }; data?: T } & T;

      // Lỗi hạn mức phải được nhận diện riêng: nó bật thời gian nghỉ cho MỌI
      // đường gọi Meta khác, thay vì mỗi chỗ tự đâm vào tường một lần.
      throwIfMetaError(data);
      if (!res.ok) throw new Error(`Meta API error ${res.status}`);

      return data;
    }
  }

  /** Như `request` nhưng lật hết trang.
   *
   *  Vì sao cần: `limit` của Graph API là **cỡ một trang**, không phải "lấy
   *  ngần này là đủ". Trang đầu đầy thì phần còn lại nằm ở `paging.next` — bỏ
   *  qua nó nghĩa là **âm thầm mất dữ liệu**: tài khoản 60 campaign mà xin
   *  limit 50 thì 10 campaign cuối biến mất khỏi mọi con số, không có lỗi nào
   *  báo. Đây đúng là loại "thiếu số mà không ai thấy" vừa gặp ở chi phí
   *  Facebook, chỉ khác là im lặng hơn.
   *
   *  Số lượt gọi vẫn tỉ lệ với **lượng dữ liệu thật**, không phải với số id —
   *  khác hẳn kiểu fan-out mỗi campaign một lượt đã gỡ ở `getCampaignInsights`. */
  private async requestAllPages<T>(
    endpoint: string,
    query: Record<string, unknown>,
    maxPages = 20,
  ): Promise<T[]> {
    const first = await this.request<{ data?: T[]; paging?: { next?: string } }>("GET", endpoint, query);
    const out: T[] = [...(first.data ?? [])];

    let next: string | undefined = first.paging?.next;
    for (let page = 1; next && page < maxPages; page++) {
      const res: Response = await graphFetch(next, { signal: AbortSignal.timeout(20_000) });
      const json = (await res.json()) as {
        data?: T[];
        paging?: { next?: string };
        error?: { message?: string; code?: number };
      };
      throwIfMetaError(json);
      const rows = json.data ?? [];
      out.push(...rows);

      // DỪNG KHI TRANG RỖNG.
      //
      // Phân trang con trỏ của Meta ở một số edge trả `paging.next` NGAY CẢ khi
      // đã hết dữ liệu — lật tiếp chỉ nhận về mảng rỗng kèm một `next` nữa.
      // Vòng lặp chỉ dựa vào `next` sẽ chạy đủ maxPages mỗi lần gọi: một lượt
      // đáng lẽ 1 lời gọi thành 20. Đây là rủi ro do chính bản vá phân trang
      // hôm nay tạo ra, và nó nằm đúng ở xô hạn mức mà ta đang truy.
      if (rows.length === 0) break;

      next = json.paging?.next;
    }

    if (next) {
      // Còn trang mà đã chạm trần: nói ra. Cắt im lặng thì lần sau lại ngồi
      // đoán vì sao tổng không khớp Ads Manager.
      log.warn("meta_client", `Dừng ở ${maxPages} trang, dữ liệu có thể còn thiếu`, { endpoint });
    }
    return out;
  }

  // ── 1. Get campaigns ──
  async getCampaigns(params?: {
    status?: string[];
    limit?: number;
  }): Promise<MetaCampaignRaw[]> {
    const endpoint = `/act_${this.adAccountId}/campaigns`;

    const query: Record<string, unknown> = {
      fields: [
        "id", "name", "status", "effective_status", "objective",
        "daily_budget", "lifetime_budget",
        "start_time", "stop_time", "created_time",
      ].join(","),
      // `limit` = cỡ MỘT trang, không phải trần số campaign lấy về: phần còn
      // lại được lật tiếp qua paging (xem requestAllPages). Mặc định cũ là 50
      // và không lật trang, nên tài khoản đông campaign bị cắt cụt trong im
      // lặng ở mọi nơi gọi hàm này mà không truyền limit.
      //
      // 500 = khớp với ba nơi đã tự truyền `limit: 500` cho chính edge này và
      // chạy thật nhiều tháng (nba/gather, ads-content/aggregate,
      // dashboard/unified) — để không tồn tại hai cỡ trang cho cùng một edge.
      // Trang to KHÔNG nặng thêm: tài khoản ít campaign thì Meta chỉ trả đúng
      // số có thật; trang to chỉ có nghĩa là ít lượt gọi hơn, tức nhẹ hơn cho
      // chiều `call_count` của hạn mức. (Khác hẳn các lời gọi insights đang cố
      // ý giữ 200: chúng kéo theo actions/action_values và Meta hay đòi
      // "reduce the amount of data" khi trang to.)
      limit: params?.limit ?? 500,
    };

    if (params?.status?.length) {
      query.filtering = JSON.stringify([
        { field: "effective_status", operator: "IN", value: params.status },
      ]);
    }

    // Khoá theo tài khoản + bộ trạng thái + cỡ trang: hai lời gọi khác trạng
    // thái vẫn là hai lời gọi thật, nhưng cùng một trạng thái gọi lại trong
    // vòng 1 phút (Dashboard và Campaigns mở gần nhau) thì dùng lại.
    const key = `${this.adAccountId}|${(params?.status ?? []).slice().sort().join(",")}|${query.limit}`;
    const hit = campaignsMemo.get(key);
    if (hit && hit.expires > Date.now()) return hit.rows;

    const rows = await this.requestAllPages<MetaCampaignRaw>(endpoint, query);
    campaignsMemo.set(key, { rows, expires: Date.now() + LIST_MEMO_MS });
    return rows;
  }

  // ── 1b. Get active ad sets with full targeting spec (Audience Overlap) ──
  // Meta deprecated the standalone Audience Overlap comparison from the
  // public Marketing API years ago — there is no callable "overlap"
  // endpoint anymore (confirmed: only /reachestimate exists, and that's a
  // single-audience size estimate, not a pairwise overlap ratio). This
  // fetches the real targeting spec Meta already returns per ad set so a
  // targeting-similarity PROXY can be computed locally instead.
  async getActiveAdSetsWithTargeting(): Promise<MetaAdSetTargetingRaw[]> {
    const endpoint = `/act_${this.adAccountId}/adsets`;
    const query: Record<string, unknown> = {
      fields: ["id", "name", "status", "campaign_id", "campaign{name}", "daily_budget", "targeting"].join(","),
      filtering: JSON.stringify([
        { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
      ]),
      limit: 200,
    };
    // Thiếu ad set ở đây = Audience Overlap so sót cặp, rồi kết luận "không có
    // trùng lặp" trên một bức tranh khuyết — nên phải lật hết trang.
    return this.requestAllPages<MetaAdSetTargetingRaw>(endpoint, query);
  }

  // ── 1c. Get ad set optimization goals (which action_type = "Kết quả") ──
  // Meta's own Ads Manager "Kết quả"/CPL column is per ad set's configured
  // optimization_goal + promoted_object.custom_event_type — NOT hardcoded
  // to "purchase". Callers use this to pick the right actions[] entry per
  // campaign instead of assuming every campaign optimizes for purchases.
  async getAdSetsGoalInfo(): Promise<MetaAdSetGoalRaw[]> {
    const endpoint = `/act_${this.adAccountId}/adsets`;
    const query: Record<string, unknown> = {
      fields: ["id", "campaign_id", "optimization_goal", "promoted_object"].join(","),
      filtering: JSON.stringify([
        { field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] },
      ]),
      limit: 500,
    };
    const key = this.adAccountId;
    const hit = adSetsGoalMemo.get(key);
    if (hit && hit.expires > Date.now()) return hit.rows;

    // Thiếu ad set ở đây = campaign đó không tra được mục tiêu tối ưu, nên
    // "Kết quả"/CPL của nó rơi về mặc định sai (xem lib/meta-conversion-goal).
    const rows = await this.requestAllPages<MetaAdSetGoalRaw>(endpoint, query);
    adSetsGoalMemo.set(key, { rows, expires: Date.now() + LIST_MEMO_MS });
    return rows;
  }

  // ── 2. Get campaign insights (parallel per-campaign fetch) ──
  // MỘT lượt gọi cho cả danh sách campaign — KHÔNG phải mỗi campaign một lượt.
  //
  // Bản cũ fan-out theo id: tài khoản 50 campaign = 50 lượt gọi Meta cho MỖI
  // lần mở Dashboard và MỖI lần mở Campaigns (cùng lúc, dạng burst). Đó là thứ
  // đẩy app đâm vào "Application request limit reached" — trong khi Meta cho
  // lấy đúng dữ liệu ấy ở cấp tài khoản (`level=campaign`) chỉ với một lượt gọi
  // cộng phân trang. Bản cũ còn nuốt lỗi từng campaign rồi trả thiếu hàng, tức
  // là vẽ thất bại thành "campaign đó tiêu 0đ"; bản này để lỗi nổi lên.
  async getCampaignInsights(
    campaignIds: string[],
    dateRange: { from: string; to: string },
    opts?: { timeIncrement?: number },
  ): Promise<MetaInsightRaw[]> {
    if (!campaignIds.length) return [];

    devLog("GET", `[${campaignIds.length} campaigns]/insights`, { dateRange, ...opts });

    const wanted = new Set(campaignIds);
    const rows = await this.campaignLevelInsights(dateRange, campaignIds, opts?.timeIncrement);
    return rows.filter((r) => wanted.has(r.campaign_id));
  }

  /** Rows cấp campaign của cả tài khoản trong khoảng ngày (có phân trang). */
  private async campaignLevelInsights(
    dateRange: { from: string; to: string },
    filterIds: string[],
    timeIncrement?: number,
  ): Promise<MetaInsightRaw[]> {
    // Danh sách ngắn thì để Meta lọc hộ — ít dữ liệu về, ít trang phải lật.
    // Danh sách dài thì lấy cả tài khoản rồi lọc tại chỗ: vẫn là một lượt gọi
    // cho mỗi trang, không phải một lượt cho mỗi id.
    const useFilter = filterIds.length > 0 && filterIds.length <= 20;
    const cacheKey = [
      dateRange.from,
      dateRange.to,
      timeIncrement ?? 0,
      useFilter ? [...filterIds].sort().join(",") : "*",
    ].join("|");

    const hit = insightsMemo.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.rows;

    const url = new URL(`${BASE_URL}/act_${this.adAccountId}/insights`);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set(
      "fields",
      [...INSIGHT_FIELDS, "campaign_id", "campaign_name", "date_start", "date_stop"].join(","),
    );
    url.searchParams.set("time_range", JSON.stringify({ since: dateRange.from, until: dateRange.to }));
    url.searchParams.set("level", "campaign");
    url.searchParams.set("limit", "200");
    if (timeIncrement) url.searchParams.set("time_increment", String(timeIncrement));
    if (useFilter) {
      url.searchParams.set(
        "filtering",
        JSON.stringify([{ field: "campaign.id", operator: "IN", value: filterIds }]),
      );
    }

    const rows: MetaInsightRaw[] = [];
    let next: string | null = url.toString();
    for (let page = 0; next && page < 20; page++) {
      const res: Response = await graphFetch(next, { signal: AbortSignal.timeout(20_000) });
      const json = (await res.json()) as {
        data?: MetaInsightRaw[];
        paging?: { next?: string };
        error?: { message?: string; code?: number };
      };
      throwIfMetaError(json);
      rows.push(...(json.data ?? []));
      next = json.paging?.next ?? null;
    }

    if (insightsMemo.size >= INSIGHTS_MEMO_MAX) insightsMemo.clear();
    insightsMemo.set(cacheKey, { rows, expires: Date.now() + INSIGHTS_MEMO_MS });
    return rows;
  }

  // ── 3. Get account insights (daily breakdown for charts) ──
  async getAccountInsights(
    dateRange: { from: string; to: string },
    timeIncrement = 1
  ): Promise<MetaAccountInsightRaw[]> {
    const endpoint = `/act_${this.adAccountId}/insights`;

    const res = await this.request<{ data: MetaAccountInsightRaw[] }>("GET", endpoint, {
      fields: [...INSIGHT_FIELDS, "date_start", "date_stop"].join(","),
      time_range: JSON.stringify({ since: dateRange.from, until: dateRange.to }),
      time_increment: timeIncrement,
      level: "account",
      limit: 90,
    });

    return res.data ?? [];
  }

  // ── 4. Get account summary (aggregate, no breakdown) ──
  async getAccountSummary(
    dateRange: { from: string; to: string }
  ): Promise<MetaAccountInsightRaw> {
    const endpoint = `/act_${this.adAccountId}/insights`;

    const res = await this.request<{ data: MetaAccountInsightRaw[] }>("GET", endpoint, {
      fields: [
        "impressions", "clicks", "spend", "ctr", "cpc", "cpm",
        "actions", "action_values", "reach", "frequency",
        "date_start", "date_stop",
      ].join(","),
      time_range: JSON.stringify({ since: dateRange.from, until: dateRange.to }),
      level: "account",
    });

    const first = res.data?.[0];
    if (!first) throw new Error("No account insight data returned from Meta API");
    return first;
  }

  // ── 4b. Campaign-level insights for the whole account ──
  // The attribution report needs Meta numbers split per company. There is one
  // shared Meta ad account (unlike Google Ads, which has an account per
  // company), so the only split available is by campaign name — the same
  // lib/company-detect.ts rule every other Meta surface in this app uses.
  // getAccountSummary() cannot do that: it returns one aggregate row for the
  // entire account, which is why the attribution page used to show identical
  // Facebook figures on both the MBC and MBI tabs.
  //
  // action_values is included so revenue (not just conversion counts) is
  // available; it is already part of MetaInsightRaw.
  async getCampaignInsightsForAccount(
    dateRange: { from: string; to: string }
  ): Promise<MetaCampaignInsightRaw[]> {
    const endpoint = `/act_${this.adAccountId}/insights`;
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set(
      "fields",
      ["campaign_id", "campaign_name", "spend", "impressions", "clicks", "actions", "action_values"].join(","),
    );
    url.searchParams.set("time_range", JSON.stringify({ since: dateRange.from, until: dateRange.to }));
    url.searchParams.set("level", "campaign");
    url.searchParams.set("limit", "200");

    const results: MetaCampaignInsightRaw[] = [];
    let nextUrl: string | null = url.toString();
    let pages = 0;
    const MAX_PAGES = 20;

    while (nextUrl && pages < MAX_PAGES) {
      const res: Response = await fetch(nextUrl);
      const json = (await res.json()) as {
        data?: MetaCampaignInsightRaw[];
        paging?: { next?: string };
        error?: { message: string };
      };
      if (json.error) throw new Error(json.error.message);
      results.push(...(json.data ?? []));
      nextUrl = json.paging?.next ?? null;
      pages++;
    }

    return results;
  }

  // ── 5. Get account info (currency, name, etc.) ──
  async getAccountInfo(): Promise<{ currency: string; name: string; timezone_name: string; account_status: number }> {
    const endpoint = `/act_${this.adAccountId}`;

    const res = await this.request<{
      currency: string;
      name: string;
      timezone_name: string;
      account_status: number;
    }>("GET", endpoint, {
      fields: "currency,name,timezone_name,account_status",
    });

    return {
      currency: res.currency,
      name: res.name,
      timezone_name: res.timezone_name,
      account_status: res.account_status,
    };
  }

  // ── 6. Get daily ad-level insights for the whole account (Ads Content) ──
  // Meta only returns ads with activity in the time range, so this
  // also satisfies "only creatives with spend in the selected month"
  // for free. Returns one row per ad per active day (caller sums for
  // monthly totals and derives true last-active date from the rows).
  // Paginates via paging.next since a full month at ad-level x daily
  // can exceed a single page.
  /** Insight cấp AD SET cho cả tài khoản trong một khoảng ngày.
   *
   *  Một lượt gọi (có phân trang) cho toàn bộ ad set — dùng cho báo cáo "sở
   *  thích nào đã từng ra tiền" (lib/audience-performance). KHÔNG gọi theo từng
   *  ad set: đó đúng là kiểu fan-out đã đẩy app đâm vào hạn mức Meta hôm 24/08.
   */
  async getAdSetInsightsForAccount(
    dateRange: { from: string; to: string },
  ): Promise<Array<{ adset_id: string; adset_name?: string; spend?: string; actions?: unknown }>> {
    const url = new URL(`${BASE_URL}/act_${this.adAccountId}/insights`);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("fields", "adset_id,adset_name,spend,actions");
    url.searchParams.set("time_range", JSON.stringify({ since: dateRange.from, until: dateRange.to }));
    url.searchParams.set("level", "adset");
    url.searchParams.set("limit", "200");

    const out: Array<{ adset_id: string; adset_name?: string; spend?: string; actions?: unknown }> = [];
    let next: string | null = url.toString();
    for (let page = 0; next && page < 20; page++) {
      const res: Response = await graphFetch(next, { signal: AbortSignal.timeout(20_000) });
      const json = (await res.json()) as {
        data?: Array<{ adset_id: string; adset_name?: string; spend?: string; actions?: unknown }>;
        paging?: { next?: string };
        error?: { message?: string; code?: number };
      };
      throwIfMetaError(json);
      const rows = json.data ?? [];
      out.push(...rows);
      if (rows.length === 0) break;
      next = json.paging?.next ?? null;
    }
    return out;
  }

  /** Lật hết trang của một truy vấn insights, có thử lại cho nhóm lỗi quá
   *  tải/hết giờ chờ của Meta.
   *
   *  Vì sao không dùng `fetch` trần như trước: (1) `graphFetch` mới đọc header
   *  hạn mức và tôn trọng thời gian nghỉ — gọi thẳng `fetch` là nện thêm vào
   *  lúc Meta đang chặn; (2) mã cũ chỉ giữ `error.message` rồi vứt `code` và
   *  `error_subcode`, nên khi hỏng không ai phân biệt được hết giờ chờ
   *  (1504018) với lỗi thật — đúng tình trạng mù xảy ra hôm 10/09/2026. */
  private async fetchInsightPages(
    url: URL,
    label: string,
    maxPages = 25,
  ): Promise<MetaAdInsightRaw[]> {
    const results: MetaAdInsightRaw[] = [];
    let nextUrl: string | null = url.toString();
    let pages = 0;

    while (nextUrl && pages < maxPages) {
      devLog("GET", label, { page: pages });

      let data: {
        data?: MetaAdInsightRaw[];
        paging?: { next?: string };
        error?: { message?: string; code?: number; error_subcode?: number };
      } | null = null;

      // Thử lại có giãn cách CHỈ cho nhóm quá tải/hết giờ chờ. Lỗi sai tham số
      // hay thiếu quyền thì thử lại vô nghĩa — ném ngay để lộ ra sớm.
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const res = await graphFetch(nextUrl);
        data = await res.json();

        const err = data?.error;
        if (!err) break;

        if (isMetaTransientInsightError(err) && attempt < MAX_ATTEMPTS) {
          const waitMs = 1500 * attempt;
          log.warn("meta_insights", `${label}: Meta quá tải (code ${err.code ?? "?"}, subcode ${err.error_subcode ?? "?"}) — thử lại lần ${attempt + 1}/${MAX_ATTEMPTS} sau ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }

        // Ghi lại ĐẦY ĐỦ mã lỗi trước khi ném — `message` một mình không đủ
        // để lần sau biết đã gặp chuyện gì.
        log.error("meta_insights", `${label} hỏng: code=${err.code ?? "?"} subcode=${err.error_subcode ?? "?"} — ${err.message ?? "không rõ"}`);
        // Lỗi hạn mức đi đường cũ: throwIfMetaError còn có tác dụng phụ BẮT
        // BUỘC là ghi thời gian nghỉ cho mọi đường gọi Meta khác. Mọi lỗi còn
        // lại mới đi qua describeMetaError. Thứ tự này quan trọng —
        // throwIfMetaError ném với nguyên văn chữ Meta, nên nếu gọi nó trước
        // cho MỌI lỗi thì describeMetaError bên dưới thành mã chết.
        if (isMetaRateLimitError(err)) throwIfMetaError(data as { error?: { message?: string; code?: number } });
        throw new Error(describeMetaError(err.message ?? "Meta API error fetching ad insights", err.code));
      }

      results.push(...(data?.data ?? []));
      nextUrl = data?.paging?.next ?? null;
      pages++;
    }

    return results;
  }

  private buildAdInsightsUrl(
    dateRange: { from: string; to: string },
    fields: string[],
    timeIncrementDaily: boolean,
    limit = 200,
  ): URL {
    const url = new URL(`${BASE_URL}/act_${this.adAccountId}/insights`);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("fields", fields.join(","));
    url.searchParams.set("time_range", JSON.stringify({ since: dateRange.from, until: dateRange.to }));
    url.searchParams.set("level", "ad");
    if (timeIncrementDaily) url.searchParams.set("time_increment", "1");
    url.searchParams.set("limit", String(limit));
    return url;
  }

  private static readonly AD_INSIGHT_DAILY_FIELDS = [
    "ad_id", "ad_name", "campaign_id", "campaign_name", "adset_id", "impressions", "clicks",
    "spend", "ctr", "frequency", "actions", "video_p25_watched_actions",
    "video_thruplay_watched_actions", "date_start", "date_stop",
  ];

  async getAdInsightsForAccount(
    dateRange: { from: string; to: string }
  ): Promise<MetaAdInsightRaw[]> {
    // 15/10/2026: trước đây gọi CẢ khoảng một lượt, lật trang 200 dòng LẦN LƯỢT — mỗi trang Meta mất ~10 giây, cả tháng
    // ~14 trang ≈ 140 giây cho lần tải đầu Ads Content (đo thật). Giờ chia lát 5 ngày, trang 500 dòng, chạy song song
    // tối đa 4 lát: cả tháng ≈ 6 lời gọi (ít hơn trước) và ~15-30 giây.
    // Chia theo ngày là AN TOÀN vì mỗi dòng là một ngày của một ad — ghép các lát chỉ là nối danh sách, không cộng gộp gì.
    // (Khác hẳn getAdInsightsWindowAggregate bên dưới: ở đó frequency được Meta tính trên cả cửa sổ nên chia lát sẽ ra số SAI.)
    const fields = MetaClient.AD_INSIGHT_DAILY_FIELDS;
    const slices = sliceDateRange(dateRange, MetaClient.AD_INSIGHT_SLICE_DAYS);

    const fetchSlice = async (slice: { from: string; to: string }): Promise<MetaAdInsightRaw[]> => {
      try {
        return await this.fetchInsightPages(
          this.buildAdInsightsUrl(slice, fields, true, 500),
          `[account]/insights (level=ad, lát ${slice.from}→${slice.to})`,
        );
      } catch (err) {
        // Truy vấn NGÀY + cấp ad là dạng nặng nhất Meta phải chạy đồng bộ; Meta bảo "thu hẹp khoảng ngày" → lát đó hạ
        // xuống từng ngày, trang 200 dòng, gọi lần lượt (giữ nhẹ tay khi Meta đang quá tải).
        if (!isMetaTransientInsightError({ message: err instanceof Error ? err.message : String(err) })) throw err;
        if (slice.from === slice.to) throw err;
        log.warn("meta_insights", `Lát ${slice.from}→${slice.to} bị Meta từ chối vì quá nặng — chia từng ngày rồi gọi lại`);
        const merged: MetaAdInsightRaw[] = [];
        for (const day of sliceDateRange(slice, 1)) {
          merged.push(...await this.fetchInsightPages(
            this.buildAdInsightsUrl(day, fields, true),
            `[account]/insights (level=ad, ngày ${day.from})`,
          ));
        }
        return merged;
      }
    };

    const out: MetaAdInsightRaw[][] = new Array(slices.length);
    let next = 0;
    const worker = async () => {
      while (next < slices.length) {
        const i = next++;
        out[i] = await fetchSlice(slices[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MetaClient.AD_INSIGHT_CONCURRENCY, slices.length) }, worker));
    return out.flat();
  }

  private static readonly AD_INSIGHT_SLICE_DAYS = 5;
  private static readonly AD_INSIGHT_CONCURRENCY = 4;

  // ── 6b. Ad-level insights aggregated over the WHOLE window (one row per
  // ad, not per day) — used for creative fatigue, which needs a real
  // window-level frequency (reach de-duplicates across days, so summing/
  // averaging the daily rows from getAdInsightsForAccount would NOT equal
  // the true 7-day frequency; Meta must compute it over the full range).
  //
  // KHÔNG có nhánh chia lát ở đây, và đó là chủ ý: chia lát rồi ghép sẽ phá
  // đúng con số mà hàm này sinh ra để lấy. Hỏng thì chịu hỏng, kèm lỗi nói rõ.
  async getAdInsightsWindowAggregate(
    dateRange: { from: string; to: string }
  ): Promise<MetaAdInsightRaw[]> {
    return this.fetchInsightPages(
      this.buildAdInsightsUrl(
        dateRange,
        ["ad_id", "ad_name", "campaign_id", "campaign_name", "adset_id", "impressions", "clicks", "spend", "ctr", "frequency", "actions"],
        false,
      ),
      "[account]/insights (level=ad, window-aggregate)",
    );
  }

  // ── 7. Batched ad + creative metadata lookup by id (Ads Content) ──
  // Called AFTER filtering to this month's active ad_ids from
  // getAdInsightsForAccount, never for the whole account — avoids
  // pulling years of ad history just to find this month's set.
  async getAdsByIds(adIds: string[]): Promise<MetaAdRaw[]> {
    if (!adIds.length) return [];

    const CHUNK_SIZE = 50; // Graph API multi-id GET practical batch size
    const chunks: string[][] = [];
    for (let i = 0; i < adIds.length; i += CHUNK_SIZE) {
      chunks.push(adIds.slice(i, i + CHUNK_SIZE));
    }

    const creativeFields = [
      "id", "name", "thumbnail_url", "image_url", "body", "title", "call_to_action_type",
      "object_story_spec{link_data{message,name,description,call_to_action,link,picture},video_data{message,title,call_to_action,image_url}}",
    ].join(",");

    const chunkResults = await Promise.all(
      chunks.map(async (ids) => {
        const url = new URL(BASE_URL);
        url.searchParams.set("access_token", this.token);
        url.searchParams.set("ids", ids.join(","));
        url.searchParams.set("fields", `id,name,status,campaign_id,adset_id,creative{${creativeFields}}`);

        try {
          const res = await fetch(url.toString());
          const data = (await res.json()) as Record<string, MetaAdRaw> & { error?: { message: string } };
          if (data.error) {
            console.warn(`[MetaClient] getAdsByIds chunk error: ${data.error.message}`);
            return [];
          }
          return Object.values(data).filter((v): v is MetaAdRaw => typeof v === "object" && v !== null && "id" in v);
        } catch (err) {
          console.warn("[MetaClient] getAdsByIds chunk failed:", err);
          return [];
        }
      })
    );

    return chunkResults.flat();
  }
}

// ─────────────────────────────────────────────
// Pixel resolution (real IDs — used as fallback when the live /adspixels
// fetch fails or env vars are missing). Single source of truth for both
// app/api/creative/get-pixels/route.ts and resolveCompanyPixelId() below —
// duplicating this list risked one place going stale (e.g. a rotated pixel
// ID) without the other.
// ─────────────────────────────────────────────

export const FALLBACK_PIXELS = [
  ...pixelOptions().map(o => ({ id: o.id, name: o.label })),
];

export interface ResolvedPixel {
  id: string;
  source: "live" | "fallback";
}

/**
 * Resolve the real Facebook Pixel ID for a company — tries a live
 * /adspixels fetch first (matching a pixel whose name contains "(MBC)" /
 * "(MBI)", same convention as FALLBACK_PIXELS' names), falls back to the
 * known-real hardcoded pixel ID if the live fetch fails or returns nothing.
 * Mirrors the honest fallback-labeling pattern already used by
 * app/api/creative/get-pixels/route.ts (source: "live" | "fallback").
 */
export async function resolveCompanyPixelId(company: string): Promise<ResolvedPixel | null> {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (token && adAccountId) {
    try {
      const res = await fetch(`${BASE_URL}/act_${adAccountId}/adspixels?fields=id,name&access_token=${token}`);
      const data = await res.json() as { data?: Array<{ id: string; name: string }>; error?: { message: string } };
      const match = data.data?.find(p => p.name.includes(`(${company})`));
      if (match) return { id: match.id, source: "live" };
      if (data.data?.length) {
        console.warn(`[MetaClient] resolveCompanyPixelId: /adspixels returned pixels but none named "(${company})" — using fallback`);
      }
    } catch (err) {
      console.warn("[MetaClient] resolveCompanyPixelId live fetch failed — using fallback:", err);
    }
  }

  const fallback = FALLBACK_PIXELS.find(p => p.name.includes(`(${company})`));
  return fallback ? { id: fallback.id, source: "fallback" } : null;
}

// ─────────────────────────────────────────────
// Real Meta WEBSITE Custom Audience creation (subtype=WEBSITE)
// ─────────────────────────────────────────────

export interface WebsiteAudienceParams {
  name: string;
  pixelId: string;
  /** Retention window in days — from AudienceConfig.days (see lib/audience-builder.ts). */
  retentionDays: number;
  description?: string;
}

export interface WebsiteAudienceCreated {
  id: string;
}

/**
 * Create a real Meta WEBSITE Custom Audience. Unlike a CUSTOM audience
 * (app/api/audiences/create-lookalike/route.ts's buildAudiencePayload
 * path), this never uploads a customer list — Meta computes membership
 * server-side from live Pixel traffic matching `rule`, and never exposes a
 * pre- or post-creation size estimate for it (same as Lookalike size).
 *
 * UNVERIFIED / not fully certain: the "web_visitors" source's UI label
 * ("Xem web > 3 trang" — viewed more than 3 pages in a session) implies a
 * per-session PAGE-COUNT threshold. Meta's Custom Audience Rule engine
 * matches on discrete pixel EVENTS (e.g. "a PageView event fired") and
 * event/parameter filters — this implementation could not confirm a
 * documented single-rule construct for "> N pages in one session" as
 * opposed to "fired >= 1 PageView within the retention window". Rather than
 * fabricate a rule shape that *looks* like it encodes a page-count
 * threshold without confirming Meta actually evaluates it that way, this
 * builds the closest verified-correct real construct: anyone who fired a
 * PageView event on this pixel within `retentionDays`. The exact filter
 * operator name used below ("eq") and the nesting under
 * `inclusions.rules[].filter.filters[]` reflect Meta's documented
 * "Rule-based Custom Audience" schema (event_sources + retention_seconds)
 * as of this writing — but this has NOT been executed against a real ad
 * account in this environment (no sandbox credentials available here), so
 * treat the exact field names as unverified until confirmed against a live
 * `customaudiences` create call. If a real page-count rule is later
 * confirmed possible (e.g. via a custom pixel event your site already
 * fires per N pages), swap the `filter` below — do not assume it works
 * without checking Meta's current Custom Audience Rule Reference for the
 * API version in use.
 */
export async function createWebsiteCustomAudience(
  adAccountId: string,
  token: string,
  params: WebsiteAudienceParams
): Promise<WebsiteAudienceCreated> {
  const rule = JSON.stringify({
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ type: "pixel", id: params.pixelId }],
          retention_seconds: Math.max(1, params.retentionDays) * 24 * 60 * 60,
          filter: {
            operator: "and",
            filters: [
              { field: "event", operator: "eq", value: "PageView" },
            ],
          },
        },
      ],
    },
  });

  const res = await fetch(`${BASE_URL}/act_${adAccountId}/customaudiences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      subtype: "WEBSITE",
      description: params.description ?? "Created via AdsCommand — source: web_visitors",
      rule,
      access_token: token,
    }),
  });

  const data = await res.json() as { id?: string; error?: { message: string } };
  if (data.error || !data.id) {
    throw new Error(data.error?.message ?? "Failed to create WEBSITE Custom Audience");
  }
  return { id: data.id };
}

// ─────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────
export const metaClient = new MetaClient();

// ─────────────────────────────────────────────
// Cached account currency (default USD until init)
// ─────────────────────────────────────────────
export let accountCurrency = "USD";

let _initPromise: Promise<{ currency: string; name: string; timezone_name: string; account_status: number }> | null = null;

export async function initMetaClient() {
  // Deduplicate concurrent calls — only fetch once
  if (!_initPromise) {
    _initPromise = metaClient.getAccountInfo().catch((err) => {
      console.error("[MetaClient] Failed to fetch account info:", err);
      _initPromise = null; // allow retry on next call
      return { currency: "USD", name: "", timezone_name: "", account_status: 0 };
    });
  }

  const info = await _initPromise;
  accountCurrency = info.currency; // Will be 'VND' for your account
  return info;
}
