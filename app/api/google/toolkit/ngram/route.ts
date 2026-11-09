import { NextRequest, NextResponse } from "next/server"
import { createdNames, guardedMutate, WriteGuardError } from "@/lib/write-guard"
import { safeDateRange, safeNumericId, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { getCurrentUser }            from "@/lib/auth"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {

  const { searchParams } = new URL(req.url)
  const company    = (searchParams.get("company")    || "MBC") as string
  let campaignId: string | null
  try {
    campaignId = safeNumericId(searchParams.get("campaignId"))
  } catch (err) {
    if (err instanceof InvalidGaqlInput) return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
    throw err
  }
  // GAQL DURING only accepts a fixed literal set — LAST_90_DAYS isn't one
  // (this default was never exercised until this route got a real caller).
  let dateRange: string
  try {
    dateRange = safeDateRange(searchParams.get("range"))
  } catch (err) {
    if (err instanceof InvalidGaqlInput) return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
    throw err
  }
  const nSize      = parseInt(searchParams.get("n") || "1", 10)

  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
  }

  const customer = getGoogleAdsCustomer(company)

  const whereClause = campaignId
    ? `AND campaign.id = ${campaignId}` : ""

  // ── Pull search terms ──
  const rows = await customer.query(`
    SELECT
      search_term_view.search_term,
      campaign.id,
      campaign.name,
      campaign.resource_name,
      metrics.cost_micros,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions
    FROM search_term_view
    WHERE segments.date DURING ${dateRange}
      AND campaign.status = 'ENABLED'
      ${whereClause}
  `)

  // ── Avg CPA toàn account ──
  const totalCost = rows.reduce((s: number, r: any) =>
    s + (r.metrics?.cost_micros || 0), 0)
  const totalConv = rows.reduce((s: number, r: any) =>
    s + (r.metrics?.conversions || 0), 0)
  const avgCPA = totalConv > 0
    ? (totalCost / totalConv) / 1_000_000 : 0

  // ── Extract N-grams ──
  const ngramMap: Record<string, {
    cost: number
    conversions: number
    clicks: number
    campaigns: Set<string>
  }> = {}

  for (const row of rows) {
    const terms = (row.search_term_view?.search_term || "")
      .toLowerCase().trim().split(/\s+/).filter(Boolean)

    for (let i = 0; i <= terms.length - nSize; i++) {
      const ngram = terms.slice(i, i + nSize).join(" ")
      if (!ngramMap[ngram]) {
        ngramMap[ngram] = {
          cost: 0, conversions: 0, clicks: 0,
          campaigns: new Set()
        }
      }
      ngramMap[ngram].cost        += (row.metrics?.cost_micros || 0) / 1_000_000
      ngramMap[ngram].conversions += (row.metrics?.conversions || 0)
      ngramMap[ngram].clicks      += (row.metrics?.clicks || 0)
      if (row.campaign?.name) {
        ngramMap[ngram].campaigns.add(row.campaign.name)
      }
    }
  }

  // ── Score + Savings ──
  // A raw cost/conversions CPA is noisy at low sample sizes — a n-gram with
  // 5 clicks and 1 lucky/unlucky conversion can show 2-3x avgCPA purely by
  // chance, which used to feed straight into nScore and get recommended
  // NEGATIVE with no regard for how little evidence backed it. Two fixes:
  // (1) score off a Bayesian-shrunk CPA that blends the n-gram's own cost/
  // conversions with PRIOR_WEIGHT "virtual" conversions at the account
  // average — small samples get pulled toward avgCPA (harder to flag),
  // large samples are barely affected (their own data dominates); (2) an
  // explicit confidence tier gates whether NEGATIVE is safe to *recommend*
  // at all — low-confidence bad-looking terms fall back to MONITOR (still
  // visible, not hidden) rather than a false-positive block-recommendation.
  const PRIOR_WEIGHT = 3 // "virtual" conversions at avgCPA blended into small-sample estimates

  function confidenceOf(clicks: number): "high" | "medium" | "low" {
    if (clicks >= 30) return "high";
    if (clicks >= 10) return "medium";
    return "low";
  }

  const ngrams = Object.entries(ngramMap)
    .filter(([_, d]) => d.cost > 50_000 && d.clicks >= 5)
    .map(([ngram, d]) => {
      const cpa     = d.conversions > 0
        ? Math.round(d.cost / d.conversions) : null
      const vsAvgPct = (cpa && avgCPA > 0)
        ? Math.round((cpa - avgCPA) / avgCPA * 100) : null
      const confidence = confidenceOf(d.clicks)

      // Shrunk CPA — only defined (and only used) when there's at least one
      // REAL conversion to anchor it (cpa !== null); avgCPA alone isn't
      // enough of a gate, since that would also fire for zero-conversion
      // n-grams and produce a falsely reassuring blended number where the
      // honest answer is "no conversion signal yet" (handled by the
      // zero-conv branch below instead, same as before this change).
      const smoothedCpa = (cpa !== null && avgCPA > 0)
        ? (d.cost + PRIOR_WEIGHT * avgCPA) / (d.conversions + PRIOR_WEIGHT)
        : null

      // nScore thấp = nguy hiểm — computed off the shrunk estimate so a
      // handful of clicks can no longer swing it to the extreme on its own.
      let nScore = 50
      if (smoothedCpa !== null) {
        const ratio = smoothedCpa / avgCPA
        nScore = Math.max(0, Math.min(100, Math.round(100 / ratio)))
      } else if (d.conversions === 0 && d.clicks >= 25) {
        nScore = 5 // 0 conv, ≥25 clicks = rất nguy hiểm — đủ bằng chứng, không cần shrink
      }

      // A term with conversions saves only the excess over the account
      // average. A term with ZERO conversions produced nothing at all, so
      // blocking it saves its whole spend.
      //
      // This branch used to fall through to 0, which had two visible
      // consequences on the dashboard's "Từ khóa nên chặn" widget: the
      // strongest waste signal in the account rendered as "Tiết kiệm ₫0",
      // and — because that widget sorts by potentialSavings and keeps the
      // top 5 — it sorted BELOW terms that waste less.
      const potentialSavings =
        d.conversions === 0
          ? Math.round(d.cost)
          : (cpa && cpa > avgCPA && avgCPA > 0)
            ? Math.round(d.cost * (1 - avgCPA / cpa))
            : 0

      // Zero-conversion-heavy-spend is strong evidence on its own (no
      // shrinkage applies there — nScore already reflects that above), so
      // it's exempt from the confidence gate. Everything else needs at
      // least "medium" confidence (≥10 clicks) to be recommended NEGATIVE
      // outright — low-confidence bad scores are real signal, just not
      // enough of it yet, so they land in MONITOR instead.
      const isZeroConvSignal = d.conversions === 0 && d.clicks >= 25;
      const recommendation =
        nScore < 25 && (confidence !== "low" || isZeroConvSignal) ? "NEGATIVE" :
        nScore < 55 ? "MONITOR"  : "KEEP"

      return {
        ngram,
        cost:             Math.round(d.cost),
        conversions:      d.conversions,
        clicks:           d.clicks,
        // null = "chưa có chuyển đổi nào", which is a different fact from
        // "CPA bằng 0". Collapsing it to 0 made the widget render
        // "CPA ₫0 (+0%)" for terms that had simply never converted.
        cpa:              cpa,
        vsAvgPct:         vsAvgPct,
        nScore,
        confidence,
        potentialSavings,
        recommendation,
        campaigns:        Array.from(d.campaigns),
      }
    })
    .sort((a, b) => b.potentialSavings - a.potentialSavings)

  const totalSavings = ngrams.reduce((s, n) => s + n.potentialSavings, 0)

  // ── Pull campaign list cho filter ──
  const campaignMap = new Map<string, string>()
  for (const r of rows) {
    if (r.campaign?.id && r.campaign?.name) {
      campaignMap.set(String(r.campaign.id), r.campaign.name)
    }
  }
  const campaigns = Array.from(campaignMap.entries()).map(([id, name]) => ({ id, name }))

  return NextResponse.json({
    avgCPA:         Math.round(avgCPA),
    totalSavings,
    ngramCount:     ngrams.length,
    ngrams,
    campaigns,
  })
  } catch (error: any) {
    console.error("N-Gram API error:", error)
    return NextResponse.json({
      error: friendlyError(error.message),
      avgCPA: 0,
      totalSavings: 0,
      ngramCount: 0,
      ngrams: [],
      campaigns: [],
    }, { status: 500 })
  }
}

