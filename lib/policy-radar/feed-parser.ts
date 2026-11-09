// ─────────────────────────────────────────────
// Policy Radar — Atom/RSS parser
//
// Vì sao cần: scanner đang băm toàn bộ HTML của trang nguồn rồi so hash. Cách
// đó chỉ nói được "trang này vừa đổi gì đó" — mọi mục trên màn hình đều mang
// cùng một tiêu đề "Nội dung trang thay đổi" và không có ngày đăng. Nhưng cả
// hai blog Google đang theo dõi đều phát feed: Atom cho ads-developers, RSS cho
// blog.google. Đọc feed thì có sẵn tiêu đề thật, ngày thật, link thẳng bài.
//
// Không thêm thư viện: hai định dạng này đủ đơn giản để bóc bằng regex có kiểm
// soát, và toàn bộ đầu vào là feed công khai chỉ dùng để hiển thị + tóm tắt —
// không có gì được thực thi từ nội dung parse ra.
// ─────────────────────────────────────────────

export interface FeedEntry {
  /** Khóa chống trùng — ưu tiên id/guid của feed, không có thì dùng link. */
  id: string;
  title: string;
  link: string;
  /** ISO date, hoặc null khi feed không nói — không bao giờ lấy ngày quét thay. */
  publishedAt: string | null;
  /** Tóm tắt/nội dung thô đã bóc thẻ, cắt ngắn cho vừa prompt. */
  summary: string;
}

const CONTENT_LIMIT = 4000;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = stripTags(raw);
  if (!cleaned) return null;
  const ms = Date.parse(cleaned);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** Atom: <link rel="alternate" href="..."/>. RSS: <link>...</link>. */
function extractLink(block: string): string {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const anyHref = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (anyHref) return decodeEntities(anyHref[1]);
  const rss = pick(block, "link");
  return rss ? decodeEntities(rss).trim() : "";
}

function parseBlocks(xml: string, tag: "entry" | "item"): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * Parse Atom hoặc RSS. Trả mảng rỗng khi không nhận ra định dạng — người gọi
 * phải coi đó là "feed không dùng được" và rơi về chế độ băm trang, chứ không
 * hiểu nhầm thành "không có bài mới".
 */
export function parseFeed(xml: string): FeedEntry[] {
  const atom = parseBlocks(xml, "entry");
  const blocks = atom.length > 0 ? atom : parseBlocks(xml, "item");
  const isAtom = atom.length > 0;

  const entries: FeedEntry[] = [];
  for (const block of blocks) {
    const title = stripTags(pick(block, "title") ?? "");
    const link = extractLink(block);
    if (!title && !link) continue;

    const published = isAtom
      ? toIso(pick(block, "published") ?? pick(block, "updated"))
      : toIso(pick(block, "pubDate") ?? pick(block, "dc:date"));

    const rawSummary =
      pick(block, "content") ??
      pick(block, "summary") ??
      pick(block, "description") ??
      "";

    const guid = isAtom ? pick(block, "id") : (pick(block, "guid") ?? pick(block, "id"));
    const id = stripTags(guid ?? "") || link || title;

    entries.push({
      id,
      title: title || "(không có tiêu đề)",
      link,
      publishedAt: published,
      summary: stripTags(rawSummary).slice(0, CONTENT_LIMIT),
    });
  }
  return entries;
}
