// ─────────────────────────────────────────────
// Landing pages đang phục vụ quảng cáo Search — dùng cho Quality Score Toolkit.
//
// Vì sao tách ra khỏi route: truy vấn này có MỘT ẨN SỐ không giải được từ môi
// trường dev. Nguyên nhân "LANDING_PAGE" của Quality Score nằm ở mức TỪ KHÓA,
// còn `landing_page_view` là resource riêng khóa theo URL — muốn nối hai bên thì
// phải select kèm `ad_group.id`. Google có cho phép select `ad_group.id` cùng
// `landing_page_view` hay không thì:
//   - thư viện `google-ads-api` đang cài chỉ ship tên resource/field, KHÔNG ship
//     bảng tương thích `selectable_with`;
//   - trang tài liệu field của Google render bằng JS nên fetch về chỉ ra menu;
//   - workspace không có credential Google Ads để hỏi thẳng API.
// Đoán rồi deploy thì nếu sai, cả khối "Trang đích đang kéo điểm" sẽ trắng.
//
// Nên: thử truy vấn đầy đủ trước; Google từ chối thì tự hạ xuống truy vấn chỉ
// theo URL. Mất phần quy trách nhiệm theo ad group, nhưng vẫn giữ được thứ đáng
// tiền nhất — trang nào đang đốt bao nhiêu. Chế độ đang chạy được trả về để UI
// nói thật, không im lặng hiển thị bảng thiếu cột.
// ─────────────────────────────────────────────

export interface LandingPageRow {
  url: string;
  adGroupId: string | null;
  impressions: number;
  clicks: number;
  spendVnd: number;
  conversions: number;
}

export type LandingPageMode = "with_adgroup" | "url_only";

export interface LandingPageFetchResult {
  ok: boolean;
  mode: LandingPageMode | null;
  rows: LandingPageRow[];
  /** Lỗi của lần thử CUỐI — chỉ có ý nghĩa khi ok = false. */
  error?: string;
  /** Lỗi của truy vấn đầy đủ khi đã phải hạ cấp — để log/chẩn đoán về sau. */
  downgradeReason?: string;
}

/** Rút câu lỗi ĐỌC ĐƯỢC từ lỗi của google-ads-api (không phải Error thuần). */
function describeQueryError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const k of ["message", "error_string", "details", "code"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    try { return JSON.stringify(err).slice(0, 400); } catch { /* bỏ qua */ }
  }
  return String(err);
}

/** Chạy một GAQL và trả về mảng dòng thô. */
export type QueryRunner = (gaql: string) => Promise<unknown[]>;

function buildQuery(withAdGroup: boolean, whereClause: string, dateRange: string, includePaused = false): string {
  // `campaign.status` PHẢI nằm trong SELECT với resource landing_page_view.
  // Đo ngày 19/09/2026: Google chỉ bắt buộc điều này ở MỘT SỐ resource —
  // geographic_view, landing_page_view, campaign_asset thì bắt; còn campaign,
  // keyword_view, search_term_view, asset_group, ad_group_criterion,
  // campaign_conversion_goal thì không. Không suy ra được bằng luật chung,
  // phải thử từng cái.
  const adGroupSelect = withAdGroup ? "\n          ad_group.id," : "";
  // Quét cả chiến dịch đã dừng thì bỏ luôn khoá ENABLED ở cấp nhóm — nhóm
  // trong một chiến dịch đã dừng thường cũng không còn ENABLED.
  const adGroupWhere = withAdGroup && !includePaused ? "\n          AND ad_group.status = 'ENABLED'" : "";
  // KHOÁ `campaign.status = 'ENABLED'` TỪNG LÀM BỘ QUÉT MÙ ĐÚNG CHỖ CÓ VẤN ĐỀ.
  //
  // FEATURE-INVENTORY dòng 189: 5 URL chết gây 57 quảng cáo bị từ chối, và
  // "All 8 affected campaigns are **paused**, 0đ spent in 30 days". Lượt quét
  // thật ngày 24/09 với khoá ENABLED cho 238/238 sống — đúng, nhưng đúng về
  // một tập KHÔNG CHỨA vấn đề. Toàn bộ thứ tài liệu mô tả nằm bên kia khoá này.
  //
  // Mặc định vẫn chỉ ENABLED (chỗ đang tiêu tiền, cần canh hằng ngày).
  // `includePaused` dành cho lượt dọn dẹp.
  const campaignWhere = includePaused ? "campaign.status != 'REMOVED'" : "campaign.status = 'ENABLED'";
  return `
        SELECT
          landing_page_view.unexpanded_final_url,${adGroupSelect}
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          campaign.status
        FROM landing_page_view
        WHERE ${campaignWhere}${adGroupWhere}
          ${whereClause}
          AND segments.date DURING ${dateRange}
      `;
}

