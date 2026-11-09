// ============================================================
// Audience Optimizer — Analyze Current Targeting + AI Interests
// POST /api/automation/audience/analyze
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { verifyMetaCampaignAccess } from "@/lib/meta-campaign-company";
import { callGemini, extractJSON } from "@/lib/gemini";
import { buildInterestPrompt } from "@/lib/audience-interest-prompt";
import { isSupportedBucket } from "@/lib/audience-targeting-merge";
import { pickBestMatch } from "@/lib/audience-name-match";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const META_BASE = META_GRAPH_BASE;

// Simple in-process cache — avoids repeated Meta API calls for same campaign
const adsetCache = new Map<string, { data: AdsetTargeting[]; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Caches the FULL analyze response (including resolved interest
// suggestions, the most call-heavy part — up to ~2x6 Meta calls) so
// re-clicking "Phân tích" for the same campaign within the TTL costs 0
// extra Meta requests instead of re-running the whole burst.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resultCache = new Map<string, { data: any; expiresAt: number }>();

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface InterestItem {
  name: string;
  category: string;
  reason: string;
  /** Ai nghĩ ra gợi ý này. Trước đây cả khối đều dán nhãn "AI" trong khi phần
   *  lớn là của Meta — người đọc không có cách nào biết. */
  source?: "ai" | "meta";
  /** AI dựa vào ĐÂU để nói câu đó: kho sản phẩm / targeting hiện tại / phân
   *  khúc người dùng ghi nhận / suy luận ngành. */
  basis?: string;
  /** Ô trong flexible_spec sẽ ghi vào: interests | behaviors | work_positions…
   *  Thiếu = interests. Đây là thứ quyết định NHẮM ĐÚNG hay nhắm nhầm tệp. */
  targetingType?: string;
  // Resolved from Meta Interest Search API
  metaId?: string;
  metaName?: string;
  audienceSize?: number;
  path?: string[];
  resolved?: boolean;
}

// ─────────────────────────────────────────────
// Meta API helper
// ─────────────────────────────────────────────

async function metaGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${META_BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  console.log(`[AnalyzeAPI] GET ${path}`, Object.keys(params));
  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    console.error(`[AnalyzeAPI] Meta error:`, data.error);
    throw new Error(data.error.message);
  }
  return data as T;
}

// ─────────────────────────────────────────────
// Fetch adsets with full targeting details
// ─────────────────────────────────────────────

interface AdsetTargeting {
  id: string;
  name: string;
  status: string;
  targeting: {
    age_min?: number;
    age_max?: number;
    genders?: number[];
    geo_locations?: {
      countries?: string[];
      cities?: Array<{ key: string; name: string }>;
      regions?: Array<{ key: string; name: string }>;
    };
    flexible_spec?: Array<{
      interests?: Array<{ id: string; name: string }>;
      behaviors?: Array<{ id: string; name: string }>;
    }>;
    exclusions?: Record<string, unknown>;
    publisher_platforms?: string[];
    facebook_positions?: string[];
    instagram_positions?: string[];
    device_platforms?: string[];
    [key: string]: unknown;
  };
  daily_budget?: string;
  lifetime_budget?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isRateLimit = (msg: string) =>
  msg.includes("User request limit") || msg.includes("rate limit") ||
  msg.includes("(#17)") || msg.includes("(#32)") || msg.includes("Too many calls");

async function getAdsetsWithTargeting(campaignId: string, token: string): Promise<AdsetTargeting[]> {
  // Return cached result if still fresh
  const cached = adsetCache.get(campaignId);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[AnalyzeAPI] Cache hit for campaign ${campaignId}`);
    return cached.data;
  }

  // Retry with exponential backoff on rate-limit errors
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = attempt * 4000; // 4s, 8s
        console.log(`[AnalyzeAPI] Retry ${attempt}/${MAX_RETRIES - 1} after ${waitMs}ms...`);
        await sleep(waitMs);
      }

      console.log(`[AnalyzeAPI] Fetching adsets for campaign ${campaignId} (attempt ${attempt + 1})`);
      const data = await metaGet<{ data: AdsetTargeting[] }>(
        `/${campaignId}/adsets`,
        token,
        {
          fields: "id,name,status,targeting,daily_budget,lifetime_budget",
          limit: "50",
        }
      );
      const adsets = data.data ?? [];
      console.log(`[AnalyzeAPI] ✅ Got ${adsets.length} adsets`);
      adsetCache.set(campaignId, { data: adsets, expiresAt: Date.now() + CACHE_TTL_MS });
      return adsets;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[AnalyzeAPI] ❌ Attempt ${attempt + 1} failed:`, errMsg);

      if (errMsg.includes("Invalid OAuth") || errMsg.includes("access token") || errMsg.includes("(#190)")) {
        throw new Error("Token Meta hết hạn. Vui lòng cập nhật lại token trong Settings.");
      }

      if (isRateLimit(errMsg)) {
        if (attempt < MAX_RETRIES - 1) continue; // retry
        throw new Error("Meta API đang giới hạn request. Vui lòng đợi vài phút rồi thử lại.");
      }

      throw new Error(`Không lấy được targeting: ${errMsg}`);
    }
  }

  throw new Error("Meta API đang giới hạn request. Vui lòng đợi vài phút rồi thử lại.");
}

