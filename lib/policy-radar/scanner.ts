// ─────────────────────────────────────────────
// Policy Radar — Automated scan (Slice 2)
// Only covers sources marked autoFetchable in source-registry.ts —
// currently the 2 Google Ads sources. Meta's pages return an empty
// JS-rendered shell and need a headless browser this app doesn't run;
// those stay manual (AddPolicyItemDialog) until that's built.
//
// Fetches each source, strips markup to plain text, hashes it, and
// compares against the last snapshot. First run per source only
// establishes a baseline (nothing to compare against yet — no item, no
// notification). A changed hash creates a draft PolicyRadarItem via the
// same addItem() manual-add path uses, for human review — severity and
// affectedAreas still come from the existing rule-based classifyImpact()
// (this module's own stated design goal: severity stays reproducible/
// auditable, never AI-assigned). Gemini is used only to draft the
// title/category/summary text from an old-vs-new diff; on failure or
// unavailability, falls back to a generic draft rather than skipping the
// detection — "something changed, go look" is still real signal even
// without a polished summary.
// ─────────────────────────────────────────────

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { callGemini, callWithTimeout, extractJSON } from "@/lib/gemini";
import { sendSystemAlert } from "@/lib/system-alert";
import { POLICY_RADAR_SOURCES } from "./source-registry";
import { parseFeed, type FeedEntry } from "./feed-parser";
import { addItem } from "./store";
import type {
  PolicyCategory,
  PolicyChangeType,
  PolicyRadarSourceHealth,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "policy-radar-snapshots.json");
const SEEN_FILE = path.join(DATA_DIR, "policy-radar-seen-entries.json");
/** Trần item tạo ra mỗi nguồn mỗi lượt — một feed đổi cấu trúc không được phép
 *  đổ hàng chục mục vào danh sách người ta phải đọc. */
const MAX_NEW_ITEMS_PER_SCAN = 5;
/** Số entryId giữ lại mỗi nguồn: đủ dài để feed không "quên" rồi tạo lại bài cũ. */
const SEEN_IDS_KEPT = 200;
/** Lượt quét đầu của một feed nạp bấy nhiêu bài mới nhất.
 *  Baseline "sạch trơn" đúng ở chỗ không đổ 45 bài cũ vào danh sách, nhưng nó
 *  cũng khiến tính năng im lặng cho tới khi nguồn tình cờ đăng bài tiếp theo —
 *  với lịch quét Thứ 2 & Thứ 5 thì có thể mất cả tuần mới thấy gì. Nạp vài bài
 *  gần nhất là đủ để dùng được ngay mà vẫn không tràn. */
const BASELINE_INGEST = 3;
const TEXT_EXCERPT_LIMIT = 20_000; // chars kept per snapshot — enough for a real diff, bounded storage

interface SourceSnapshot {
  sourceId: string;
  hash: string;
  textExcerpt: string;
  scannedAt: string;
}

const VALID_CATEGORIES: PolicyCategory[] = [
  "policy", "enforcement", "terms", "product_update", "measurement",
  "targeting", "creative", "automation", "account_health",
];
const VALID_CHANGE_TYPES: PolicyChangeType[] = [
  "new_policy", "policy_update", "clarification", "announcement",
  "terms_update", "enforcement_change",
];

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

async function readSnapshots(): Promise<SourceSnapshot[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf-8");
    return JSON.parse(raw) as SourceSnapshot[];
  } catch {
    return [];
  }
}

async function writeSnapshots(snapshots: SourceSnapshot[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2));
}

async function saveSnapshot(next: SourceSnapshot): Promise<void> {
  await withFileLock(SNAPSHOT_FILE, async () => {
    const all = await readSnapshots();
    const idx = all.findIndex((s) => s.sourceId === next.sourceId);
    if (idx >= 0) all[idx] = next; else all.push(next);
    await writeSnapshots(all);
  });
}

// ── Fetch + extract ──

async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AdsCommandPolicyRadar/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  const html = await res.text();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, TEXT_EXCERPT_LIMIT);
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── AI draft (best-effort — never blocks detection on failure) ──

