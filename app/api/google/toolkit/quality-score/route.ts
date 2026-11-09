import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { makeT } from "@/lib/i18n/translate"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { safeDateRange, safeNumericId, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { resolveMatchType }           from "@/lib/google-ads-helpers"
import { enumName }                   from "@/lib/google-ads-enums"
import { getCurrentUser, type SessionUser } from "@/lib/auth"
import { checkCronAuth }              from "@/lib/cron-auth"
import { canAccessCompany }           from "@/lib/permissions"
import { fetchLandingPages }          from "@/lib/google-landing-pages"
import {
  type QSRecord,
  readQSHistory,
  writeQSHistory,
  previousSnapshotIndex,
  historyCoverage,
  dateOf,
  todayStr,
} from "@/lib/qs-history"
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  // Service-to-service path for the nightly snapshot cron. The QS history that
  // powers the trend column (and the daily digest's "QS tụt" count) was only
  // ever written when a human opened this page, so the series had holes on
  // every day nobody looked. Same dual-auth shape as app/api/improvements —
  // checkCronAuth is only consulted when an Authorization header is actually
  // present, so ordinary session requests never touch its rejection logging.
  const hasAuthHeader = req.headers.has("authorization")
  const user: SessionUser | null = hasAuthHeader && checkCronAuth(req, "quality-score/service-read").ok
    ? { id: "cron", name: "Cron", email: "cron@internal", role: "super_admin", companies: ["ALL"] }
    : await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // 29/09: lượt cron (crontab 07:30) trước đây KHÔNG ghi lịch sử job → trang Jobs luôn "Chưa chạy" và canh lỡ lịch (Đợt 14a)
  // sẽ báo nhầm. Ghi lịch sử cho đúng job theo công ty; người mở trang thì không ghi.
  if (user.id === "cron") {
    const co = pickCompany(new URL(req.url).searchParams.get("company"))
    const guard = await startJobRun(co === "MBI" ? "quality_score_mbi" : "quality_score_mbc", "cron")
    if (guard.blocked) return guard.response
    try {
      const res = await handle(req, user)
      await guard.finish(res.ok ? "success" : "failure", `HTTP ${res.status}`, res.ok ? undefined : new Error(`HTTP ${res.status}`))
      return res
    } catch (err) { await guard.finish("failure", null, err); throw err }
  }
  return handle(req, user)
}