// ─────────────────────────────────────────────
// Build targeting summary
// ─────────────────────────────────────────────

function buildTargetingSummary(adsets: AdsetTargeting[]) {
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  const target = activeAdsets.length > 0 ? activeAdsets : adsets;
  if (target.length === 0) return null;

  // Aggregate targeting from all relevant adsets
  const ageRanges = new Set<string>();
  const genders = new Set<string>();
  const countries = new Set<string>();
  const cities = new Set<string>();
  const interests: Array<{ id: string; name: string }> = [];
  const behaviors: Array<{ id: string; name: string }> = [];
  const platforms = new Set<string>();
  const fbPositions = new Set<string>();
  const igPositions = new Set<string>();
  const devices = new Set<string>();

  const seenInterestIds = new Set<string>();

  for (const adset of target) {
    const t = adset.targeting;
    if (!t) continue;

    // Age
    const ageMin = t.age_min ?? 18;
    const ageMax = t.age_max ?? 65;
    ageRanges.add(`${ageMin}-${ageMax}`);

    // Gender
    if (t.genders && t.genders.length > 0) {
      for (const g of t.genders) {
        genders.add(g === 1 ? "male" : g === 2 ? "female" : "unknown");
      }
    } else {
      genders.add("all");
    }

    // Geo
    if (t.geo_locations?.countries) {
      t.geo_locations.countries.forEach((c) => countries.add(c));
    }
    if (t.geo_locations?.cities) {
      t.geo_locations.cities.forEach((c) => cities.add(c.name));
    }

    // Interests + Behaviors
    if (t.flexible_spec) {
      for (const spec of t.flexible_spec) {
        if (spec.interests) {
          for (const interest of spec.interests) {
            if (!seenInterestIds.has(interest.id)) {
              seenInterestIds.add(interest.id);
              interests.push(interest);
            }
          }
        }
        if (spec.behaviors) {
          for (const behavior of spec.behaviors) {
            if (!seenInterestIds.has(behavior.id)) {
              seenInterestIds.add(behavior.id);
              behaviors.push(behavior);
            }
          }
        }
      }
    }

    // Platforms & Positions
    if (t.publisher_platforms) {
      t.publisher_platforms.forEach((p) => platforms.add(p));
    }
    if (t.facebook_positions) {
      t.facebook_positions.forEach((p) => fbPositions.add(p));
    }
    if (t.instagram_positions) {
      t.instagram_positions.forEach((p) => igPositions.add(p));
    }
    if (t.device_platforms) {
      t.device_platforms.forEach((d) => devices.add(d));
    }
  }

  const isBroadTargeting = interests.length === 0 && behaviors.length === 0;

  // Country name mapping
  const countryNames: Record<string, string> = {
    VN: "Việt Nam",
    US: "Hoa Kỳ",
    TH: "Thái Lan",
    SG: "Singapore",
    MY: "Malaysia",
    JP: "Nhật Bản",
  };

  return {
    ageRanges: Array.from(ageRanges),
    genders: Array.from(genders),
    locations: {
      countries: Array.from(countries).map((c) => countryNames[c] ?? c),
      cities: Array.from(cities),
    },
    interests,
    behaviors,
    isBroadTargeting,
    placements: {
      platforms: Array.from(platforms),
      facebookPositions: Array.from(fbPositions),
      instagramPositions: Array.from(igPositions),
    },
    devices: Array.from(devices),
    adsetCount: target.length,
    activeCount: activeAdsets.length,
  };
}