// ── Apply Negative Keywords ──
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { company, ngrams, scope, campaignId, validateOnly, confirmText } = await req.json()
  // scope: "CAMPAIGN" | "ACCOUNT"
  // ngrams: [{ ngram, matchType }]

  // Tenant scope was checked, but not write permission — a read-only viewer
  // could add negative keywords to their own company's live account.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: "Không có quyền thêm từ khóa phủ định" }, { status: 403 })
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
  }
  // campaignId is interpolated into a resource name below.
  if (campaignId !== undefined && campaignId !== null && safeNumericId(String(campaignId)) === null) {
    return NextResponse.json({ error: "campaignId không hợp lệ" }, { status: 400 })
  }

  const customer   = getGoogleAdsCustomer(company as string)

  // Built server-side, not accepted from the client — the frontend only
  // knows the bare numeric campaignId (from the GET response's `campaigns`
  // list), not the account's customer ID.
  const customerId = GOOGLE_CUSTOMER_IDS[company]
  const campaignResourceName = campaignId ? `customers/${customerId}/campaigns/${campaignId}` : undefined

  // ACCOUNT scope needs an existing Shared Negative Keyword List's
  // resource_name. This used to read GG_NEGATIVE_LIST_ID_{company} from
  // env — never set anywhere in this repo (.env/.env.example), so every
  // "Negative — Toàn tài khoản" click failed with shared_set undefined.
  // Looked up live instead (same GAQL shape lib/google-audit-engine.ts
  // already uses to detect these) — works the moment an account has any
  // enabled NEGATIVE_KEYWORDS shared set, no env var to configure.
  let sharedSetResourceName: string | null = null
  if (scope === "ACCOUNT") {
    const sharedSets = await customer.query(`
      SELECT shared_set.resource_name, shared_set.name
      FROM shared_set
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'
      LIMIT 1
    `)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sharedSetResourceName = (sharedSets[0] as any)?.shared_set?.resource_name ?? null

    if (!sharedSetResourceName) {
      return NextResponse.json({
        success: false,
        appliedCount: 0,
        applied: [],
        errors: [{
          ngram: "*",
          error: `Tài khoản ${company} chưa có Shared Negative Keyword List nào (Tools & Settings → Shared Library → Negative keyword lists trong Google Ads). Tạo 1 list và gắn vào campaign trước, hoặc dùng "Negative — Campaign" để thêm trực tiếp vào 1 campaign cụ thể (không cần shared list).`,
        }],
      })
    }
  }

  // Đợt 11d: MỘT lệnh nguyên khối qua lớp ghi an toàn (Kiểm trước → XAC NHAN → ghi → lưu lệnh ngược để hoàn tác). Bản cũ ghi
  // từng n-gram một, không kiểm trước, không hoàn tác được.
  const list = (Array.isArray(ngrams) ? ngrams : []).filter((i: { ngram?: unknown }) => typeof i?.ngram === "string" && i.ngram.trim()).slice(0, 500) as { ngram: string; matchType?: string }[]
  if (!list.length) return NextResponse.json({ success: false, error: "Chưa chọn n-gram nào" }, { status: 400 })
  if (scope !== "ACCOUNT" && !campaignResourceName) return NextResponse.json({ success: false, error: "Thiếu chiến dịch" }, { status: 400 })
  const ops = list.map((item) => scope === "ACCOUNT"
    ? { entity: "shared_criterion", operation: "create" as const, resource: { shared_set: sharedSetResourceName, keyword: { text: item.ngram.trim(), match_type: item.matchType || "BROAD" } } }
    : { entity: "campaign_criterion", operation: "create" as const, resource: { campaign: campaignResourceName, negative: true, keyword: { text: item.ngram.trim(), match_type: item.matchType || "BROAD" } } })
  try {
    const r = await guardedMutate({
      company: company as string, source: "toolkit/ngram", label: `Phủ định n-gram (${scope === "ACCOUNT" ? "danh sách dùng chung" : "chiến dịch"}): ${list.slice(0, 3).map((i) => i.ngram).join(", ")}${list.length > 3 ? "…" : ""}`,
      ops, inverseOf: (resp) => createdNames(resp).filter((n): n is string => !!n).map((n) => ({ entity: scope === "ACCOUNT" ? "shared_criterion" : "campaign_criterion", operation: "remove" as const, resource: n })),
      validateOnly, confirmText, actor: user.email,
    })
    if (!r.entry) return NextResponse.json({ success: true, validated: true, appliedCount: 0, applied: [], errors: [], count: ops.length })
    return NextResponse.json({ success: true, appliedCount: list.length, applied: list.map((i) => i.ngram), errors: [], writeId: r.entry.id })
  } catch (e) {
    if (e instanceof WriteGuardError) return NextResponse.json({ success: false, error: friendlyError(e.message), needsConfirm: e.status === 428, validated: e.validated, appliedCount: 0, applied: [], errors: [{ ngram: "*", error: friendlyError(e.message) }] }, { status: e.status })
    throw e
  }
}