async function handle(req: NextRequest, user: SessionUser): Promise<NextResponse> {
  // Cron (service-to-service) giữ tiếng Việt; người dùng giao diện theo cookie ngôn ngữ.
  const t = user.id === "cron" ? makeT("vi") : await getT()
  // ── QS label mapping ──
  const QS_LABEL: Record<string, string> = {
    ABOVE_AVERAGE: t("libgoogle.qs.l.ABOVE_AVERAGE"),
    AVERAGE:       t("libgoogle.qs.l.AVERAGE"),
    BELOW_AVERAGE: t("libgoogle.qs.l.BELOW_AVERAGE"),
    UNKNOWN:       "—",
  }
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
    const filter     = searchParams.get("filter")     || "ALL"

    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
    }

    const customer = getGoogleAdsCustomer(company)

    const whereClause = campaignId
      ? `AND campaign.id = ${campaignId}` : ""

    // ── Landing pages đang phục vụ các ad group này ──
    // Nguyên nhân LANDING_PAGE trước đây là ngõ cụt: app nói "trang đích chưa
    // liên quan" rồi dừng, không nói trang nào. `landing_page_view` trả lời
    // đúng câu đó. Nhưng việc Google có cho select kèm `ad_group.id` hay không
    // thì không kiểm chứng được từ môi trường này (xem lib/google-landing-pages),
    // nên hàm đó tự hạ xuống truy vấn chỉ-theo-URL nếu bị từ chối. Độc lập với
    // truy vấn QS: hỏng ở đây không được làm hỏng cả trang.
    const landingPagePromise = fetchLandingPages(
      (gaql) => customer.query(gaql) as Promise<unknown[]>,
      { whereClause, dateRange: "LAST_7_DAYS" },
    )

    // ── Pull QS hiện tại từng keyword ──
    const rows = await customer.query(`
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group.id,
        ad_group.name,
        ad_group.resource_name,
        campaign.id,
        campaign.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions,
        metrics.average_cpc
      FROM keyword_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        ${whereClause}
        AND segments.date DURING LAST_7_DAYS
    `)

    // ── Lấy lịch sử QS từ JSON file ──
    const allHistory = await readQSHistory()
    const today = todayStr()

    // The comparison mark must come from a day OTHER than today. Today's
    // snapshot is written further down on the first request of the day, so
    // taking "the newest record" made every later request compare a keyword
    // against itself and report FLAT — see lib/qs-history.ts.
    const prevIndex = previousSnapshotIndex(allHistory, company, today)

    // Full per-keyword series (this company) for the sparkline, newest first.
    const historyMap: Record<string, QSRecord[]> = {}
    for (const h of allHistory) {
      if (h.company !== company) continue
      if (!historyMap[h.criterionId]) historyMap[h.criterionId] = []
      historyMap[h.criterionId].push(h)
    }
    for (const key of Object.keys(historyMap)) {
      historyMap[key].sort((a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
      )
    }

    const allKeywords = rows
      .filter((r: any) =>
        (r.ad_group_criterion?.quality_info?.quality_score || 0) > 0
      )
      .map((r: any) => {
        const qi      = r.ad_group_criterion?.quality_info
        const qs      = qi?.quality_score || 0
        // quality_info's bucket fields come back from customer.query() as
        // raw numeric enums, not the string names ("BELOW_AVERAGE" etc.) —
        // comparing them directly against QS_LABEL/string literals below
        // never matched, so every keyword's components showed "—" and
        // `weakest` was always null regardless of real QS.
        const ctrComp = enumName(enums.QualityScoreBucket, qi?.search_predicted_ctr)
        const adComp  = enumName(enums.QualityScoreBucket, qi?.creative_quality_score)
        const lpComp  = enumName(enums.QualityScoreBucket, qi?.post_click_quality_score)
        const critId  = String(r.ad_group_criterion?.criterion_id)

        // Lịch sử QS — mốc so sánh lấy từ ngày khác hôm nay
        const kwHistory = historyMap[critId] || []
        const prevRecord = prevIndex.get(critId) ?? null
        const prevQS    = prevRecord?.qualityScore ?? null
        const prevDate  = prevRecord ? dateOf(prevRecord) : null
        const trend     = prevQS
          ? qs > prevQS ? "UP"
          : qs < prevQS ? "DOWN" : "FLAT"
          : "NEW"

        // Grade
        const grade =
          qs >= 8 ? "EXCELLENT" :
          qs >= 6 ? "GOOD"      :
          qs >= 4 ? "AVERAGE"   : "POOR"

        // Phần nào kém nhất → gợi ý fix — but only bother flagging one when
        // the keyword's OVERALL grade is POOR/AVERAGE. A GOOD/EXCELLENT
        // keyword (qs>=6) commonly has one component graded "below average"
        // in Google's relative, per-component sense while still converting
        // well in aggregate — surfacing an actionable "go fix this" for
        // e.g. QS=8 with 36 real conversions creates false urgency and
        // buries the keywords that actually need attention (POOR grade,
        // real spend, zero traction).
        const weakest = (grade === "POOR" || grade === "AVERAGE")
          ? (adComp === "BELOW_AVERAGE" ? "AD_RELEVANCE" :
             lpComp === "BELOW_AVERAGE" ? "LANDING_PAGE" :
             ctrComp === "BELOW_AVERAGE"? "EXPECTED_CTR" : null)
          : null

        const suggestion =
          weakest === "AD_RELEVANCE"
            ? t("libgoogle.qs.sugAd")
          : weakest === "LANDING_PAGE"
            ? t("libgoogle.qs.sugLp")
          : weakest === "EXPECTED_CTR"
            ? t("libgoogle.qs.sugCtr")
          : grade === "GOOD" || grade === "EXCELLENT"
            ? t("libgoogle.qs.sugGood", { qs })
          : t("libgoogle.qs.sugOk")

        return {
          criterionId:  critId,
          keyword:      r.ad_group_criterion?.keyword?.text || "",
          matchType:    resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
          campaign:     r.campaign?.name || "",
          campaignId:   r.campaign?.id || "",
          adGroup:      r.ad_group?.name || "",
          adGroupId:    String(r.ad_group?.id || ""),
          adGroupResource: r.ad_group?.resource_name || "",
          qs,
          prevQS,
          prevDate,
          trend,
          grade,
          components: {
            expectedCTR: QS_LABEL[ctrComp] || "—",
            adRelevance: QS_LABEL[adComp]  || "—",
            landingPage: QS_LABEL[lpComp]  || "—",
          },
          weakest,
          suggestion,
          spend:       Math.round((r.metrics?.cost_micros || 0) / 1_000_000),
          conversions: r.metrics?.conversions || 0,
          clicks:      r.metrics?.clicks || 0,
          impressions: r.metrics?.impressions || 0,
          avgCpc:      Math.round((r.metrics?.average_cpc || 0) / 1_000_000),
          history:     kwHistory.slice(0, 7).map((h) => ({
            date: h.recordedAt,
            qs:   h.qualityScore,
          })),
        }
      })

    const keywords = allKeywords
      .filter((kw: any) =>
        filter === "ALL"      ? true :
        filter === "POOR"     ? kw.grade === "POOR" :
        filter === "DECLINING"? kw.trend === "DOWN"  :
        filter === "GOOD"     ? ["GOOD","EXCELLENT"].includes(kw.grade) :
        true
      )
      .sort((a: any, b: any) => {
        if (a.grade === "POOR" && b.grade !== "POOR") return -1
        if (b.grade === "POOR" && a.grade !== "POOR") return  1
        if (a.trend === "DOWN" && b.trend !== "DOWN") return -1
        if (b.trend === "DOWN" && a.trend !== "DOWN") return  1
        return (b.spend - a.spend)
      })

    // ── Ad-group rollup — impression-weighted QS + root-cause split ──
    // A flat keyword list buries the account's real priority order: a
    // low-QS keyword with 50 impressions matters far less than one with
    // 50,000. Rolling up per ad group with an impression-weighted average
    // (not a plain mean) and surfacing which single component is dragging
    // each group down turns the list into an actual worklist instead of
    // requiring someone to eyeball hundreds of rows.
    interface AdGroupAgg {
      adGroup: string
      adGroupResource: string
      campaign: string
      campaignId: string
      keywordCount: number
      poorCount: number
      totalImpressions: number
      totalSpend: number
      qsWeightedSum: number
      rootCauseCounts: Record<"AD_RELEVANCE" | "LANDING_PAGE" | "EXPECTED_CTR", number>
    }
    const adGroupMap: Record<string, AdGroupAgg> = {}
    for (const kw of allKeywords) {
      const key = kw.adGroupResource || `${kw.campaignId}:${kw.adGroup}`
      if (!adGroupMap[key]) {
        adGroupMap[key] = {
          adGroup: kw.adGroup,
          adGroupResource: kw.adGroupResource,
          campaign: kw.campaign,
          campaignId: kw.campaignId,
          keywordCount: 0,
          poorCount: 0,
          totalImpressions: 0,
          totalSpend: 0,
          qsWeightedSum: 0,
          rootCauseCounts: { AD_RELEVANCE: 0, LANDING_PAGE: 0, EXPECTED_CTR: 0 },
        }
      }
      const agg = adGroupMap[key]
      // Impression-weighted sum — a keyword with 0 impressions this week
      // still counts toward keywordCount/poorCount but contributes nothing
      // to the weighted QS average (no real traffic to weight it by).
      agg.keywordCount++
      agg.totalImpressions += kw.impressions
      agg.totalSpend += kw.spend
      agg.qsWeightedSum += kw.qs * kw.impressions
      if (kw.grade === "POOR") agg.poorCount++
      if (kw.weakest) agg.rootCauseCounts[kw.weakest as "AD_RELEVANCE" | "LANDING_PAGE" | "EXPECTED_CTR"]++
    }

    const ROOT_CAUSE_LABEL: Record<string, string> = {
      AD_RELEVANCE: t("libgoogle.qs.rc.AD_RELEVANCE"),
      LANDING_PAGE: t("libgoogle.qs.rc.LANDING_PAGE"),
      EXPECTED_CTR: t("libgoogle.qs.rc.EXPECTED_CTR"),
    }

    // Concrete "làm gì tiếp theo" per nguyên nhân chính — the rollup used to
    // stop at diagnosis (which component is weak) without saying what to
    // actually change, so priority-sorting the worklist didn't help decide
    // the next action. count = số từ khóa trong nhóm bị nguyên nhân này.
    const recommendedActionFor = (
      cause: [string, number] | undefined,
      poorCount: number
    ): string => {
      if (!cause) {
        return poorCount > 0
          ? t("libgoogle.qs.actMixed", { n: poorCount })
          : t("libgoogle.qs.actOk")
      }
      const [type, count] = cause
      if (type === "AD_RELEVANCE") {
        return t("libgoogle.qs.actAd", { n: count })
      }
      if (type === "LANDING_PAGE") {
        return t("libgoogle.qs.actLp", { n: count })
      }
      if (type === "EXPECTED_CTR") {
        return t("libgoogle.qs.actCtr", { n: count })
      }
      return t("libgoogle.qs.actDefault")
    }

    const adGroupRollup = Object.values(adGroupMap)
      .map((agg) => {
        const weightedQS = agg.totalImpressions > 0
          ? Math.round((agg.qsWeightedSum / agg.totalImpressions) * 10) / 10
          : null
        const causes = Object.entries(agg.rootCauseCounts) as Array<[string, number]>
        const topCause = causes.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
        // Priority = severity × scale — a QS-1 group with 12 impressions
        // wastes almost nothing; a QS-5 group with 5,000 impressions is
        // real money sitting on a fixable problem. Sorting by QS alone
        // (with impressions only as a tie-break) would rank the former
        // above the latter, which is backwards for an actual worklist.
        const impactScore = weightedQS !== null ? (10 - weightedQS) * agg.totalImpressions : 0
        return {
          adGroup: agg.adGroup,
          adGroupResource: agg.adGroupResource,
          campaign: agg.campaign,
          campaignId: agg.campaignId,
          keywordCount: agg.keywordCount,
          poorCount: agg.poorCount,
          totalImpressions: agg.totalImpressions,
          totalSpend: Math.round(agg.totalSpend),
          weightedQS,
          primaryRootCause: topCause ? { type: topCause[0], count: topCause[1], label: ROOT_CAUSE_LABEL[topCause[0]] } : null,
          recommendedAction: recommendedActionFor(topCause, agg.poorCount),
          impactScore: Math.round(impactScore),
        }
      })
      // Highest impact (severity × real traffic) first — this is what
      // "ưu tiên xử lý" actually means: fix the group where a low score is
      // costing the most, not just whichever group happens to score worst.
      .sort((a, b) => b.impactScore - a.impactScore)

    // ── Rollup theo landing page ──
    // Nối bằng ad_group.id: landing_page_view trả metrics theo (ad group, URL),
    // còn nguyên nhân LANDING_PAGE nằm ở keyword. Một ad group có thể đổ về
    // nhiều URL, nên số keyword bị ảnh hưởng được quy về từng URL của chính ad
    // group đó — không suy đoán keyword nào ứng với URL nào (Google không cho
    // biết điều đó ở mức keyword).
    const lpResult = await landingPagePromise

    interface LandingPageRollup {
      url: string
      keywordCount: number
      poorLpCount: number
      totalImpressions: number
      totalClicks: number
      totalSpend: number
      totalConversions: number
      weightedQs: number | null
      adGroups: string[]
    }

    let landingPageRollup: LandingPageRollup[] = []
    let landingPageError: string | null = null
    const landingPageMode = lpResult.mode

    if (lpResult.downgradeReason) {
      console.warn(
        "[quality-score] landing_page_view không nhận ad_group.id, đã hạ xuống chế độ chỉ-theo-URL:",
        lpResult.downgradeReason,
      )
    }

    if (!lpResult.ok) {
      landingPageError = lpResult.error ?? t("libgoogle.qs.lpErr")
    } else {
      // Chỉ số theo ad group từ phía keyword — dùng để quy về URL.
      const kwByAdGroup = new Map<string, { poorLp: number; count: number; qsSum: number; impr: number; name: string }>()
      for (const kw of allKeywords) {
        const key = String(kw.adGroupId || "")
        if (!key) continue
        const agg = kwByAdGroup.get(key) ?? { poorLp: 0, count: 0, qsSum: 0, impr: 0, name: kw.adGroup }
        agg.count++
        agg.qsSum += kw.qs * kw.impressions
        agg.impr += kw.impressions
        if (kw.weakest === "LANDING_PAGE") agg.poorLp++
        kwByAdGroup.set(key, agg)
      }

      const byUrl = new Map<string, LandingPageRollup & { qsWeightedSum: number; qsImpr: number }>()
      for (const row of lpResult.rows) {
        const url = row.url
        if (!url) continue
        // Chế độ url_only không có ad_group → không quy được số từ khóa về URL.
        // Để trống chứ không gán bừa nhóm nào.
        const kwAgg = row.adGroupId ? kwByAdGroup.get(row.adGroupId) : undefined

        type LpEntry = LandingPageRollup & { qsWeightedSum: number; qsImpr: number }
        const entry: LpEntry = byUrl.get(url) ?? {
          url,
          keywordCount: 0,
          poorLpCount: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalSpend: 0,
          totalConversions: 0,
          weightedQs: null,
          adGroups: [],
          qsWeightedSum: 0,
          qsImpr: 0,
        }

        entry.totalImpressions += row.impressions
        entry.totalClicks += row.clicks
        entry.totalSpend += row.spendVnd
        entry.totalConversions += row.conversions

        if (kwAgg) {
          entry.keywordCount += kwAgg.count
          entry.poorLpCount += kwAgg.poorLp
          entry.qsWeightedSum += kwAgg.qsSum
          entry.qsImpr += kwAgg.impr
          if (kwAgg.name && !entry.adGroups.includes(kwAgg.name)) entry.adGroups.push(kwAgg.name)
        }

        byUrl.set(url, entry)
      }

      landingPageRollup = [...byUrl.values()]
        .map(({ qsWeightedSum, qsImpr, ...rest }) => ({
          ...rest,
          weightedQs: qsImpr > 0 ? Math.round((qsWeightedSum / qsImpr) * 10) / 10 : null,
        }))
        // Trang nào đang bị nhiều keyword quy trách nhiệm nhất, rồi tới tiền.
        .sort((a, b) => (b.poorLpCount - a.poorLpCount) || (b.totalSpend - a.totalSpend))
    }

    // ── Lưu snapshot QS hôm nay (1 lần/ngày) ──
    const alreadySaved = allHistory.some(
      h => h.company === company && dateOf(h) === today
    )

    if (!alreadySaved) {
      const newRecords: QSRecord[] = rows
        .filter((r: any) =>
          (r.ad_group_criterion?.quality_info?.quality_score || 0) > 0
        )
        .map((r: any) => ({
          company,
          criterionId:  String(r.ad_group_criterion?.criterion_id),
          keyword:      r.ad_group_criterion?.keyword?.text || "",
          qualityScore: r.ad_group_criterion?.quality_info?.quality_score || 0,
          expectedCtr:  enumName(enums.QualityScoreBucket, r.ad_group_criterion?.quality_info?.search_predicted_ctr),
          adRelevance:  enumName(enums.QualityScoreBucket, r.ad_group_criterion?.quality_info?.creative_quality_score),
          landingPage:  enumName(enums.QualityScoreBucket, r.ad_group_criterion?.quality_info?.post_click_quality_score),
          recordedAt:   new Date().toISOString(),
          recordedDate: today,
        }))

      await writeQSHistory([...allHistory, ...newRecords])
    }

    // ── Summary stats ──
    const poorCount      = keywords.filter((k: any) => k.grade === "POOR").length
    const decliningCount = keywords.filter((k: any) => k.trend === "DOWN").length
    const avgQS = keywords.length > 0
      ? Math.round(keywords.reduce((s: number, k: any) =>
          s + k.qs, 0) / keywords.length * 10) / 10
      : 0

    return NextResponse.json({
      total:     keywords.length,
      poor:      poorCount,
      declining: decliningCount,
      avgQS,
      keywords,
      adGroupRollup,
      landingPageRollup,
      landingPageError,
      // "with_adgroup" = quy được số từ khóa lỗi trang về từng URL.
      // "url_only"     = Google không cho nối ad_group, chỉ có chi phí theo URL.
      landingPageMode,
      // Cho UI nói rõ đang so với mốc nào thay vì chỉ hiện mũi tên lên/xuống.
      history: historyCoverage(allHistory, company),
      // QS là ảnh chụp hiện tại của Google; chi phí/impression là 7 ngày.
      // Hai loại số khác bản chất nằm cạnh nhau nên phải nói ra.
      performanceWindow: "LAST_7_DAYS",
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: friendlyError(error.message) },
      { status: 500 }
    )
  }
}
