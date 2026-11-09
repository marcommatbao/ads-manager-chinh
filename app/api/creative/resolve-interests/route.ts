import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveInterestWithAlternates } from "@/lib/creative-pipeline";
import {
  getCachedBatch,
  saveResolutions,
  recordAudit,
  type CachedResolution,
} from "@/lib/interest-resolution-cache";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;

  let body: { interests?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ resolved: [] });
  }

  const interests = body.interests ?? [];
  if (interests.length === 0) {
    return NextResponse.json({ resolved: [] });
  }

  if (!token) {
    return NextResponse.json({ resolved: [] });
  }

  const adAccountId = process.env.META_AD_ACCOUNT_ID ?? "unknown";
  const queries = interests.slice(0, 15);

  // A2-lite: đọc cache TRƯỚC. Mỗi lần vào Bước 4 trước đây là resolve lại từ
  // đầu — sáu sở thích, sáu lượt gọi Meta, lặp lại mỗi lần mở màn hình.
  const cached = await getCachedBatch(queries, adAccountId);

  const seen = new Set<string>();
  const candidates: Array<{ originalName: string; id: string; name: string; ambiguous: boolean; alternates: Array<{ id: string; name: string }> }> = [];
  const toCache: Array<{ query: string; resolution: Omit<CachedResolution, "cachedAt"> }> = [];
  const mapping: string[] = [];
  let fromCache = 0;
  let fromMeta = 0;

  // Same locale-by-script + relevance-filtered resolution as
  // lib/creative-pipeline.ts's searchFBInterests — was previously its
  // own duplicated (and lower-quality) search here: always tried vi_VN
  // first regardless of the query's actual language, and took the #1
  // raw result with no relevance check, which is how English AI-suggested
  // keywords like "Fashion" or "Online shopping" ended up resolving to
  // unrelated entities (a band, a Bangladesh-focused shopping app).
  for (const interest of queries) {
    const hit = cached.get(interest);
    let resolution: Omit<CachedResolution, "cachedAt">;

    if (hit) {
      fromCache++;
      resolution = { match: hit.match, alternates: hit.alternates, ambiguous: hit.ambiguous };
    } else {
      fromMeta++;
      const r = await resolveInterestWithAlternates(interest, token);
      resolution = { match: r.match, alternates: r.alternates, ambiguous: r.ambiguous };
      // Cache CẢ kết quả rỗng: một từ khoá Meta không có thì lần sau vẫn không
      // có, hỏi lại chỉ tốn thêm một lượt gọi.
      toCache.push({ query: interest, resolution });
    }

    mapping.push(`${interest} → ${resolution.match?.name ?? "(không khớp)"}${resolution.ambiguous ? " [nhiều match sát nhau]" : ""}`);

    if (resolution.match && !seen.has(resolution.match.id)) {
      candidates.push({
        originalName: interest,
        id: resolution.match.id,
        name: resolution.match.name,
        ambiguous: resolution.ambiguous,
        alternates: resolution.alternates,
      });
      seen.add(resolution.match.id);
    }
  }

  if (toCache.length > 0) await saveResolutions(toCache, adAccountId);

  // Validate IDs — removes parent-category nodes that cause code: 100, subcode: 1487694.
  // FB adinterestvalid expects IDs under the "interest_fbid_list" param
  // (NOT "interest_list" — that name is silently accepted but returns a
  // degenerate response with no `id`/`valid` fields, i.e. this validation was
  // a complete no-op the whole time: every ID always "matched 0").
  //
  // Previously: when validation flagged 0/N as valid, this kept ALL
  // candidates anyway ("soft fallback") reasoning the validation call
  // itself might be broken — true when it used the wrong param name, but
  // now that adinterestvalid actually works, that fallback silently
  // handed the launch flow interest IDs Meta had ALREADY told us it would
  // reject, guaranteeing a code:100 failure at ad set creation and a
  // silent downgrade to Advantage+ Audience (age/gender/interests all
  // dropped) — confirmed live 2026-07-30. Now drops invalid candidates
  // here instead, and reports which ones so the wizard can show the user
  // *before* launch, not discover it after a silent targeting downgrade.
  let resolved = candidates;
  let invalid: string[] = [];
  if (candidates.length > 0) {
    try {
      // Strings, not parseInt — FB interest IDs can exceed
      // Number.MAX_SAFE_INTEGER (16 digits); parseInt silently rounds
      // those, so Meta ends up validating a different ID than the real
      // one and a genuinely valid interest comes back "invalid".
      // Confirmed as root cause of a real Meta-dragged interest being
      // flagged invalid — see lib/creative-pipeline.ts's searchFBInterests.
      const strIds = candidates.map(c => c.id).filter(id => /^\d+$/.test(id));
      const vParams = new URLSearchParams({
        type: "adinterestvalid",
        interest_fbid_list: JSON.stringify(strIds),
        access_token: token,
      });
      const vRes = await fetch(`${META_GRAPH_BASE}/search?${vParams}`);
      const vData = await vRes.json() as { data?: Array<{ id: string | number; valid?: boolean }> };
      if (vData.data && Array.isArray(vData.data) && vData.data.length > 0) {
        const validIds = new Set(vData.data.filter(item => item.valid !== false).map(item => String(item.id)));
        resolved = candidates.filter(c => validIds.has(String(c.id)));
        invalid = candidates.filter(c => !validIds.has(String(c.id))).map(c => c.originalName);
      }
      // vData.data empty/missing → validation call itself didn't return
      // usable data (not "all invalid") — keep candidates unvalidated
      // rather than guess; same as the pre-existing catch-block behavior.
    } catch { /* ignore, use unvalidated candidates */ }
  }

  await recordAudit({
    ts: new Date().toISOString(),
    user: user.email,
    queries: queries.length,
    fromCache,
    fromMeta,
    resolved: resolved.length,
    invalid: invalid.length,
    ambiguous: resolved.filter(r => r.ambiguous).length,
    mapping,
  });

  return NextResponse.json({
    resolved,
    invalid,
    /** Bao nhiêu truy vấn lấy từ cache, bao nhiêu phải hỏi Meta — để nhìn được
     *  cache có tác dụng thật không, thay vì tin là có. */
    meta: { fromCache, fromMeta },
  });
}