function toRows(raw: unknown[]): LandingPageRow[] {
  const out: LandingPageRow[] = [];
  for (const item of raw) {
    const row = item as {
      landing_page_view?: { unexpanded_final_url?: string };
      ad_group?: { id?: unknown };
      metrics?: { impressions?: number; clicks?: number; cost_micros?: number; conversions?: number };
    };
    const url = row.landing_page_view?.unexpanded_final_url ?? "";
    if (!url) continue;
    out.push({
      url,
      adGroupId: row.ad_group?.id != null ? String(row.ad_group.id) : null,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
      spendVnd: Math.round(Number(row.metrics?.cost_micros ?? 0) / 1_000_000),
      conversions: Number(row.metrics?.conversions ?? 0),
    });
  }
  return out;
}

export async function fetchLandingPages(
  run: QueryRunner,
  opts: { whereClause?: string; dateRange?: string; includePaused?: boolean } = {},
): Promise<LandingPageFetchResult> {
  const whereClause = opts.whereClause ?? "";
  const dateRange = opts.dateRange ?? "LAST_7_DAYS";
  const includePaused = opts.includePaused ?? false;

  try {
    const raw = await run(buildQuery(true, whereClause, dateRange, includePaused));
    return { ok: true, mode: "with_adgroup", rows: toRows(raw) };
  } catch (fullErr) {
    // Lỗi của google-ads-api KHÔNG phải Error thuần và `String(err)` ra
    // "[object Object]" — đo ngày 24/09, dòng lý do hạ cấp in ra đúng chuỗi vô
    // nghĩa đó. Bóc lấy phần đọc được, có gì dùng nấy.
    const downgradeReason = describeQueryError(fullErr);
    try {
      const raw = await run(buildQuery(false, whereClause, dateRange, includePaused));
      return { ok: true, mode: "url_only", rows: toRows(raw), downgradeReason };
    } catch (reducedErr) {
      return {
        ok: false,
        mode: null,
        rows: [],
        error: describeQueryError(reducedErr),
        downgradeReason,
      };
    }
  }
}

// ============================================================
// P3 — Quét landing page chết trên TOÀN BỘ quảng cáo đang chạy
// ============================================================
// Trước đây trang đích chỉ được kiểm ĐÚNG MỘT LẦN, lúc tạo chiến dịch mới
// (`launch/precheck`). Trang sống lúc tạo rồi chết sau đó thì không ai biết —
// mà theo số đo 21/09, 91% quảng cáo bị từ chối là do trang đích chết, 0% do
// câu chữ. Phần này quét lại định kỳ những gì ĐANG chạy.
//
// CHỈ ĐỌC VÀ BÁO CÁO. Không tự tạm dừng, không tự sửa gì.

import { checkFinalUrl } from "./google-final-url-check";

/**
 * Ba kết cục, KHÔNG phải hai.
 *
 * `checkFinalUrl` cố tình trả `ok: true` khi chính phép kiểm hỏng (hết giờ,
 * máy chủ mình mất mạng) — để không chặn oan người tạo chiến dịch. Đúng cho
 * việc đó, nhưng với một BÁO CÁO QUÉT thì gộp "còn sống" với "chưa kết luận
 * được" là che mất vấn đề: người đọc thấy danh sách sạch và tưởng đã yên.
 * Dấu hiệu phân biệt là `status === null` — không hề có phản hồi HTTP nào.
 */
export type SweepVerdict = "alive" | "dead" | "inconclusive";

export interface SweepRow {
  url: string;
  verdict: SweepVerdict;
  /** Mã HTTP THẬT mà trang trả về. `null` = không nhận được phản hồi nào. */
  status: number | null;
  finalUrl?: string;
  problem?: string;
  /** Địa chỉ THẬT SỰ đã mở thử, khi khác `url` vì đã gỡ ValueTrack. */
  probedUrl?: string;
  /** Số liệu GỘP của mọi nhóm quảng cáo cùng trỏ vào URL này. */
  impressions: number;
  clicks: number;
  spendVnd: number;
  conversions: number;
  /** Bao nhiêu dòng landing_page_view cùng trỏ vào URL này. */
  refCount: number;
}