// ─────────────────────────────────────────────
// Meta Native Interest Suggestions (adinterestsuggestion)
// Uses existing interest IDs → Meta returns related valid interests
// These are guaranteed to exist in Meta's system
// ─────────────────────────────────────────────

// Những nhánh Meta hay trả về cho MỌI chiến dịch, bất kể bán gì: người dùng
// thiết bị di động, sắp tới sinh nhật, hay đi du lịch, ngoại kiều... Chúng hợp
// lệ về mặt kỹ thuật nhưng không nói gì về sản phẩm, nên chiến dịch nào phân
// tích cũng ra y hệt — đúng hiện tượng người dùng báo ngày 16/09/2026.
//
// Chặn theo NHÁNH (path) chứ không theo tên, và kèm cả bản tiếng Anh vì `path`
// trả về theo ngôn ngữ của lời gọi — chỉ chặn tiếng Việt thì đổi ngôn ngữ một
// cái là nhiễu quay lại mà không ai biết.
const GENERIC_META_PATHS = [
  "nguoi dung thiet bi di dong", "mobile device users",
  "su kien trong doi", "life events",
  "ngoai kieu", "expats",
  "du lich", "travel",
];

function normalizePath(path: string[] | undefined): string {
  return (path ?? []).join(" > ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/** true = nhánh chung chung, chiến dịch nào cũng gợi ra. */
function isGenericMetaInterest(path: string[] | undefined): boolean {
  const flat = normalizePath(path);
  if (!flat) return false;
  return GENERIC_META_PATHS.some(g => flat.includes(g));
}

async function getMetaInterestSuggestions(
  existingInterestIds: string[],
  token: string
): Promise<InterestItem[]> {
  if (existingInterestIds.length === 0) return [];

  try {
    // Meta API: GET /search?type=adinterestsuggestion&interest_list=["id1","id2"]
    const url = new URL(`${META_BASE}/search`);
    url.searchParams.set("type", "adinterestsuggestion");
    url.searchParams.set("interest_list", JSON.stringify(existingInterestIds.slice(0, 5)));
    url.searchParams.set("limit", "8");
    url.searchParams.set("access_token", token);

    const res = await fetch(url.toString());
    const data = await res.json() as { data?: MetaInterestSearchResult[] };

    if (!data.data || data.data.length === 0) return [];

    // Filter out interests already in existing (by ID)
    const existingSet = new Set(existingInterestIds);
    return data.data
      .filter(item => !existingSet.has(item.id))
      // Bỏ nhánh chung chung TRƯỚC khi cắt 6 — lọc sau khi cắt thì 6 suất đã
      // bị mấy mục vô nghĩa chiếm hết, còn mục dùng được thì rơi mất.
      .filter(item => !isGenericMetaInterest(item.path))
      .slice(0, 6)
      .map(item => ({
        name: item.name,
        category: "Meta Suggestion",
        reason: `Gợi ý từ Meta dựa trên targeting hiện tại${item.audience_size_lower_bound ? ` · Reach: ${item.audience_size_lower_bound >= 1_000_000 ? (item.audience_size_lower_bound / 1_000_000).toFixed(1) + "M" : Math.round(item.audience_size_lower_bound / 1000) + "K"}+` : ""}`,
        source: "meta" as const,
        metaId: item.id,
        metaName: item.name,
        audienceSize: item.audience_size_lower_bound,
        path: item.path,
        resolved: true,
      }));
  } catch (err) {
    console.warn("[MetaSuggestions] Failed (non-blocking):", err);
    return [];
  }
}

// ─────────────────────────────────────────────
// AI Interest Suggestions via Gemini
// ─────────────────────────────────────────────

/**
 * Gợi ý interest bằng AI — có CĂN CỨ, và ổn định.
 *
 * Bản cũ chỉ đưa cho AI: tên campaign + objective + phân khúc người dùng gõ.
 * Ba dữ kiện đó gần như giống nhau giữa các chiến dịch cùng tài khoản, nên gợi
 * ý cũng na ná nhau — và vì nhiệt độ 0.5 nên mỗi lần bấm lại đổi một ít, vừa
 * lặp lại vừa không ổn định. Bản này đổi cả hai vế:
 *
 *   • ĐẦU VÀO: thêm kho kiến thức sản phẩm (suy từ TÊN chiến dịch, xem
 *     lib/products-from-campaign.ts) + toàn bộ targeting đang chạy. Hai chiến
 *     dịch bán hai sản phẩm khác nhau giờ có đầu vào khác nhau thật, nên đầu ra
 *     mới khác nhau được.
 *   • NHIỆT ĐỘ 0: cùng một chiến dịch, targeting không đổi thì bấm bao nhiêu
 *     lần cũng ra cùng một danh sách. Khác biệt đến từ dữ liệu chiến dịch, KHÔNG
 *     phải từ ngẫu nhiên của mô hình — đó mới là "ổn định".
 */
async function suggestInterests(
  geminiKey: string,
  campaignName: string,
  objective: string,
  topSegment: string,
  topSegmentReason: string,
  currentInterests: string[],
  summary: ReturnType<typeof buildTargetingSummary>,
): Promise<InterestItem[]> {

  const prompt = buildInterestPrompt({
    campaignName, objective, topSegment, topSegmentReason, currentInterests, summary,
  });

  try {
    const geminiRes = await callGemini(
      prompt,
      // temperature 0: cùng đầu vào → cùng đầu ra. Gợi ý khác nhau phải đến từ
      // chiến dịch khác nhau, không phải từ may rủi của lần bấm.
      { temperature: 0, maxOutputTokens: 1200, responseMimeType: "application/json", thinkingBudget: 0 },
      geminiKey,
    );
    const parsed = extractJSON(geminiRes.text);
    if (!Array.isArray(parsed)) return [];

    // Chặn lần cuối ở PHÍA MÌNH: luật số 1 trong prompt chỉ là lời dặn, mô hình
    // vẫn có thể gợi lại interest đang chạy. So khớp bỏ dấu + bỏ hoa thường.
    const running = new Set([
      ...currentInterests,
      ...(summary?.behaviors ?? []).map(b => b.name),
    ].map(i => String(i).trim().toLowerCase()));
    return (parsed as InterestItem[])
      .filter(item => item?.name && !running.has(String(item.name).trim().toLowerCase()))
      .map(item => ({ ...item, source: "ai" as const }));
  } catch (err) {
    console.error("[InterestSuggestions] AI parse error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────
// Resolve AI-suggested keywords → real Meta Interest IDs
// Uses Graph API /search?type=adinterest
// ─────────────────────────────────────────────

interface MetaInterestSearchResult {
  id: string;
  name: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
  description?: string;
}

// ─────────────────────────────────────────────
// Danh mục Hành vi + Nhân khẩu học của Meta
// ─────────────────────────────────────────────
// /search?type=adinterest CHỈ tìm trong Sở thích. Vì vậy những đề xuất đúng
// nhưng thuộc loại khác — "Facebook Page Admins" (Hành vi), "Chief Executive
// Officer" (Chức danh) — luôn trượt, và người dùng thấy thẻ "Không tìm được
// Interest ID" (phản hồi 16/09/2026).
//
// Meta không cho tìm theo từ khoá trong hai nhóm này, nhưng cho DUYỆT toàn bộ
// danh mục. Danh mục chỉ vài trăm mục và gần như không đổi, nên tải một lần rồi
// so khớp tại chỗ — vừa tránh phụ thuộc vào thứ Meta không hứa, vừa đỡ mỗi đề
// xuất một lời gọi.
//
// Hỏng thì trả về rỗng, KHÔNG ném lỗi: mất thêm loại mới, quay về đúng hành vi
// cũ (chỉ Sở thích), không làm hỏng cả trang.

interface CatalogueEntry {
  id: string;
  name: string;
  /** Tên ô trong flexible_spec: behaviors, work_positions, industries… */
  type: string;
  path?: string[];
  audience_size_lower_bound?: number;
}

let catalogueCache: { entries: CatalogueEntry[]; expiresAt: number } | null = null;
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeName(s: string): string {
  return (s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function getTargetingCatalogue(token: string): Promise<CatalogueEntry[]> {
  if (catalogueCache && catalogueCache.expiresAt > Date.now()) return catalogueCache.entries;

  const entries: CatalogueEntry[] = [];
  for (const cls of ["behaviors", "demographics"]) {
    try {
      const url = new URL(`${META_BASE}/search`);
      url.searchParams.set("type", "adTargetingCategory");
      url.searchParams.set("class", cls);
      url.searchParams.set("limit", "1000");
      url.searchParams.set("access_token", token);
      const res = await fetch(url.toString());
      const data = await res.json() as { data?: CatalogueEntry[]; error?: { message?: string } };
      if (data.error) {
        console.warn(`[Catalogue] Meta từ chối class=${cls}:`, data.error.message);
        continue;
      }
      for (const e of data.data ?? []) {
        if (e?.id && e?.name && e?.type) entries.push(e);
      }
    } catch (err) {
      console.warn(`[Catalogue] tải class=${cls} hỏng (không chặn):`, err);
    }
  }

  console.log(`[Catalogue] tải được ${entries.length} mục Hành vi + Nhân khẩu học`);
  // Chỉ cache khi lấy được thật. Cache một danh mục rỗng nghĩa là hỏng suốt 24h.
  if (entries.length > 0) {
    catalogueCache = { entries, expiresAt: Date.now() + CATALOGUE_TTL_MS };
  }
  return entries;
}

/**
 * Tìm một tên trong danh mục. Khớp CHÍNH XÁC trước, sau đó mới chấp nhận
 * "chứa" — và chỉ với tên đủ dài. Khớp lỏng với tên ngắn là cách chắc chắn để
 * "CEO" dính vào một mục hoàn toàn khác rồi nhắm nhầm tệp.
 */
function findInCatalogue(name: string, entries: CatalogueEntry[]): CatalogueEntry | null {
  if (normalizeName(name).length < 3) return null;
  // Dùng CHUNG bộ chấm điểm với nhánh Sở thích (lib/audience-name-match) thay
  // vì một luật "chứa nhau" riêng — hai luật khác nhau cho cùng một việc thì
  // sớm muộn cũng lệch, và lệch ở đây nghĩa là nhắm nhầm tệp.
  return pickBestMatch(name, entries)?.item ?? null;
}

async function resolveMetaInterestIds(
  suggestions: InterestItem[],
  token: string
): Promise<InterestItem[]> {
  const results: InterestItem[] = [];

  // Tải một lần cho cả mẻ, không phải mỗi đề xuất một lần.
  const catalogue = await getTargetingCatalogue(token);

  // Serial resolution with small delay to avoid rate limiting
  for (const item of suggestions) {
    await sleep(300); // 300ms between calls → ~3 calls/sec, well under Meta's limit
    try {
      // Hỏi bằng en_US CÓ CHỦ Ý: prompt xin tên tiếng Anh, mà Meta trả tên theo
      // ngôn ngữ của lời gọi. Không ghim ngôn ngữ thì nhận về tên tiếng Việt và
      // không còn cách nào so xem nó có đúng thứ mình hỏi không — đúng chỗ đã
      // để lọt "Software developer" → "Hãng phát triển trò chơi điện tử".
      const searchInterest = async (locale: string): Promise<MetaInterestSearchResult | null> => {
        const url = new URL(`${META_BASE}/search`);
        url.searchParams.set("type", "adinterest");
        url.searchParams.set("q", item.name);
        // Lấy nhiều ứng viên rồi tự chấm, thay vì tin kết quả đầu tiên.
        url.searchParams.set("limit", "10");
        url.searchParams.set("locale", locale);
        url.searchParams.set("access_token", token);
        const res = await fetch(url.toString());
        const data = await res.json() as { data?: MetaInterestSearchResult[] };
        const picked = pickBestMatch(item.name, data.data ?? []);
        if (!picked) {
          if ((data.data ?? []).length > 0) {
            console.log(`[Resolve] "${item.name}" → Meta trả "${data.data![0].name}" nhưng lệch quá, bỏ.`);
          }
          return null;
        }
        return picked.item;
      };

      // suggestInterests()'s prompt explicitly asks Gemini for English
      // interest names ("tên tiếng Anh") — searching vi_VN first for an
      // English term almost never matches, so the old vi_VN-then-fallback
      // order was doubling Meta calls in the common case. No-locale first
      // (matches the term's actual language) halves that; vi_VN is now
      // only a fallback for the rare non-English suggestion.
      let best = await searchInterest("en_US");
      // Tên không phải tiếng Anh (hiếm) thì thử tiếng Việt — vẫn qua bộ chấm.
      if (!best) best = await searchInterest("vi_VN");

      if (best) {
        results.push({
          ...item,
          metaId: best.id,
          metaName: best.name,
          audienceSize: best.audience_size_lower_bound,
          path: best.path,
          targetingType: "interests",
          resolved: true,
        });
        continue;
      }

      // Không có trong Sở thích → thử Hành vi / Nhân khẩu học. Chỉ nhận loại
      // ghi được vào flexible_spec; loại khác (vd relationship_statuses nằm ở
      // tầng trên) thì coi như không tra được, còn hơn ghi sai ô.
      const hit = findInCatalogue(item.name, catalogue);
      if (hit && isSupportedBucket(hit.type)) {
        results.push({
          ...item,
          metaId: hit.id,
          metaName: hit.name,
          audienceSize: hit.audience_size_lower_bound,
          path: hit.path,
          targetingType: hit.type,
          resolved: true,
        });
      } else {
        if (hit) {
          console.log(`[Resolve] "${item.name}" khớp "${hit.name}" nhưng loại "${hit.type}" không ghi được vào flexible_spec — bỏ.`);
        }
        results.push({ ...item, resolved: false });
      }
    } catch {
      results.push({ ...item, resolved: false });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: friendlyError("META_ACCESS_TOKEN not configured") }, { status: 401 });
  }

  let body: {
    campaignId: string;
    campaignName?: string;
    objective?: string;
    topSegment?: string;
    topSegmentReason?: string;
    suggestInterests?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.campaignId) {
    return NextResponse.json({ success: false, error: "campaignId is required" }, { status: 400 });
  }

  // Route này đọc toàn bộ targeting của campaign rồi gọi Gemini phân tích. Trước
  // đây chỉ kiểm đăng nhập: ai đăng nhập cũng đọc được campaign của công ty kia
  // chỉ bằng cách gửi ID, và mỗi lần gọi là một lượt Gemini + vài lượt Meta API.
  // Xác minh theo ID, không theo campaignName client gửi kèm.
  const access = await verifyMetaCampaignAccess(
    body.campaignId, (c) => canAccessCompany(user, c),
  );
  if (!access.allowed) {
    return NextResponse.json({ success: false, error: access.error ?? "Access denied for this company" }, { status: 403 });
  }

  const cacheKey = `${body.campaignId}:${body.suggestInterests ? 1 : 0}:${body.topSegment ?? ""}`;
  const cachedResult = resultCache.get(cacheKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    console.log(`[AnalyzeAPI] Full-result cache hit for ${cacheKey}`);
    return NextResponse.json(cachedResult.data);
  }

  try {
    // 1. Fetch adsets with targeting details
    const adsets = await getAdsetsWithTargeting(body.campaignId, token);
    const summary = buildTargetingSummary(adsets);

    if (!summary) {
      return NextResponse.json({
        success: false,
        error: "Không tìm thấy adset nào trong campaign này",
      }, { status: 404 });
    }

    // 2. Sinh gợi ý interest (hỏng cũng không chặn phần phân tích targeting)
    //
    // ĐÃ ĐỔI THỨ TỰ 16/09/2026. Trước đây: lấy gợi ý của Meta trước, và CHỈ gọi
    // AI khi Meta trả về ít hơn 4 mục VÀ người dùng có gõ ô "phân khúc hiệu quả
    // nhất". Trên thực tế Meta luôn trả đủ 6, nên AI gần như chưa bao giờ chạy —
    // toàn bộ khối mang tiêu đề "Gợi ý interests từ AI" thực chất là danh sách
    // của Meta, mà danh sách đó chỉ phụ thuộc vào interest đang có. Các chiến
    // dịch dùng chung bộ interest nền → gợi ý giống hệt nhau, lặp đi lặp lại.
    //
    // Nay: AI LUÔN chạy và đứng trước (nó là bên duy nhất biết chiến dịch đang
    // bán gì), Meta xuống sau và chỉ để bổ sung.
    let interestSuggestions: InterestItem[] = [];
    // Số gợi ý AI bị loại vì Facebook không có — hiện lên UI cho minh bạch,
    // thay vì âm thầm bỏ rồi người dùng tưởng AI chỉ nghĩ ra được vài cái.
    let aiDropped = 0;

    if (body.suggestInterests) {
      // Bước A — AI, có căn cứ sản phẩm + targeting đang chạy.
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          const rawSuggestions = await suggestInterests(
            geminiKey,
            body.campaignName ?? body.campaignId,
            body.objective ?? "",
            // topSegment nay là TÙY CHỌN, không còn là điều kiện chặn: ô này
            // người dùng thường để trống, và để trống không có nghĩa là không
            // cần gợi ý.
            body.topSegment ?? "",
            body.topSegmentReason ?? "",
            summary.interests.map((i) => i.name),
            summary,
          );
          const aiResolved = await resolveMetaInterestIds(rawSuggestions, token);

          // Chỉ giữ cái TRA ĐƯỢC ID. Trước đây thẻ không tra được vẫn hiện kèm
          // dòng "Không tìm được Interest ID — không thể áp dụng": người dùng
          // đọc xong không làm gì được, chỉ tốn chỗ và tốn niềm tin (phản hồi
          // 16/09/2026). Bù lại prompt nay xin dư 10 mục để sau khi lọc vẫn đủ.
          const applicable = aiResolved.filter(s2 => s2.resolved && s2.metaId);
          aiDropped = aiResolved.length - applicable.length;

          // Cắt XOAY VÒNG theo nhóm, không cắt thẳng 6 cái đầu. AI trả theo thứ
          // tự Nghề nghiệp → Công nghệ → Hành vi, nên cắt thẳng nghĩa là nhóm
          // cuối bị xoá sạch: mẻ chạy thật 16/09 tra được 9 mục mà 6 mục hiện
          // ra không có lấy một Hành vi nào.
          const byCategory = new Map<string, InterestItem[]>();
          for (const it of applicable) {
            const key = it.category ?? "Khác";
            byCategory.set(key, [...(byCategory.get(key) ?? []), it]);
          }
          const roundRobin: InterestItem[] = [];
          let idx = 0;
          while (roundRobin.length < 6) {
            let tookAny = false;
            for (const list of byCategory.values()) {
              if (idx < list.length && roundRobin.length < 6) {
                roundRobin.push(list[idx]);
                tookAny = true;
              }
            }
            if (!tookAny) break;
            idx++;
          }
          interestSuggestions = roundRobin;
          console.log(`[AnalyzeAPI] AI: xin ${rawSuggestions.length} → tra được ${applicable.length} → giữ ${interestSuggestions.length} (loại ${aiDropped} vì không có trên Facebook)`);
        } catch (aiErr) {
          console.warn("[AnalyzeAPI] AI suggestions failed (non-blocking):", aiErr);
        }
      } else {
        console.warn("[AnalyzeAPI] Thiếu GEMINI_API_KEY — chỉ còn gợi ý của Meta.");
      }

      // Bước B — Meta bổ sung, đã lọc bỏ các nhánh chung chung.
      try {
        const existingIds = summary.interests.map(i => i.id);
        const metaSuggestions = await getMetaInterestSuggestions(existingIds, token);
        const usedMetaIds = new Set(interestSuggestions.map(s => s.metaId).filter(Boolean));
        const usedNames = new Set(interestSuggestions.map(s => s.name.trim().toLowerCase()));
        const newMeta = metaSuggestions.filter(
          s => (!s.metaId || !usedMetaIds.has(s.metaId)) && !usedNames.has(s.name.trim().toLowerCase()),
        );
        interestSuggestions = [...interestSuggestions, ...newMeta];
        console.log(`[AnalyzeAPI] Meta suggestions thêm: ${newMeta.length} → tổng ${interestSuggestions.length}`);
      } catch (metaErr) {
        console.warn("[AnalyzeAPI] Meta suggestions failed:", metaErr);
      }
    }

    const payload = {
      success: true,
      data: {
        targeting: summary,
        interestSuggestions,
        aiDropped,
        adsets: adsets.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
        })),
      },
    };
    resultCache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
