// ============================================================
// A3 (lát cắt 1) — Sở thích nào ĐÃ TỪNG ra tiền
// ------------------------------------------------------------
// A1 trả lời "phân khúc này dựa trên căn cứ nào" (kiến thức sản phẩm).
// A2-lite trả lời "Meta có hạng mục này không".
// Cả hai đều KHÔNG trả lời được câu quan trọng nhất: **cái này có đáng tiền
// không**. Đó là lý do "Travel website" lọt vào một chiến dịch bán tên miền —
// nó có căn cứ hình thức, có hạng mục thật, và vẫn sai.
//
// KHOÁ NỐI — vì sao KHÔNG dùng tên phân khúc:
// Luồng launch đặt tên ad set đúng bằng tên phân khúc, nghe như một khoá nối
// hoàn hảo. Nhưng AI sinh TÊN MỚI mỗi lần chạy ("Doanh nghiệp mới thành lập &
// Đang mở rộng (SME)" hôm nay, một cái tên khác hẳn ngày mai), nên nối bằng tên
// sẽ gần như không bao giờ khớp — một tính năng im lặng trả về "chưa có lịch
// sử" mãi mãi, tệ hơn là không có.
//
// Khoá bền là **ID SỞ THÍCH**: hai phân khúc cùng nhắm "Web hosting" thì so
// sánh được với nhau dù tên gọi khác nhau. Và Meta đã giữ sẵn danh sách sở thích
// trong `targeting` của từng ad set — không cần tự dựng kho lịch sử, không có
// khoảng trống dữ liệu cho các lần launch trước.
//
// CHI PHÍ: đúng HAI lượt gọi Meta cho toàn bộ tài khoản (không phải mỗi sở
// thích một lượt), chỉ chạy khi người dùng bấm, có cache.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { metaClient, graphFetch, throwIfMetaError } from "@/lib/meta-client";
import { log } from "@/lib/logger";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "audience-performance-cache.json");
/** Số liệu quảng cáo đổi theo ngày, không theo phút. 6 giờ là đủ tươi. */
const TTL_MS = 6 * 60 * 60 * 1000;
const META_BASE = META_GRAPH_BASE;

/** Action type tính là "kết quả" — cùng bộ mà attribution đang dùng, để hai nơi
 *  không cho ra hai con CPL khác nhau cho cùng một ad set. */
const CONVERSION_ACTIONS = ["lead", "purchase"];

export interface InterestPerformance {
  interestId: string;
  interestName: string;
  /** Tên tiếng Anh của cùng hạng mục, nếu Meta trả được.
   *
   *  Vì sao cần: báo cáo lấy tên từ `targeting` của ad set, mà ad set tạo ở
   *  locale nào thì mang tên locale đó — thực tế phần lớn là tiếng Việt
   *  ("Doanh nghiệp nhỏ"). AI lại đề xuất bằng tiếng Anh ("Small business").
   *  Khớp theo id (hướng C) gỡ được phần lớn, nhưng chỉ với sở thích ĐÃ TỪNG
   *  resolve nên có trong cache. Trường này lấp đúng phần còn lại: sở thích
   *  mới toanh, chưa từng chạy, chưa có trong cache.
   *
   *  null = Meta không trả tên tiếng Anh cho id đó — KHÔNG suy ra tên bằng cách
   *  dịch máy hay đoán. */
  interestNameEn: string | null;
  /** Số ad set đã từng dùng sở thích này. */
  adSetCount: number;
  spend: number;
  conversions: number;
  /** null khi chưa có conversion nào — KHÔNG phải 0. Chia cho 0 rồi hiển thị
   *  "0đ/kết quả" là biến "chưa đo được" thành "rẻ vô địch". */
  cpl: number | null;
  /** Tên ad set gần nhất dùng sở thích này — để người đọc truy lại được. */
  sampleAdSets: string[];
  /**
   * Số sở thích khác có số liệu Y HỆT — nghĩa là chúng LUÔN chạy chung ad set
   * với nhau, nên phép chia đều gán cho mỗi cái đúng một phần bằng nhau.
   *
   * Đây không phải lỗi tính toán, mà là giới hạn của dữ liệu: không tách được
   * công của từng sở thích trong một nhóm luôn đi cùng nhau. Dữ liệu thật
   * 25/08 có 7 sở thích tài chính/đầu tư cùng ra CPL 35.886đ — ai đọc lướt sẽ
   * tưởng đó là bảy bằng chứng độc lập, trong khi nó là MỘT quan sát lặp lại
   * bảy lần. Phải nói ra, nếu không con số này bị đọc quá tay.
   */
  coOccurringWith: number;
}

