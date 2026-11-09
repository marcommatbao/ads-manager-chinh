import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ results: [] });
  }

  try {
    const params = new URLSearchParams({
      type: "adinterest",
      q,
      limit: "8",
      locale: "vi_VN",
      access_token: token,
    });
    const res = await fetch(`${META_GRAPH_BASE}/search?${params}`);
    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ results: [] });
    }
    const raw: { id: string; name: string; path?: string[] }[] = (data.data ?? []).map((item: {id: string; name: string; path?: string[]}) => ({
      id: item.id,
      name: item.name,
      path: item.path,
    }));

    if (raw.length === 0) return NextResponse.json({ results: [] });

    // Validate IDs via adinterestvalid — filters out parent-category nodes that
    // cause code: 100, subcode: 1487694 when used in flexible_spec (e.g. broad
    // category headers like "Doanh nghiệp"/"Sản phẩm" resolve to a real search
    // result but aren't valid LEAF targeting nodes Meta accepts in an ad set).
    //
    // Previously fell through to `return raw` (unvalidated) whenever filtered
    // came back empty — same "soft fallback" bug already fixed in
    // resolve-interests/route.ts and searchFBInterests, just not here yet.
    // This is the manual "Tìm interest" autocomplete box (Step 4 review),
    // so an invalid result picked here sailed straight past the Step 4
    // pre-launch warning entirely and only failed at real ad set creation —
    // confirmed live 2026-07-30 (retry-with-original-targeting also failed,
    // meaning it wasn't transient sync lag — Meta genuinely never accepts
    // these specific IDs). Drops invalid results instead.
    try {
      // Strings, not parseInt — see lib/creative-pipeline.ts's
      // searchFBInterests for why: FB interest IDs can exceed
      // Number.MAX_SAFE_INTEGER, and parseInt silently corrupts those,
      // making Meta validate the wrong ID and falsely reject real interests.
      const strIds = raw.map(r => r.id).filter(id => /^\d+$/.test(id));
      const vParams = new URLSearchParams({
        type: "adinterestvalid",
        interest_fbid_list: JSON.stringify(strIds),
        access_token: token,
      });
      const vRes = await fetch(`${META_GRAPH_BASE}/search?${vParams}`);
      const vData = await vRes.json() as { data?: Array<{ id: string | number; valid?: boolean }> };
      if (vData.data && Array.isArray(vData.data) && vData.data.length > 0) {
        const validIds = new Set(vData.data.filter(item => item.valid !== false).map(item => String(item.id)));
        return NextResponse.json({ results: raw.filter(r => validIds.has(String(r.id))) });
      }
      // vData.data missing/empty → validation call itself returned no usable
      // data (not "confirmed all invalid") — keep unvalidated results rather
      // than guess, same as the catch branch below.
    } catch { /* validation call failed — return unvalidated as last resort */ }

    return NextResponse.json({ results: raw });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
