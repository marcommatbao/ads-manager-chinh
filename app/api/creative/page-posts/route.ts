// GET /api/creative/page-posts
// Fetch recent posts from a Facebook Page for use as existing post ads
// Note: New Page Experience requires a Page Access Token, not a User/Ad token.
// We exchange the user token for a page token via /me/accounts first.
import { NextRequest, NextResponse } from "next/server";
import { pageIdsByCompany } from "@/lib/meta-accounts";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

// ID đọc từ biến môi trường (lib/meta-accounts.ts) — không để trong mã vì
// repo này sẽ ở trạng thái công khai. Xem chú thích đầu file đó.
const PAGE_IDS: Record<string, string> = pageIdsByCompany();

const BASE = META_GRAPH_BASE;

async function getPageAccessToken(pageId: string, userToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/${pageId}?fields=access_token&access_token=${userToken}`);
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userToken = process.env.META_ACCESS_TOKEN;
  const { searchParams } = request.nextUrl;
  const company = (searchParams.get("company") ?? "MBC") as string;
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }
  const days = parseInt(searchParams.get("days") ?? "30", 10);
  const search = searchParams.get("search") ?? "";
  const mediaOnly = searchParams.get("mediaOnly") === "true";

  const pageId = PAGE_IDS[company] ?? PAGE_IDS.MBC;

  if (!userToken) {
    return NextResponse.json({ posts: [], error: friendlyError("META_ACCESS_TOKEN not configured") });
  }

  // Get Page Access Token (required for New Page Experience)
  const pageToken = await getPageAccessToken(pageId, userToken);
  const token = pageToken ?? userToken; // fallback to user token

  try {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const fields = "id,message,created_time,full_picture,attachments{media_type,media{image{src}}},likes.summary(true),comments.summary(true),shares";
    const params = new URLSearchParams({
      fields,
      since: String(since),
      limit: "50",
      access_token: token,
    });

    // New Page Experience uses /published_posts instead of /posts
    const res = await fetch(`${BASE}/${pageId}/published_posts?${params}`);
    const data = await res.json();

    if (data.error) {
      console.error("[page-posts] FB error:", data.error.code, data.error.message);
      // Try fallback: /feed endpoint
      const resFeed = await fetch(`${BASE}/${pageId}/feed?${params}`);
      const dataFeed = await resFeed.json();
      if (dataFeed.error) {
        return NextResponse.json({ posts: [], error: data.error.message });
      }
      return NextResponse.json({ posts: mapPosts(dataFeed.data ?? [], pageId, search, mediaOnly) });
    }

    return NextResponse.json({ posts: mapPosts(data.data ?? [], pageId, search, mediaOnly) });
  } catch (err) {
    console.error("[page-posts] Error:", err);
    return NextResponse.json({ posts: [] });
  }
}

interface RawPost {
  id: string;
  message?: string;
  created_time: string;
  full_picture?: string;
  attachments?: { data: Array<{ media_type: string; media?: { image?: { src: string } } }> };
  likes?: { summary: { total_count: number } };
  comments?: { summary: { total_count: number } };
  shares?: { count: number };
}

function mapPosts(raw: RawPost[], pageId: string, search: string, mediaOnly: boolean) {
  return raw
    .map((p) => {
      const attach = p.attachments?.data?.[0];
      const mediaType = attach?.media_type ?? "text";
      const thumbnail = p.full_picture ?? attach?.media?.image?.src ?? null;
      const postId = p.id.includes("_") ? p.id.split("_")[1] : p.id;
      return {
        id: p.id,
        postId,
        objectStoryId: `${pageId}_${postId}`,
        message: p.message ?? "",
        createdTime: p.created_time,
        thumbnail,
        mediaType,
        engagement: {
          likes: p.likes?.summary?.total_count ?? 0,
          comments: p.comments?.summary?.total_count ?? 0,
          shares: p.shares?.count ?? 0,
        },
      };
    })
    .filter((p) => {
      if (mediaOnly && p.mediaType === "text") return false;
      if (search && !p.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
}