export interface SweepResult {
  ok: boolean;
  /** Số URL DUY NHẤT đã kiểm (sau khi gộp trùng). */
  checked: number;
  /** Số dòng thô từ Google trước khi gộp. */
  totalRows: number;
  dead: SweepRow[];
  inconclusive: SweepRow[];
  aliveCount: number;
  /** Chi tiêu đang chảy vào các URL CHẾT — con số đáng hành động nhất. */
  deadSpendVnd: number;
  error?: string;
  downgradeReason?: string;
}

/** Chạy tối đa `limit` việc song song. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * Gỡ tham số ValueTrack của Google khỏi URL trước khi mở thử.
 *
 * LỖI CÓ THẬT, bắt được ngày 24/09 khi quét tài khoản MBC lần đầu: 56/238 URL
 * bị báo CHẾT (404), tổng ₫2.085.125 — và **không cái nào chết thật**. Trường
 * `landing_page_view.unexpanded_final_url` trả về URL CHƯA THAY THẾ (tên
 * trường nói đúng điều đó), nên trong đường dẫn còn nguyên chuỗi `{ignore}`:
 *
 *   https://www.matbao.net/ten-mien/ten-mien-mien-phi{ignore}?utm_term={keyword}…
 *
 * Mở thẳng chuỗi đó thì máy chủ trả 404 — đúng, vì làm gì có thư mục tên
 * `ten-mien-mien-phi{ignore}`. Bỏ `{ignore}` đi thì trang trả 200 bình thường.
 * Đã kiểm tay 4 URL, cả 4 đều sống.
 *
 * Bài kiểm bằng dữ liệu giả KHÔNG bắt được lỗi này vì URL do tôi tự bịa đều
 * sạch. Phải quét tài khoản thật mới lộ.
 *
 * Cách xử lý:
 *  · `{ignore}` — Google gỡ hẳn token này khi phân phát, nên ta cũng gỡ.
 *  · Placeholder còn lại trong ĐƯỜNG DẪN — gỡ nốt, chúng không thuộc đường dẫn thật.
 *  · Tham số truy vấn còn chứa `{…}` — BỎ CẢ THAM SỐ. Chúng là tham số theo
 *    dõi, được thay lúc người ta bấm; giữ lại dạng thô chỉ làm nhiễu, và
 *    không tham số nào trong đó quyết định trang có tồn tại hay không.
 */
export function stripValueTrack(rawUrl: string): { url: string; changed: boolean } {
  if (!rawUrl.includes("{")) return { url: rawUrl, changed: false };

  const [beforeQuery, ...rest] = rawUrl.split("?");
  const path = beforeQuery.replace(/\{[^}]*\}/g, "");

  let query = rest.join("?");
  if (query) {
    query = query
      .split("&")
      .filter(pair => !pair.includes("{") && !pair.includes("}"))
      .join("&");
  }

  const url = query ? `${path}?${query}` : path;
  return { url, changed: url !== rawUrl };
}

export interface SweepOptions {
  whereClause?: string;
  dateRange?: string;
  /** Bao nhiêu URL kiểm song song. Giữ thấp: đây là request thật tới trang
   *  đích của chính mình, quét ồ ạt là tự tạo tải bất thường lên máy chủ nhà. */
  concurrency?: number;
  timeoutMs?: number;
  /** Trần số URL mỗi lượt quét, chặn trường hợp tài khoản có hàng nghìn trang. */
  maxUrls?: number;
  /**
   * Quét cả chiến dịch ĐÃ DỪNG. Mặc định false.
   * Chỗ đang tiêu tiền là chiến dịch ENABLED nên đó là mặc định hằng ngày.
   * Nhưng URL chết đã biết của tài khoản này nằm TRONG chiến dịch đã dừng
   * (FEATURE-INVENTORY dòng 189), nên lượt dọn dẹp phải bật cờ này.
   */
  includePaused?: boolean;
  /** Ngôn ngữ câu giải thích `problem` (mặc định tiếng Việt). */
  t?: import("@/lib/i18n/translate").TFunction;
}

