import { NextResponse } from "next/server";
import { knownPages } from "@/lib/meta-accounts";
import { getCurrentUser } from "@/lib/auth";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

// Real Page IDs (not fabricated) used as a fallback ONLY when the live
// /me/accounts fetch fails or META_ACCESS_TOKEN is missing — `source`
// tells the caller this is a known-pages fallback, not a fresh fetch, so
// it can't silently go stale if a 3rd Page is ever added.
// ID đọc từ biến môi trường (lib/meta-accounts.ts) — không để trong mã vì
// repo này sẽ ở trạng thái công khai. Xem chú thích đầu file đó.
const FALLBACK_PAGES = knownPages();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ pages: FALLBACK_PAGES, source: "fallback" });
  }
  try {
    const res = await fetch(`${META_GRAPH_BASE}/me/accounts?fields=id,name&access_token=${token}`);
    const data = await res.json();
    if (data.data?.length > 0) {
      return NextResponse.json({
        pages: data.data.map((p: {id: string; name: string}) => ({ id: p.id, name: p.name })),
        source: "live",
      });
    }
    console.warn("[creative/get-pages] /me/accounts returned no pages — using fallback list");
  } catch (err) {
    console.warn("[creative/get-pages] /me/accounts fetch failed — using fallback list:", err);
  }
  return NextResponse.json({ pages: FALLBACK_PAGES, source: "fallback" });
}
