// ============================================================
// A2-lite — Cache + audit cho việc resolve sở thích với Meta
// ------------------------------------------------------------
// Đường resolve (app/api/creative/resolve-interests) ĐÃ tồn tại và đã được tôi
// luyện qua nhiều lỗi thật. Phase này KHÔNG dựng đường xác minh song song —
// dựng thêm một đường thứ hai để làm cùng một việc chính là thứ mà bản A2 đầy
// đủ vô tình tạo ra. Ở đây chỉ bọc thêm hai thứ đường cũ đang thiếu:
//
//   1. CACHE — hiện mỗi lần vào Bước 4 là resolve lại từ đầu, mỗi sở thích một
//      lượt gọi Meta. Sáu sở thích = sáu lượt, lặp lại mỗi lần mở. Đúng khoản
//      "5–8 lượt gọi mỗi màn" mà spec lo — chỉ khác là nó đang xảy ra thật.
//   2. AUDIT — hiện không lưu gì. Không ai trả lời được "hôm qua tool hỏi Meta
//      những gì, trả về gì", nên mọi tranh luận về targeting đều phải đoán.
//
// KHÓA CACHE: chuẩn hoá truy vấn + id tài khoản quảng cáo.
// KHÔNG khoá theo công ty, và đây là lựa chọn có chủ ý: giá trị lưu chỉ là
// "chuỗi truy vấn → hạng mục Meta", tức dữ liệu danh mục CÔNG KHAI của Meta,
// giống hệt nhau cho MBC và MBI vì cả hai dùng CHUNG một ad account. Nhét
// companyId vào khoá chỉ nhân đôi cache với nội dung y hệt mà không thêm một
// lớp an toàn nào. Ngày nào tách ad account theo công ty thì id tài khoản trong
// khoá tự lo phần đó.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { log } from "@/lib/logger";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "interest-resolution-cache.json");
const AUDIT_FILE = path.join(DATA_DIR, "interest-resolution-audit.json");

/** Danh mục sở thích của Meta đổi rất chậm — 24h là thừa an toàn. */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Trần số bản ghi audit giữ lại. Đủ để truy lại vài ngày, không phình file. */
const AUDIT_MAX = 500;
/** Trần số mục cache. Vượt thì bỏ mục cũ nhất. */
const CACHE_MAX = 2000;

export interface CachedResolution {
  /** null = Meta không có hạng mục nào khớp. Kết quả RỖNG cũng được cache —
   *  một từ khoá đã không khớp thì lần sau cũng thế, hỏi lại là phí. */
  match: { id: string; name: string } | null;
  alternates: Array<{ id: string; name: string }>;
  ambiguous: boolean;
  cachedAt: number;
}

type CacheShape = Record<string, CachedResolution>;

export interface AuditEntry {
  ts: string;
  user: string;
  queries: number;
  fromCache: number;
  fromMeta: number;
  resolved: number;
  invalid: number;
  ambiguous: number;
  /** Tóm tắt từng truy vấn: "web hosting → Web hosting" hoặc "xyz → (không khớp)". */
  mapping: string[];
}

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCacheKey(query: string, adAccountId: string): string {
  return `${adAccountId}::${normalizeQuery(query)}`;
}

async function readCache(): Promise<CacheShape> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf-8")) as CacheShape;
  } catch {
    return {};
  }
}

export function isFresh(entry: CachedResolution | undefined): entry is CachedResolution {
  return Boolean(entry) && Date.now() - entry!.cachedAt < TTL_MS;
}

/** Đọc cả lô một lần — tránh mở file cho từng sở thích. */
export async function getCachedBatch(
  queries: string[],
  adAccountId: string,
): Promise<Map<string, CachedResolution>> {
  const cache = await readCache();
  const out = new Map<string, CachedResolution>();
  for (const q of queries) {
    const entry = cache[buildCacheKey(q, adAccountId)];
    if (isFresh(entry)) out.set(q, entry);
  }
  return out;
}

/** Ghi cả lô một lần, trong một lần khoá file. */
export async function saveResolutions(
  entries: Array<{ query: string; resolution: Omit<CachedResolution, "cachedAt"> }>,
  adAccountId: string,
): Promise<void> {
  if (entries.length === 0) return;
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await withFileLock(CACHE_FILE, async () => {
    const cache = await readCache();
    const now = Date.now();
    for (const e of entries) {
      cache[buildCacheKey(e.query, adAccountId)] = { ...e.resolution, cachedAt: now };
    }

    // Quá trần thì bỏ mục cũ nhất. Cache phình vô hạn trên một volume có hạn là
    // cách hỏng chậm mà không ai để ý cho tới lúc hết đĩa.
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => cache[a].cachedAt - cache[b].cachedAt)
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }

    await writeFileAtomic(CACHE_FILE, JSON.stringify(cache));
  });
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  // KHÔNG bao giờ ghi access token hay payload thô của Meta vào đây — file này
  // nằm cùng chỗ với dữ liệu thường, không phải kho bí mật.
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  try {
    await withFileLock(AUDIT_FILE, async () => {
      let all: AuditEntry[] = [];
      try {
        all = JSON.parse(await fs.readFile(AUDIT_FILE, "utf-8")) as AuditEntry[];
      } catch {
        all = [];
      }
      all.unshift(entry);
      await writeFileAtomic(AUDIT_FILE, JSON.stringify(all.slice(0, AUDIT_MAX), null, 2));
    });
  } catch (err) {
    // Audit hỏng KHÔNG được làm hỏng việc resolve — nó là sổ ghi chép, không
    // phải một mắt xích trong chuỗi phục vụ người dùng.
    log.warn("interest_resolution", "Không ghi được audit", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readAudit(limit = 50): Promise<AuditEntry[]> {
  try {
    const all = JSON.parse(await fs.readFile(AUDIT_FILE, "utf-8")) as AuditEntry[];
    return all.slice(0, limit);
  } catch {
    return [];
  }
}