/**
 * Quét toàn bộ trang đích của quảng cáo đang chạy.
 *
 * GỘP TRÙNG trước khi kiểm: `landing_page_view` trả một dòng cho mỗi cặp
 * (url × nhóm quảng cáo), nên cùng một URL có thể xuất hiện hàng chục lần.
 * Không gộp thì vừa phí lượt gọi vừa nện chính trang đích của mình.
 */
export async function sweepLandingPages(
  run: QueryRunner,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const { concurrency = 4, timeoutMs = 12_000, maxUrls = 300 } = opts;

  const fetched = await fetchLandingPages(run, {
    whereClause: opts.whereClause,
    dateRange: opts.dateRange ?? "LAST_30_DAYS",
    includePaused: opts.includePaused ?? false,
  });
  if (!fetched.ok) {
    return {
      ok: false, checked: 0, totalRows: 0, dead: [], inconclusive: [],
      aliveCount: 0, deadSpendVnd: 0,
      error: fetched.error, downgradeReason: fetched.downgradeReason,
    };
  }

  const merged = new Map<string, Omit<SweepRow, "verdict" | "status" | "problem" | "finalUrl">>();
  for (const r of fetched.rows) {
    if (!r.url) continue;
    const cur = merged.get(r.url);
    if (cur) {
      cur.impressions += r.impressions; cur.clicks += r.clicks;
      cur.spendVnd += r.spendVnd; cur.conversions += r.conversions;
      cur.refCount += 1;
    } else {
      merged.set(r.url, {
        url: r.url, impressions: r.impressions, clicks: r.clicks,
        spendVnd: r.spendVnd, conversions: r.conversions, refCount: 1,
      });
    }
  }

  // Ưu tiên kiểm URL tiêu nhiều tiền nhất khi phải cắt theo trần.
  const urls = Array.from(merged.values())
    .sort((a, b) => b.spendVnd - a.spendVnd)
    .slice(0, maxUrls);

  const checks = await pool(urls, concurrency, async (base) => {
    // Mở thử bản ĐÃ GỠ ValueTrack, nhưng giữ `url` gốc để người đọc còn nhận
    // ra dòng nào trong Google Ads — xem ghi chú ở stripValueTrack.
    const { url: probeUrl, changed } = stripValueTrack(base.url);
    const res = await checkFinalUrl(probeUrl, timeoutMs, opts.t);
    const verdict: SweepVerdict = !res.ok ? "dead" : res.status === null ? "inconclusive" : "alive";
    return {
      ...base, verdict, status: res.status, finalUrl: res.finalUrl, problem: res.problem,
      probedUrl: changed ? probeUrl : undefined,
    } as SweepRow;
  });

  // ── Vòng hai cho những URL chưa kết luận được ─────────────────────────
  // Đo ngày 24/09 trên tài khoản thật: 3 URL wiki.matbao.net rơi vào "chưa
  // kết luận". Kiểm tay thì chúng trả 200 — nhưng mất 8,3 giây với User-Agent
  // của bộ quét, trong khi UA trình duyệt chỉ mất 0,27 giây. Máy chủ đang bóp
  // tốc độ với UA bot; chạy 4 luồng song song là vượt trần 12 giây.
  //
  // KHÔNG giả làm trình duyệt để lách — vẫn khai đúng mình là ai. Thay vào đó
  // thử lại TUẦN TỰ với hạn giờ gấp đôi. Còn hỏng nữa thì mới thật sự là chưa
  // kết luận được.
  const needRetry = checks.filter(c => c.verdict === "inconclusive");
  for (const row of needRetry) {
    const { url: probeUrl } = stripValueTrack(row.url);
    const res = await checkFinalUrl(probeUrl, timeoutMs * 2, opts.t);
    row.verdict = !res.ok ? "dead" : res.status === null ? "inconclusive" : "alive";
    row.status = res.status;
    row.finalUrl = res.finalUrl;
    row.problem = res.problem;
  }

  const dead = checks.filter(c => c.verdict === "dead").sort((a, b) => b.spendVnd - a.spendVnd);
  const inconclusive = checks.filter(c => c.verdict === "inconclusive");

  return {
    ok: true,
    checked: checks.length,
    totalRows: fetched.rows.length,
    dead,
    inconclusive,
    aliveCount: checks.filter(c => c.verdict === "alive").length,
    deadSpendVnd: dead.reduce((s, d) => s + d.spendVnd, 0),
    downgradeReason: fetched.downgradeReason,
  };
}