export interface AudiencePerformanceReport {
  generatedAt: string;
  days: number;
  /** Số ad set đọc được targeting VÀ có số liệu. */
  adSetsAnalyzed: number;
  /** Ad set có chi tiêu nhưng KHÔNG đọc được sở thích (Advantage+ broad, hoặc
   *  targeting không có flexible_spec). Nói ra để không ai tưởng đây là toàn
   *  cảnh chi tiêu. */
  adSetsWithoutInterests: number;
  interests: InterestPerformance[];
  /** Số sở thích lấy được tên tiếng Anh ở lượt dựng này. */
  englishNamesResolved?: number;
  error: string | null;
}

interface CacheShape { [key: string]: AudiencePerformanceReport }

async function readCache(): Promise<CacheShape> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf-8")) as CacheShape;
  } catch {
    return {};
  }
}

function isFresh(r: AudiencePerformanceReport | undefined): boolean {
  return Boolean(r) && Date.now() - new Date(r!.generatedAt).getTime() < TTL_MS;
}

function normalizeName(v: string): string {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/** Ad set MỌI trạng thái + targeting. Bản trong meta-client chỉ lấy ACTIVE —
 *  lịch sử hiệu quả thì phần lớn nằm ở ad set đã tắt, nên phải lấy cả. */
async function fetchAllAdSetsWithTargeting(): Promise<Array<{ id: string; name: string; targeting?: unknown }>> {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!accountId || !token) return [];

  const url = new URL(`${META_BASE}/act_${accountId}/adsets`);
  url.searchParams.set("fields", "id,name,targeting");
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", token);

  const out: Array<{ id: string; name: string; targeting?: unknown }> = [];
  let next: string | null = url.toString();
  for (let page = 0; next && page < 10; page++) {
    const res = await graphFetch(next, { signal: AbortSignal.timeout(20_000) });
    const json = (await res.json()) as {
      data?: Array<{ id: string; name: string; targeting?: unknown }>;
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

/** Rút id+tên sở thích từ khối targeting của Meta. */
function extractInterests(targeting: unknown): Array<{ id: string; name: string }> {
  const t = targeting as { flexible_spec?: Array<{ interests?: Array<{ id?: string; name?: string }> }>; interests?: Array<{ id?: string; name?: string }> } | undefined;
  if (!t) return [];
  const groups = [
    ...(t.flexible_spec ?? []),
    ...(t.interests ? [{ interests: t.interests }] : []),
  ];
  const out: Array<{ id: string; name: string }> = [];
  for (const g of groups) {
    for (const i of g.interests ?? []) {
      if (i?.id) out.push({ id: String(i.id), name: String(i.name ?? i.id) });
    }
  }
  return out;
}

function sumConversions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  return (actions as Array<{ action_type?: string; value?: string }>)
    .filter((a) => a.action_type && CONVERSION_ACTIONS.includes(a.action_type))
    .reduce((s, a) => s + (parseFloat(a.value ?? "0") || 0), 0);
}

/**
 * Lấy tên tiếng Anh cho một lô id sở thích. MỘT lượt gọi cho tối đa 50 id.
 *
 * Dùng `adinterestvalid` với locale=en_US — cùng endpoint mà resolve-interests
 * đã dùng để xác thực id, chỉ khác locale. Không phát minh endpoint mới.
 *
 * Hỏng hoặc không trả tên thì trả về Map RỖNG, không ném: đây là lớp làm đẹp
 * cho việc khớp tên, không phải điều kiện cần của báo cáo.
 */
async function fetchEnglishNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || ids.length === 0) return out;

  const chunk = ids.filter((id) => /^\d+$/.test(id)).slice(0, 50);
  if (chunk.length === 0) return out;

  try {
    const params = new URLSearchParams({
      type: "adinterestvalid",
      interest_fbid_list: JSON.stringify(chunk),
      locale: "en_US",
      access_token: token,
    });
    const res = await graphFetch(`${META_BASE}/search?${params}`, { signal: AbortSignal.timeout(20_000) });
    const json = (await res.json()) as { data?: Array<{ id?: string | number; name?: string }>; error?: { message?: string } };
    if (json.error) {
      log.warn("audience_performance", `Không lấy được tên tiếng Anh: ${json.error.message}`);
      return out;
    }
    for (const row of json.data ?? []) {
      if (row.id && typeof row.name === "string" && row.name.trim()) {
        out.set(String(row.id), row.name.trim());
      }
    }
  } catch (err) {
    log.warn("audience_performance", "Lỗi khi lấy tên tiếng Anh", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

export interface PromptCandidates {
  /** Sở thích rẻ nhất đã đo được — ứng viên ưu tiên. */
  best: Array<{ id: string; name: string; nameEn: string | null; cpl: number; conversions: number }>;
  /** Sở thích ĐẮT nhất — dạy AI tránh, quan trọng ngang danh sách tốt. */
  worst: Array<{ id: string; name: string; nameEn: string | null; cpl: number; conversions: number }>;
  /** Bao nhiêu sở thích bị loại vì chưa đủ dữ liệu để kết luận. */
  excludedForLowVolume: number;
  medianCpl: number | null;
}

/** Ngưỡng tối thiểu để một con CPL được coi là bằng chứng, không phải nhiễu.
 *  Một sở thích chạy 3 lần rồi tình cờ ra 2 kết quả sẽ cho CPL đẹp long lanh mà
 *  không nói lên điều gì — đưa vào prompt là dạy AI học từ tiếng ồn. */
const MIN_CONVERSIONS_FOR_EVIDENCE = 20;
const MIN_SPEND_FOR_EVIDENCE = 1_000_000;

/**
 * Chọn ứng viên để nạp vào prompt sinh phân khúc.
 *
 * Ba lớp lọc, mỗi lớp chặn một kiểu kết luận sai:
 *  1. Đủ khối lượng — CPL của mẫu nhỏ là nhiễu, không phải bằng chứng.
 *  2. Bỏ nhóm luôn-đi-cùng-nhau (coOccurringWith > 0) — bảy sở thích tài chính
 *     cùng ra CPL 35.886đ là MỘT quan sát lặp lại bảy lần; nạp cả bảy vào prompt
 *     sẽ khiến AI tưởng đó là bảy bằng chứng độc lập và dồn hết về nhóm đó.
 *  3. Chỉ lấy hai đầu — giữa bảng thì chênh lệch không đủ để nói lên điều gì.
 */
export function selectPromptCandidates(report: AudiencePerformanceReport | null, take = 8): PromptCandidates | null {
  if (!report || report.error || report.interests.length === 0) return null;

  const eligible = report.interests.filter(
    (i) =>
      i.cpl !== null &&
      i.conversions >= MIN_CONVERSIONS_FOR_EVIDENCE &&
      i.spend >= MIN_SPEND_FOR_EVIDENCE &&
      (i.coOccurringWith ?? 0) === 0,
  );
  if (eligible.length < 4) return null; // quá ít để so sánh có nghĩa

  const sorted = [...eligible].sort((a, b) => (a.cpl as number) - (b.cpl as number));
  const mid = sorted[Math.floor(sorted.length / 2)];

  return {
    best: sorted.slice(0, take).map((i) => ({ id: i.interestId, name: i.interestName, nameEn: i.interestNameEn ?? null, cpl: i.cpl as number, conversions: i.conversions })),
    worst: sorted.slice(-take).reverse().map((i) => ({ id: i.interestId, name: i.interestName, nameEn: i.interestNameEn ?? null, cpl: i.cpl as number, conversions: i.conversions })),
    excludedForLowVolume: report.interests.length - eligible.length,
    medianCpl: mid?.cpl ?? null,
  };
}

/** Chỉ ĐỌC bản đã lưu, tuyệt đối không gọi Meta.
 *
 *  Tách hàm riêng thay vì thêm một cờ vào buildAudiencePerformance: lời hứa
 *  "mở màn hình không gọi Meta" phải được bảo đảm bằng KIỂU HÀM, không bằng một
 *  tham số boolean mà lần sửa sau có thể truyền nhầm. Trả null = chưa từng dựng
 *  hoặc đã hết hạn — hai chuyện đó UI phải nói khác nhau.
 */
export async function readCachedPerformance(days = 90): Promise<{ report: AudiencePerformanceReport | null; stale: boolean }> {
  const cache = await readCache();
  const r = cache[`d${days}`];
  if (!r) return { report: null, stale: false };
  return { report: r, stale: !isFresh(r) };
}

/**
 * Dựng báo cáo "sở thích nào đã từng ra tiền".
 * CHỈ gọi từ đường có người bấm — hai lượt gọi Meta cho cả tài khoản.
 */
export async function buildAudiencePerformance(days = 90, force = false): Promise<AudiencePerformanceReport> {
  const cacheKey = `d${days}`;
  const cache = await readCache();
  if (!force && isFresh(cache[cacheKey])) return cache[cacheKey];

  const empty: AudiencePerformanceReport = {
    generatedAt: new Date().toISOString(),
    days,
    adSetsAnalyzed: 0,
    adSetsWithoutInterests: 0,
    interests: [],
    englishNamesResolved: 0,
    error: null,
  };

  try {
    // Hai lượt gọi cho TOÀN BỘ tài khoản — không phải mỗi sở thích một lượt.
    const [adSets, insights] = await Promise.all([
      fetchAllAdSetsWithTargeting(),
      metaClient.getAdSetInsightsForAccount({ from: daysAgo(days), to: daysAgo(1) }),
    ]);

    const targetingById = new Map(adSets.map((a) => [a.id, a]));
    const acc = new Map<string, InterestPerformance>();
    let analyzed = 0;
    let withoutInterests = 0;

    for (const row of insights) {
      const spend = parseFloat(row.spend ?? "0") || 0;
      if (spend <= 0) continue;

      const adSet = targetingById.get(row.adset_id);
      const interests = extractInterests(adSet?.targeting);
      if (interests.length === 0) {
        withoutInterests++;
        continue;
      }
      analyzed++;

      const conv = sumConversions(row.actions);
      // Chia đều chi tiêu cho các sở thích trong cùng ad set.
      //
      // Đây là một PHÉP GÁN, không phải phép đo: Meta không nói sở thích nào
      // mang về kết quả nào. Chia đều là cách trung thực nhất khi không biết —
      // nhưng phải nhớ nó là ước lệ, và tuyệt đối không được trình bày như số
      // đo được.
      const share = 1 / interests.length;
      for (const it of interests) {
        const cur = acc.get(it.id) ?? {
          interestId: it.id,
          interestName: it.name,
          interestNameEn: null,
          adSetCount: 0,
          spend: 0,
          conversions: 0,
          cpl: null,
          sampleAdSets: [],
          coOccurringWith: 0,
        };
        cur.adSetCount += 1;
        cur.spend += spend * share;
        cur.conversions += conv * share;
        if (cur.sampleAdSets.length < 3 && row.adset_name) cur.sampleAdSets.push(row.adset_name);
        acc.set(it.id, cur);
      }
    }

    const rounded = [...acc.values()].map((i) => ({
      ...i,
      spend: Math.round(i.spend),
      conversions: Math.round(i.conversions * 10) / 10,
      cpl: i.conversions >= 1 ? Math.round(i.spend / i.conversions) : null,
    }));

    // Đánh dấu nhóm "luôn đi cùng nhau": số liệu trùng khít nghĩa là không tách
    // được công của từng sở thích.
    const bySignature = new Map<string, number>();
    for (const i of rounded) {
      const sig = `${i.adSetCount}|${i.spend}|${i.conversions}`;
      bySignature.set(sig, (bySignature.get(sig) ?? 0) + 1);
    }
    const interests = rounded
      .map((i) => ({
        ...i,
        coOccurringWith: (bySignature.get(`${i.adSetCount}|${i.spend}|${i.conversions}`) ?? 1) - 1,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Lấy tên tiếng Anh — CHỈ cho những sở thích đủ dữ liệu để vào prompt.
    // Một lượt gọi, tối đa 50 id. Không lấy cho cả trăm sở thích: phần đuôi
    // bảng không bao giờ được nạp vào prompt nên tên tiếng Anh của chúng vô ích.
    const candidateIds = interests
      .filter((i) => i.cpl !== null && i.conversions >= MIN_CONVERSIONS_FOR_EVIDENCE && i.spend >= MIN_SPEND_FOR_EVIDENCE)
      .slice(0, 50)
      .map((i) => i.interestId);
    const enNames = await fetchEnglishNames(candidateIds);
    for (const i of interests) {
      const en = enNames.get(i.interestId);
      // Chỉ ghi khi tên tiếng Anh KHÁC tên đang có — trùng nhau thì không thêm
      // được gì, giữ null để nhìn vào biết ngay chỗ nào thật sự song ngữ.
      if (en && normalizeName(en) !== normalizeName(i.interestName)) i.interestNameEn = en;
    }

    const report: AudiencePerformanceReport = {
      generatedAt: new Date().toISOString(),
      days,
      adSetsAnalyzed: analyzed,
      adSetsWithoutInterests: withoutInterests,
      interests,
      /** Bao nhiêu sở thích lấy được tên tiếng Anh — 0 nghĩa là endpoint không
       *  trả tên, và việc khớp tên sẽ vẫn trượt với sở thích chưa có trong cache. */
      englishNamesResolved: [...enNames.keys()].length,
      error: null,
    };

    await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await withFileLock(CACHE_FILE, async () => {
      const c = await readCache();
      c[cacheKey] = report;
      await writeFileAtomic(CACHE_FILE, JSON.stringify(c));
    });

    log.info("audience_performance", `Dựng báo cáo từ ${analyzed} ad set`, {
      days, interests: interests.length, withoutInterests,
    });
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("audience_performance", `Không dựng được báo cáo: ${message}`, { days });
    // Trả lỗi RÕ, không trả danh sách rỗng — rỗng đọc thành "chưa sở thích nào
    // từng chạy", một câu hoàn toàn khác.
    return { ...empty, error: message };
  }
}