interface DraftedItem {
  title: string;
  category: PolicyCategory;
  changeType: PolicyChangeType;
  summaryShort: string;
  whyItMatters: string;
  tags: string[];
  /** Việc cần làm rút từ chính bài. Rỗng khi AI không đưa được gì cụ thể —
   *  action-mapper vẫn cho câu theo nhóm ảnh hưởng nên mục không bao giờ trống. */
  suggestedActions?: string[];
}

// Gemini hay nhầm hai enum này với nhau — đo thật: với bài "Google Ads language
// targeting changes starting September 2026" nó trả `changeType: "product_update"`,
// vốn là một CATEGORY hợp lệ chứ không phải changeType. Trước đây chỉ cần một
// giá trị lệch là toàn bộ bản nháp bị vứt (kể cả tiêu đề, tóm tắt và việc cần
// làm đã viết đúng), rơi xuống fallback tiếng Anh thô. Phần chữ mới là phần
// đắt; enum thì có mặc định an toàn, nên ép về mặc định thay vì bỏ cả bài.
function coerceCategory(v: unknown): PolicyCategory {
  return VALID_CATEGORIES.includes(v as PolicyCategory) ? (v as PolicyCategory) : "product_update";
}

function coerceChangeType(v: unknown): PolicyChangeType {
  return VALID_CHANGE_TYPES.includes(v as PolicyChangeType) ? (v as PolicyChangeType) : "announcement";
}

function fallbackDraft(source: PolicyRadarSourceHealth): DraftedItem {
  return {
    title: `Nội dung trang thay đổi — ${source.label}`,
    category: "policy",
    changeType: "policy_update",
    summaryShort: `Phát hiện nội dung trang "${source.label}" đã thay đổi so với lần quét trước. AI tóm tắt không khả dụng lúc quét — cần vào link gốc để xem chi tiết.`,
    whyItMatters: "Chưa xác định mức độ ảnh hưởng cụ thể — cần admin đọc trực tiếp nguồn để đánh giá.",
    tags: ["auto-detected"],
  };
}