// ============================================================
// Nguồn thứ hai: quảng cáo ĐANG BỊ TỪ CHỐI
// ============================================================
// VÌ SAO CẦN NGUỒN THỨ HAI (đo ngày 24/09):
//
// `landing_page_view` là resource theo SỐ LIỆU — nó chỉ trả về URL đã có lưu
// lượng trong kỳ. Chiến dịch đã dừng, 0đ chi tiêu, thì KHÔNG có dòng nào, kể
// cả khi bỏ khoá `campaign.status = 'ENABLED'`. Lượt quét bật `includePaused`
// vẫn cho 0 trang chết ở cả hai tài khoản.
//
// Hỏi thẳng `ad_group_ad` — resource theo ĐỊNH NGHĨA — thì ra ngay:
//   MBC:  5 quảng cáo không APPROVED
//   MBI: 96 quảng cáo không APPROVED, 48 lý do DESTINATION_NOT_WORKING
// Không tài liệu nào của dự án nhắc tới phần MBI.
//
// Nguyên nhân gốc tìm được: 43+ quảng cáo trỏ vào `https://www.mifi.vn/…`,
// mà chứng chỉ HTTPS chỉ cấp cho `mifi.vn`, KHÔNG có `www.mifi.vn` → máy chủ
// từ chối bắt tay TLS → Google xếp DESTINATION_NOT_WORKING.
//
// Bài học: một resource "theo số liệu" không bao giờ thấy được thứ đã ngừng
// chạy. Muốn tìm cái hỏng thì phải hỏi nơi ĐỊNH NGHĨA nó.

export interface DisapprovedAdRow {
  adId: string;
  campaignName: string;
  adGroupName: string;
  /** Lý do Google đưa ra, ví dụ DESTINATION_NOT_WORKING. */
  topics: string[];
  finalUrls: string[];
}

export interface DisapprovedFetchResult {
  ok: boolean;
  rows: DisapprovedAdRow[];
  /** Đếm theo lý do, nhiều nhất trước. */
  byTopic: Array<{ topic: string; count: number }>;
  /** Đếm theo tên miền đích — nơi nhìn ra ổ vấn đề nhanh nhất. */
  byHost: Array<{ host: string; count: number; ignored: boolean }>;
  /**
   * Số quảng cáo bị BỎ QUA theo cấu hình. Đếm và nêu tên, KHÔNG xoá lặng.
   * Một con số bị giấu là một con số sẽ quay lại làm người đọc bất ngờ.
   */
  ignoredCount: number;
  ignoredHosts: string[];
  error?: string;
}

/**
 * Tên miền đã ngừng dùng — bỏ qua khi báo cáo.
 *
 * Đọc từ `LANDING_SWEEP_IGNORE_HOSTS`, ngăn cách bằng dấu phẩy.
 * Ví dụ: `LANDING_SWEEP_IGNORE_HOSTS=www.mifi.vn`
 *
 * VÌ SAO LÀ DANH SÁCH CÓ TÊN, KHÔNG PHẢI XOÁ LẶNG: quảng cáo vẫn nằm đó trong
 * tài khoản, vẫn bị Google từ chối. Bỏ qua ở đây chỉ có nghĩa "đã biết và chấp
 * nhận", nên báo cáo phải vẫn nói ra con số và tên miền. Giấu hẳn thì lần sau
 * người khác mở lên sẽ tưởng tài khoản sạch.
 */
function ignoredHostList(): string[] {
  return (process.env.LANDING_SWEEP_IGNORE_HOSTS ?? "")
    .split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return "(url hỏng)"; }
}

/**
 * Đọc mọi quảng cáo KHÔNG ở trạng thái APPROVED, kèm lý do và trang đích.
 * CHỈ ĐỌC. Thấy được cả quảng cáo trong chiến dịch đã dừng.
 */
export async function fetchDisapprovedAds(run: QueryRunner): Promise<DisapprovedFetchResult> {
  try {
    const raw = await run(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
             ad_group_ad.policy_summary.approval_status,
             ad_group_ad.policy_summary.policy_topic_entries,
             ad_group.name, campaign.name
      FROM ad_group_ad
      WHERE ad_group_ad.policy_summary.approval_status != 'APPROVED'
      LIMIT 1000
    `);

    const rows: DisapprovedAdRow[] = [];

    for (const item of raw) {
      const r = item as {
        ad_group_ad?: {
          ad?: { id?: unknown; final_urls?: unknown };
          policy_summary?: { policy_topic_entries?: Array<{ topic?: string }> };
        };
        ad_group?: { name?: string };
        campaign?: { name?: string };
      };
      const topics = (r.ad_group_ad?.policy_summary?.policy_topic_entries ?? [])
        .map(e => e?.topic).filter((t): t is string => Boolean(t));

      rows.push({
        adId: String(r.ad_group_ad?.ad?.id ?? ""),
        campaignName: String(r.campaign?.name ?? ""),
        adGroupName: String(r.ad_group?.name ?? ""),
        topics,
        finalUrls: Array.isArray(r.ad_group_ad?.ad?.final_urls)
          ? (r.ad_group_ad!.ad!.final_urls as unknown[]).map(String)
          : [],
      });
    }

    const ignore = ignoredHostList();
    const isIgnored = (r: DisapprovedAdRow) =>
      r.finalUrls.length > 0 && r.finalUrls.every(u => ignore.includes(hostOf(u)));

    const kept: DisapprovedAdRow[] = [];
    const ignoredSeen = new Set<string>();
    let ignoredCount = 0;
    for (const r of rows) {
      if (isIgnored(r)) {
        ignoredCount++;
        for (const u of r.finalUrls) ignoredSeen.add(hostOf(u));
      } else kept.push(r);
    }

    // Đếm lại lý do CHỈ trên phần còn giữ — nếu không, con số lý do sẽ gồm cả
    // phần đã bỏ qua và không khớp với danh sách hiện ra.
    const keptTopics = new Map<string, number>();
    const hostCount = new Map<string, number>();
    for (const r of kept) {
      for (const t of r.topics) keptTopics.set(t, (keptTopics.get(t) ?? 0) + 1);
      for (const h of new Set(r.finalUrls.map(hostOf))) hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
    }

    return {
      ok: true,
      rows: kept,
      byTopic: Array.from(keptTopics, ([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
      byHost: Array.from(hostCount, ([host, count]) => ({ host, count, ignored: false }))
        .sort((a, b) => b.count - a.count),
      ignoredCount,
      ignoredHosts: Array.from(ignoredSeen),
    };
  } catch (err) {
    return { ok: false, rows: [], byTopic: [], byHost: [], ignoredCount: 0, ignoredHosts: [], error: describeQueryError(err) };
  }
}

/**
 * Với mỗi tên miền trong danh sách bị từ chối, mở thử xem nó CÒN SỐNG không.
 *
 * Vì sao cần: Google giữ trạng thái từ chối cho tới khi có người xin duyệt
 * lại, nên "bị từ chối vì DESTINATION_NOT_WORKING" KHÔNG đồng nghĩa "trang
 * đang hỏng". Đo ngày 24/09: `matbao.in` có 19 quảng cáo mang lý do đó, nhưng
 * trang trả 200 và chứng chỉ hợp lệ — tức lỗi cũ, việc cần làm là XIN DUYỆT
 * LẠI, không phải sửa trang. Ngược lại `www.mifi.vn` hỏng thật.
 *
 * Hai việc khác hẳn nhau, mà nếu không đo thì trông giống hệt nhau trong báo
 * cáo. Gộp chung là đẩy người ta đi sửa thứ không hỏng.
 */
export async function classifyDisapprovedHosts(
  result: DisapprovedFetchResult,
  timeoutMs = 12_000,
): Promise<Array<{ host: string; count: number; alive: boolean; problem?: string }>> {
  const hosts = result.byHost.map(h => h.host).filter(h => h !== "(url hỏng)");
  const out = await pool(hosts, 3, async (host) => {
    const res = await checkFinalUrl(`https://${host}`, timeoutMs);
    return { host, alive: res.ok, problem: res.problem };
  });
  return result.byHost.map(h => {
    const c = out.find(o => o.host === h.host);
    return { host: h.host, count: h.count, alive: c?.alive ?? true, problem: c?.problem };
  });
}