async function draftFromDiff(
  source: PolicyRadarSourceHealth,
  oldText: string,
  newText: string
): Promise<DraftedItem> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackDraft(source);

  const prompt = `Bạn là chuyên gia chính sách quảng cáo. So sánh nội dung CŨ và MỚI của trang "${source.label}" (${source.url}) — nền tảng ${source.platform === "google_ads" ? "Google Ads" : "Meta"}.

NỘI DUNG CŨ (rút gọn):
${oldText.slice(0, 6000)}

NỘI DUNG MỚI (rút gọn):
${newText.slice(0, 6000)}

Xác định phần thay đổi thực sự đáng chú ý (bỏ qua thay đổi định dạng/UI vặt vãnh, chỉ tập trung nội dung chính sách/thông báo). Trả lời JSON đúng schema, không thêm text ngoài JSON:
{
  "title": string (ngắn gọn, tiếng Việt, mô tả đúng thay đổi),
  "category": một trong ${JSON.stringify(VALID_CATEGORIES)},
  "changeType": một trong ${JSON.stringify(VALID_CHANGE_TYPES)},
  "summaryShort": string (2-3 câu tóm tắt thay đổi),
  "whyItMatters": string (1-2 câu — vì sao đội ngũ ads cần quan tâm),
  "tags": string[] (2-4 từ khóa ngắn)
}`;

  // thinkingBudget: 0 — ĐÂY là lý do mọi mục trên màn hình đều hiện "AI tóm tắt
  // không khả dụng". Thinking token rút từ chính hạn mức maxOutputTokens (xem
  // ghi chú trong lib/gemini.ts và lib/pmax-insights/diagnosis.ts), nên với 600
  // token đầu ra mà bật thinking thì model tiêu hết vào suy nghĩ và trả về
  // rỗng → parse hỏng → rơi xuống fallbackDraft, lần nào cũng vậy.
  const { result, timedOut } = await callWithTimeout(
    () => callGemini(prompt, { temperature: 0.3, maxOutputTokens: 600, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
    20_000
  );

  const parsed = !timedOut && result ? (extractJSON(result.text) as Partial<DraftedItem> | null) : null;
  if (parsed?.title && parsed.summaryShort && parsed.whyItMatters) {
    return {
      title: parsed.title,
      category: coerceCategory(parsed.category),
      changeType: coerceChangeType(parsed.changeType),
      summaryShort: parsed.summaryShort,
      whyItMatters: parsed.whyItMatters,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : ["auto-detected"],
    };
  }
  return fallbackDraft(source);
}

// ── Seen-entry store (chống trùng cho chế độ feed) ──

interface SeenRecord {
  sourceId: string;
  entryIds: string[];
  lastSeenAt: string;
}

async function readSeen(): Promise<SeenRecord[]> {
  await ensureDataDir();
  try {
    return JSON.parse(await fs.readFile(SEEN_FILE, "utf-8")) as SeenRecord[];
  } catch {
    return [];
  }
}

async function saveSeen(sourceId: string, ids: string[]): Promise<void> {
  await withFileLock(SEEN_FILE, async () => {
    const all = await readSeen();
    const idx = all.findIndex((r) => r.sourceId === sourceId);
    const record: SeenRecord = {
      sourceId,
      entryIds: ids.slice(0, SEEN_IDS_KEPT),
      lastSeenAt: new Date().toISOString(),
    };
    if (idx >= 0) all[idx] = record; else all.push(record);
    await ensureDataDir();
    await writeFileAtomic(SEEN_FILE, JSON.stringify(all, null, 2));
  });
}

// ── AI draft cho MỘT bài (khác draftFromDiff: có nội dung bài thật, không phải
// diff của cả trang 1,3 triệu ký tự) ──

async function draftFromEntry(
  source: PolicyRadarSourceHealth,
  entry: FeedEntry,
  budget = 900,
): Promise<DraftedItem & { relevant: boolean }> {
  const base = {
    title: entry.title,
    category: "product_update" as PolicyCategory,
    changeType: "announcement" as PolicyChangeType,
    summaryShort: entry.summary.slice(0, 400) || `Bài mới trên ${source.label}.`,
    whyItMatters: "Chưa có tóm tắt AI — đọc bài gốc để đánh giá ảnh hưởng.",
    tags: ["auto-detected"],
    relevant: true,
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !entry.summary) return base;

  const prompt = `Bạn là chuyên gia vận hành quảng cáo Google Ads/Meta, viết cho đội chạy ads người Việt đang quản lý tài khoản thật.

NGUỒN: ${source.label}
TIÊU ĐỀ: ${entry.title}
NỘI DUNG: ${entry.summary.slice(0, 3500)}

Viết 3 phần theo đúng lối "Mới / Ảnh hưởng / Tối ưu":
- summaryShort = MỚI: thay đổi cụ thể là gì, có mốc thời gian thì nêu đúng mốc trong bài.
- whyItMatters = ẢNH HƯỞNG: tài khoản đang chạy bị tác động ra sao. Nói thẳng loại campaign/tính năng bị ảnh hưởng.
- suggestedActions = TỐI ƯU: 1-3 việc CỤ THỂ rút từ chính bài này, mỗi việc một câu ngắn, bắt đầu bằng động từ.

Quy tắc bắt buộc:
- CHỈ dùng thông tin có trong bài. KHÔNG bịa số liệu, KHÔNG bịa ngày hiệu lực, KHÔNG hứa mức tăng/giảm nào.
- Giữ nguyên tên tính năng/sản phẩm bằng tiếng Anh (Performance Max, AI Max, Search Themes, Merchant Center...), phần diễn giải bằng tiếng Việt.
- Nếu bài không nói rõ phải làm gì, để "suggestedActions" là mảng rỗng — KHÔNG bịa việc cho có.
- Bài không liên quan tới người chạy quảng cáo (tin tiêu dùng, mẹo mua sắm, tin tuyển dụng) → "relevant": false.

Trả JSON đúng schema, không thêm text ngoài JSON:
{
  "relevant": boolean,
  "title": string (tiếng Việt, mô tả đúng thay đổi, giữ tên tính năng nguyên gốc),
  "category": CHỦ ĐỀ của thay đổi — chọn đúng một trong ${JSON.stringify(VALID_CATEGORIES)},
  "changeType": KIỂU thông báo, KHÁC category, đừng dùng lại giá trị của category — chọn đúng một trong ${JSON.stringify(VALID_CHANGE_TYPES)},
  "summaryShort": string (2-3 câu),
  "whyItMatters": string (1-2 câu),
  "suggestedActions": string[] (0-3 câu ngắn),
  "tags": string[] (2-4 từ khóa ngắn)
}`;

  const { result, timedOut } = await callWithTimeout(
    () => callGemini(prompt, { temperature: 0.3, maxOutputTokens: budget, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
    20_000,
  );
  const parsed = !timedOut && result ? (extractJSON(result.text) as (Partial<DraftedItem> & { relevant?: boolean }) | null) : null;
  if (parsed?.title && parsed.summaryShort && parsed.whyItMatters) {
    return {
      title: parsed.title,
      category: coerceCategory(parsed.category),
      changeType: coerceChangeType(parsed.changeType),
      summaryShort: parsed.summaryShort,
      whyItMatters: parsed.whyItMatters,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : ["auto-detected"],
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.filter((a): a is string => typeof a === "string" && a.trim().length > 0).slice(0, 3)
        : [],
      relevant: parsed.relevant !== false,
    };
  }

  // Thử lại đúng MỘT lần với hạn mức rộng hơn.
  //
  // Đo thật trên 6 bài của hai feed: độ trễ chỉ 2–4 giây (trần 20s không phải
  // vấn đề), nhưng độ dài response dao động giữa các lần chạy — cùng một bài
  // lúc thì vừa 900 token, lúc thì `finishReason: MAX_TOKENS` cắt JSON giữa
  // chừng. Trong một lượt quét 6 bài đã bắt được đúng 1 bài rơi fallback kiểu
  // đó. Hỏng không cố định thì thử lại là cách đúng, và một lần gọi thêm chỉ
  // tốn vài giây cho một mục người ta sẽ đọc cả tuần.
  if (budget < 1600) return draftFromEntry(source, entry, 1600);

  return base;
}

// ── Tạo item từ danh sách bài ──

async function ingestEntries(
  source: PolicyRadarSourceHealth,
  entries: FeedEntry[],
): Promise<number> {
  let created = 0;
  for (const entry of entries) {
    const draft = await draftFromEntry(source, entry);
    if (!draft.relevant) continue;
    await addItem({
      platform: source.platform,
      category: draft.category,
      changeType: draft.changeType,
      title: draft.title,
      sourceUrl: entry.link || source.url,
      sourceLabel: source.label,
      sourceType: source.sourceType,
      official: true,
      publishedAt: entry.publishedAt,
      summaryShort: draft.summaryShort,
      whyItMatters: draft.whyItMatters,
      tags: draft.tags,
      aiSuggestedActions: draft.suggestedActions ?? [],
      addedBy: "system:policy-scan",
    });
    await notifyChange(source, draft);
    created++;
  }
  return created;
}

// ── Quét một nguồn theo feed ──

async function scanFeedSource(source: PolicyRadarSourceHealth): Promise<ScanResult> {
  const res = await fetch(source.feedUrl!, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AdsCommandPolicyRadar/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  const entries = parseFeed(await res.text());

  // Feed không parse được KHÔNG được hiểu là "không có bài mới" — ném lỗi để
  // người gọi rơi về chế độ băm trang cho nguồn này.
  if (entries.length === 0) throw new Error("feed không parse được entry nào");

  const seen = await readSeen();
  const prior = seen.find((r) => r.sourceId === source.id);
  const allIds = entries.map((e) => e.id);

  // Lần đầu: nạp vài bài gần nhất rồi đánh dấu phần còn lại là đã thấy.
  const byNewest = [...entries].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  const fresh = !prior
    ? byNewest.slice(0, BASELINE_INGEST)
    : (() => {
        const known = new Set(prior.entryIds);
        return byNewest.filter((e) => !known.has(e.id)).slice(0, MAX_NEW_ITEMS_PER_SCAN);
      })();

  if (!prior) {
    const createdFirst = await ingestEntries(source, fresh);
    await saveSeen(source.id, allIds);
    return {
      sourceId: source.id,
      status: createdFirst > 0 ? "changed" : "baseline",
      detail: `lần đầu: ${entries.length} bài trong feed, nạp ${createdFirst} bài gần nhất`,
      itemsCreated: createdFirst,
    };
  }

  if (fresh.length === 0) {
    await saveSeen(source.id, allIds);
    return { sourceId: source.id, status: "unchanged" };
  }

  const created = await ingestEntries(source, fresh);

  // Ghi nhận cả bài bị đánh dấu không liên quan: đã xét rồi thì đừng xét lại.
  await saveSeen(source.id, [...allIds, ...prior.entryIds]);
  return {
    sourceId: source.id,
    status: created > 0 ? "changed" : "unchanged",
    detail: `${fresh.length} bài mới, tạo ${created} mục`,
    itemsCreated: created,
  };
}

// ── Telegram ──

// 29/09: chuyển sang kênh cảnh báo hệ thống (Teams IT) — Telegram đã ngừng dùng.
async function notifyChange(source: PolicyRadarSourceHealth, draft: DraftedItem): Promise<void> {
  await sendSystemAlert({
    level: "warning", title: `📜 Policy Radar — ${draft.title}`,
    facts: [{ title: "Nguồn", value: source.label }, { title: "Tóm tắt", value: draft.summaryShort }, { title: "Link", value: source.url }],
    action: "Xem chi tiết: AdsCommand → Radar Chính Sách.",
  }).then((r) => { if (!r.sent) console.warn("[policy-radar/scanner] báo kênh IT hỏng:", r.error) }).catch(() => null);
}

// ── Main ──

export interface ScanResult {
  sourceId: string;
  status: "baseline" | "unchanged" | "changed" | "error";
  detail?: string;
  itemsCreated?: number;
}

export async function scanAllAutoFetchableSources(): Promise<ScanResult[]> {
  const sources = POLICY_RADAR_SOURCES.filter((s) => s.autoFetchable);
  const snapshots = await readSnapshots();
  const results: ScanResult[] = [];

  for (const source of sources) {
    try {
      // Nguồn có feed → đọc từng bài. Feed hỏng thì rơi xuống chế độ băm trang
      // bên dưới chứ không bỏ qua nguồn: "trang vừa đổi" vẫn là tín hiệu thật.
      if (source.feedUrl) {
        try {
          results.push(await scanFeedSource(source));
          continue;
        } catch (feedErr) {
          console.warn(
            `[policy-radar/scanner] feed lỗi cho ${source.id}, quay về băm trang:`,
            feedErr instanceof Error ? feedErr.message : feedErr,
          );
        }
      }

      const newText = await fetchPageText(source.url);
      const newHash = hashText(newText);
      const prior = snapshots.find((s) => s.sourceId === source.id);
      const scannedAt = new Date().toISOString();

      if (!prior) {
        await saveSnapshot({ sourceId: source.id, hash: newHash, textExcerpt: newText, scannedAt });
        results.push({ sourceId: source.id, status: "baseline" });
        continue;
      }

      if (prior.hash === newHash) {
        await saveSnapshot({ ...prior, scannedAt });
        results.push({ sourceId: source.id, status: "unchanged" });
        continue;
      }

      const draft = await draftFromDiff(source, prior.textExcerpt, newText);
      await addItem({
        platform: source.platform,
        category: draft.category,
        changeType: draft.changeType,
        title: draft.title,
        sourceUrl: source.url,
        sourceLabel: source.label,
        sourceType: source.sourceType,
        official: true,
        publishedAt: null,
        summaryShort: draft.summaryShort,
        whyItMatters: draft.whyItMatters,
        tags: draft.tags,
        addedBy: "system:policy-scan",
      });
      await notifyChange(source, draft);
      await saveSnapshot({ sourceId: source.id, hash: newHash, textExcerpt: newText, scannedAt });
      results.push({ sourceId: source.id, status: "changed", detail: draft.title });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`[policy-radar/scanner] scan failed for ${source.id}:`, detail);
      results.push({ sourceId: source.id, status: "error", detail });
    }
  }

  return results;
}

/** Last scan time across all auto-fetchable sources, for source-health display. */
export async function getLastScanAt(): Promise<string | null> {
  const snapshots = await readSnapshots();
  if (snapshots.length === 0) return null;
  return snapshots.reduce((latest, s) => (s.scannedAt > latest ? s.scannedAt : latest), snapshots[0].scannedAt);
}
