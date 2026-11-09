import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"
import { createdNames, guardedMutate, WriteGuardError } from "@/lib/write-guard"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { enumName }                  from "@/lib/google-ads-enums"
import { getCurrentUser }            from "@/lib/auth"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { safeDateRange, safeNumericId, safeResourceName, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
// Removed unused db

// 24 giờ × 7 ngày = 168 ô
// Mỗi ô có: spend, conv, cpl, clicks

export async function GET(req: NextRequest) {
  const t = await getT()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const company    = (searchParams.get("company")    || "MBC") as string
  let campaignId: string | null
  let dateRange: string
  try {
    campaignId = safeNumericId(searchParams.get("campaignId"))
    dateRange  = safeDateRange(searchParams.get("range"))
  } catch (err) {
    if (err instanceof InvalidGaqlInput) {
      return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
    }
    throw err
  }

  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
  }

  const customer = getGoogleAdsCustomer(company)

  const whereClause = campaignId
    ? `AND campaign.id = ${campaignId}` : ""

  // ── Pull data theo giờ × ngày ──
  const rows = await customer.query(`
    SELECT
      segments.hour,
      segments.day_of_week,
      campaign.id,
      campaign.name,
      campaign.resource_name,
      metrics.cost_micros,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND segments.date DURING ${dateRange}
      ${whereClause}
  `)

  // ── Tổng hợp vào grid 7×24 ──
  const DAYS = [
    "MONDAY","TUESDAY","WEDNESDAY",
    "THURSDAY","FRIDAY","SATURDAY","SUNDAY"
  ]
  const DAY_LABEL = ["T2","T3","T4","T5","T6","T7","CN"]

  // Grid: day → hour → stats
  const grid: Record<string, Record<number, {
    spend: number, conv: number, clicks: number
  }>> = {}

  for (const day of DAYS) {
    grid[day] = {}
    for (let h = 0; h < 24; h++) {
      grid[day][h] = { spend: 0, conv: 0, clicks: 0 }
    }
  }

  for (const row of rows) {
    // segments.day_of_week comes back from customer.query() as a raw
    // numeric enum (2=MONDAY..8=SUNDAY), not the string key "MONDAY" the
    // grid is indexed by — the old direct-index lookup never matched a
    // single row, so the heatmap was always 100% empty regardless of real
    // spend/conversion data.
    const day  = enumName(enums.DayOfWeek, row.segments?.day_of_week)
    const hour = row.segments?.hour
    if (!grid[day] || hour == null || !grid[day]?.[hour]) continue
    grid[day][hour].spend  += (row.metrics?.cost_micros || 0) / 1_000_000
    grid[day][hour].conv   += row.metrics?.conversions || 0
    grid[day][hour].clicks += row.metrics?.clicks || 0
  }

  // ── Tính CPL từng ô ──
  // Tính avg CPL để so sánh
  const allCells = DAYS.flatMap(day =>
    Array.from({ length: 24 }, (_, h) => grid[day][h])
  )
  const totalSpend  = allCells.reduce((s, c) => s + c.spend, 0)
  const totalConv   = allCells.reduce((s, c) => s + c.conv,  0)
  const totalClicks = allCells.reduce((s, c) => s + c.clicks, 0)
  const avgCPL      = totalConv > 0 ? totalSpend / totalConv : 0

  // ── Ngưỡng dữ liệu tối thiểu để được chấm hạng ──
  //
  // VÌ SAO CẦN: bản trước chấm hạng MỌI ô có ≥1 click. Một ô 7 click, 1
  // chuyển đổi tình cờ là lên thẳng hạng S — rồi tool khuyên dồn tiền vào
  // đúng giờ đó. Ngược lại, ô ít click mà 0 chuyển đổi bị chấm F và khuyên
  // tắt, trong khi với tỷ lệ chuyển đổi thấp thì 0 chuyển đổi ở 20 click là
  // chuyện hoàn toàn bình thường.
  //
  // VÌ SAO KHÔNG DÙNG SỐ CỨNG: ngưỡng phải suy từ tỷ lệ chuyển đổi của chính
  // tài khoản. Đo 22/09/2026:
  //   MBC — tỷ lệ 7,60% → ~27 click mới kỳ vọng 2 chuyển đổi
  //   MBI — tỷ lệ 0,54% → ~371 click mới kỳ vọng 2 chuyển đổi
  // Đặt cứng 30 thì MBC gần như không đổi (đúng), còn MBI vẫn chấm 74 ô và
  // khuyên tắt 60 giờ — vẫn là nhiễu. Cùng một con số, một bên đúng một bên
  // sai, nên nó phải là số TÍNH RA chứ không phải số chọn sẵn.
  const convRate = totalClicks > 0 ? totalConv / totalClicks : 0
  // Đòi đủ click để kỳ vọng 2 chuyển đổi. Một chuyển đổi thì CPL của ô đó
  // chính là toàn bộ chi tiêu của ô — quá nhạy với may rủi.
  const MIN_EXPECTED_CONV = 2
  // Sàn 15: tỷ lệ chuyển đổi cao bất thường không được làm ngưỡng tụt về 1-2.
  const minClicksForGrade = convRate > 0
    ? Math.max(15, Math.ceil(MIN_EXPECTED_CONV / convRate))
    : Number.POSITIVE_INFINITY

  // ── Score từng ô: tốt / trung / kém / rỗng ──
  const result = DAYS.map((day, di) => ({
    day:   DAY_LABEL[di],
    dayKey: day,
    hours: Array.from({ length: 24 }, (_, h) => {
      const cell = grid[day][h]
      const cpl  = cell.conv > 0
        ? cell.spend / cell.conv : null

      // Grade: S/A/B/C/F
      let grade = "EMPTY"
      if (cell.clicks > 0 && cell.clicks < minClicksForGrade) {
        // Có số liệu nhưng CHƯA ĐỦ để kết luận. Khác hẳn EMPTY (không có gì)
        // và khác hẳn một hạng — phải hiện ra là "chưa đủ dữ liệu", đừng gán
        // cho nó một hạng mà người đọc sẽ hành động theo.
        grade = "THIN"
      } else if (cell.clicks > 0) {
        if (!cpl) {
          // Có clicks nhưng 0 conv
          grade = cell.spend > 100_000 ? "F" : "C"
        } else if (cpl < avgCPL * 0.7)  grade = "S"  // Xuất sắc
        else if (cpl < avgCPL)           grade = "A"  // Tốt
        else if (cpl < avgCPL * 1.3)     grade = "B"  // Trung bình
        else if (cpl < avgCPL * 1.8)     grade = "C"  // Kém
        else                              grade = "F"  // Rất kém
      }

      return {
        hour:   h,
        label:  `${h}:00`,
        spend:  Math.round(cell.spend),
        conv:   cell.conv,
        clicks: cell.clicks,
        cpl:    cpl ? Math.round(cpl) : null,
        grade,
        // Nên tắt nếu grade F + spend đáng kể. Ô THIN không bao giờ vào đây
        // — không đủ dữ liệu thì không được khuyên tắt.
        shouldPause: grade === "F" && cell.spend > 50_000,
      }
    }),
  }))

  // ── Tính tiết kiệm nếu tắt giờ F ──
  const wastedSpend = result.flatMap(d => d.hours)
    .filter(h => h.shouldPause)
    .reduce((s, h) => s + h.spend, 0)

  // ── Gợi ý schedule: giờ nào nên chạy ──
  // Group giờ tốt: grade S hoặc A, liên tiếp
  const recommendation = buildScheduleRecommendation(result, avgCPL, t)

  // ── Pull campaign list ──
  const campaigns = [...new Map(
    rows.map((r: any) => [r.campaign?.id, {
      id: r.campaign?.id, name: r.campaign?.name, resourceName: r.campaign?.resource_name
    }])
  ).values()]

  // ── Nói thẳng tài khoản này có đủ dữ liệu để chia theo giờ không ──
  //
  // Không đủ mà vẫn vẽ lưới màu mè là mời người dùng hành động theo may rủi.
  const allHours   = result.flatMap(d => d.hours)
  const thinCells  = allHours.filter(h => h.grade === "THIN").length
  const gradedCells = allHours.filter(h => h.grade !== "EMPTY" && h.grade !== "THIN").length
  const maxClicks  = Math.max(0, ...allHours.map(h => h.clicks))
  // "Đủ tin" khi có ít nhất 10 ô được chấm VÀ số ô được chấm nhiều hơn số ô
  // bị loại vì mỏng. Dưới mức đó, lưới nói nhiều hơn dữ liệu cho phép.
  const reliable = gradedCells >= 10 && gradedCells >= thinCells

  // ── Mức THỨ: khi chia theo giờ quá mỏng thì gộp lên vẫn dùng được ──
  //
  // 168 khung giờ chia nhau một ít chuyển đổi thì ô nào cũng mỏng. Gộp lên 7
  // nhóm là mỗi nhóm nhiều gấp 24 lần dữ liệu. Đo 22/09/2026: MBI theo giờ
  // được 0/168 ô đủ căn cứ, nhưng theo THỨ được 7/7.
  const dayLevel = result.map((d, i) => {
    const spend  = d.hours.reduce((n: number, h: { spend: number }) => n + h.spend, 0)
    const conv   = d.hours.reduce((n: number, h: { conv: number }) => n + h.conv, 0)
    const clicks = d.hours.reduce((n: number, h: { clicks: number }) => n + h.clicks, 0)
    const cpl    = conv > 0 ? spend / conv : null
    let grade = "EMPTY"
    if (clicks > 0 && clicks < minClicksForGrade) grade = "THIN"
    else if (clicks > 0) {
      if (!cpl) grade = spend > 100_000 ? "F" : "C"
      else if (cpl < avgCPL * 0.7) grade = "S"
      else if (cpl < avgCPL)       grade = "A"
      else if (cpl < avgCPL * 1.3) grade = "B"
      else if (cpl < avgCPL * 1.8) grade = "C"
      else                          grade = "F"
    }
    return {
      day: d.day, label: DAY_LABEL[i],
      spend: Math.round(spend), conv: Math.round(conv * 10) / 10, clicks,
      cpl: cpl ? Math.round(cpl) : null, grade,
    }
  })
  const dayLevelUsable = dayLevel.filter(d => d.grade !== "EMPTY" && d.grade !== "THIN").length

  const dataQuality = {
    convRate: Math.round(convRate * 10000) / 100,           // %
    minClicksForGrade: Number.isFinite(minClicksForGrade) ? minClicksForGrade : null,
    gradedCells,
    thinCells,
    maxClicksInOneCell: maxClicks,
    reliable,
    note: reliable
      ? null
      : Number.isFinite(minClicksForGrade)
        ? t("libgoogle.dp.note", { rate: (convRate * 100).toFixed(2), min: minClicksForGrade, max: maxClicks, tail: dayLevelUsable >= 5 ? t("libgoogle.dp.tailDay", { n: dayLevelUsable }) : t("libgoogle.dp.tailLong") })
        : t("libgoogle.dp.noConv"),
  }

  return NextResponse.json({
    avgCPL:   Math.round(avgCPL),
    wastedSpend: Math.round(wastedSpend),
    dataQuality,
    // Chỉ gửi khi mức giờ không dùng được — không thì thừa.
    dayLevel: reliable ? null : { rows: dayLevel, usable: dayLevelUsable },
    grid:     result,
    // Không đủ tin thì KHÔNG đưa gợi ý tắt/giảm giá thầu. Gợi ý sai còn hại
    // hơn không có gợi ý — người dùng tắt nhầm khung giờ đang ra đơn.
    recommendation: reliable
      ? recommendation
      : { pauseHours: [], reduceBid: [], summary: dataQuality.note },
    campaigns,
  })
}

function buildScheduleRecommendation(grid: any[], avgCPL: number, t: TFunction = viT) {
  // Kiểm tra xem có đủ data không (cần ít nhất có clicks)
  const totalClicks = grid.flatMap(d => d.hours).reduce((s: number, h: any) => s + h.clicks, 0)
  if (totalClicks === 0) {
    return {
      pauseHours: [],
      reduceBid:  [],
      summary: t("libgoogle.dp.sumNoData"),
    }
  }

  // Chỉ đề xuất tắt giờ có grade F thực sự (có chi tiêu + không có conversion)
  // Không tính EMPTY vì đó là giờ không có data
  const badHours: number[] = []
  for (let h = 0; h < 24; h++) {
    const hasAnyF = grid.some(day => day.hours[h]?.grade === "F")
    const allFOrEmpty = grid.every(day => {
      const cell = day.hours[h]
      return cell.grade === "F" || cell.grade === "EMPTY"
    })
    // Chỉ đề xuất nếu có ít nhất 1 ngày F và không có ngày nào S/A/B
    if (hasAnyF && allFOrEmpty) badHours.push(h)
  }

  // Tìm các ngày nên giảm bid
  const badDays = avgCPL > 0
    ? grid
        .filter(day => {
          const dayAvgCPL = day.hours
            .filter((h: any) => h.conv > 0)
            .reduce((s: number, h: any, _: any, arr: any[]) =>
              s + (h.cpl || 0) / arr.length, 0)
          return dayAvgCPL > avgCPL * 1.3 && dayAvgCPL > 0
        })
        .map((d: any) => d.day)
    : []

  return {
    pauseHours: badHours,
    reduceBid:  badDays,
    summary: badHours.length > 0
      ? t("libgoogle.dp.sumPause", { hours: badHours.map(h => `${h}:00`).join(", ") })
      : t("libgoogle.dp.sumNone"),
  }
}

// ── Apply Ad Schedule ──
export async function POST(req: NextRequest) {
  const t = await getT()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const {
    company,
    campaignResourceName: rawCampaignResourceName,
    pauseHours,    // [22, 23, 0, 1, 2, 3, 4]
    reduceBidDays, // ["SATURDAY", "SUNDAY"]
    reduceBidPct,  // 20
    validateOnly,  // Đợt 11d: true = chỉ Kiểm trước
    confirmText,   // ghi thật cần "XAC NHAN" (thiếu → 428)
  } = await req.json()

  // This handler removes and recreates real ad schedules on a live Google
  // Ads account. It previously checked only that SOMEONE was logged in —
  // `company` came from the body and went straight to
  // getGoogleAdsCustomer(), so a read-only viewer scoped to one company
  // could rewrite the other company's schedules. (The GET handler above
  // has always had the tenant check; POST never did.)
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: t("libgoogle.dp.noEdit") }, { status: 403 })
  }
  if (!isCompany(company)) {
    return NextResponse.json({ error: t("libgoogle.dp.noCompany") }, { status: 400 })
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
  }

  // Interpolated into a quoted GAQL literal below — reject anything that
  // could close the quote instead of trusting the body.
  let campaignResourceName: string
  try {
    campaignResourceName = safeResourceName(rawCampaignResourceName)
  } catch (err) {
    if (err instanceof InvalidGaqlInput) {
      return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
    }
    throw err
  }

  const customer = getGoogleAdsCustomer(company)

  const DAY_MAP: Record<string, number> = {
    MONDAY: 2, TUESDAY: 3, WEDNESDAY: 4,
    THURSDAY: 5, FRIDAY: 6, SATURDAY: 7, SUNDAY: 8
  }

  // Build ad schedule: 7 ngày × các giờ không bị pause
  const schedules: any[] = []
  const ALL_DAYS = Object.keys(DAY_MAP)

  for (const day of ALL_DAYS) {
    const isReduceDay = reduceBidDays?.includes(day)

    // Group giờ chạy liên tiếp
    let startHour = -1
    for (let h = 0; h <= 24; h++) {
      const isPaused = pauseHours?.includes(h % 24)

      if (!isPaused && startHour === -1) {
        startHour = h // Bắt đầu khoảng giờ chạy
      } else if ((isPaused || h === 24) && startHour !== -1) {
        // Kết thúc khoảng → thêm schedule
        schedules.push({
          day_of_week: day,
          start_hour:  startHour,
          end_hour:    h,
          // Giảm bid nếu ngày kém
          bid_modifier: isReduceDay
            ? 1 - (Number(reduceBidPct ?? 20) || 0) / 100
            : 1.0,
        })
        startHour = -1
      }
    }
  }

  // ── Chặn trước khi đụng vào tài khoản ──
  //
  // Tạm dừng cả 24 giờ làm `schedules` rỗng. Đường ghi bên dưới là "xoá hết rồi
  // tạo lại", mà bước tạo có điều kiện `if (newCriteria.length > 0)` — nên lịch
  // rỗng nghĩa là xoá sạch và không tạo gì. Campaign không còn ad schedule thì
  // Google cho chạy MỌI GIỜ: một thao tác nhằm giảm chi tiêu lại cho ra mức tối
  // đa. Không có cách nào diễn đạt "không bao giờ chạy" bằng ad schedule; việc
  // đúng là tạm dừng campaign.
  if (schedules.length === 0) {
    return NextResponse.json({
      error: t("libgoogle.dp.all24"),
    }, { status: 400 })
  }

  // bid_modifier = 1 - reduceBidPct/100, mà reduceBidPct đến thẳng từ thân
  // request. reduceBidPct âm (vd -900) cho ra hệ số 10 — tăng bid gấp 10 lần từ
  // một nút tên là "giảm bid". Trên 100 cho ra hệ số âm, Google từ chối cả lô và
  // để campaign trơ ra không lịch (xem đoạn khôi phục bên dưới).
  const pct = Number(reduceBidPct ?? 20)
  if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
    return NextResponse.json({
      error: t("libgoogle.dp.bidRange"),
    }, { status: 400 })
  }
  // Chặn thêm ở tầng số: Google chỉ nhận hệ số 0,1–10.
  for (const sc of schedules) {
    if (!Number.isFinite(sc.bid_modifier) || sc.bid_modifier < 0.1 || sc.bid_modifier > 10) {
      return NextResponse.json({
        error: t("libgoogle.dp.modRange", { v: sc.bid_modifier }),
      }, { status: 400 })
    }
  }

  // ── Xoá lịch cũ + tạo lịch mới ──
  //
  // Google Ads không có giao dịch cho hai thao tác này, nên giữa remove và create
  // có một khoảng campaign KHÔNG có lịch nào — tức được chạy mọi giờ. Bản cũ để
  // create ném thẳng ra ngoài: người dùng thấy báo lỗi và hiểu là "không có gì
  // thay đổi", trong khi thực tế lịch cũ đã bị xoá và campaign đang chạy 24/7.
  //
  // Nên đọc đủ trường của lịch cũ (không chỉ resource_name) để còn dựng lại được,
  // và nếu create hỏng thì khôi phục. Khôi phục cũng hỏng thì phải nói thẳng ra
  // rằng campaign hiện KHÔNG có lịch — im lặng ở đây là đắt nhất.
  const existing = await customer.query(`
    SELECT campaign_criterion.resource_name,
           campaign_criterion.ad_schedule.day_of_week,
           campaign_criterion.ad_schedule.start_hour,
           campaign_criterion.ad_schedule.start_minute,
           campaign_criterion.ad_schedule.end_hour,
           campaign_criterion.ad_schedule.end_minute,
           campaign_criterion.bid_modifier
    FROM campaign_criterion
    WHERE campaign.resource_name = '${campaignResourceName}'
      AND campaign_criterion.type = 'AD_SCHEDULE'
  `)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previousCriteria = existing.map((e: any) => ({
    campaign: campaignResourceName,
    type:     "AD_SCHEDULE" as const,
    ad_schedule: {
      day_of_week:  e.campaign_criterion?.ad_schedule?.day_of_week,
      start_hour:   e.campaign_criterion?.ad_schedule?.start_hour,
      start_minute: e.campaign_criterion?.ad_schedule?.start_minute ?? "ZERO",
      end_hour:     e.campaign_criterion?.ad_schedule?.end_hour,
      end_minute:   e.campaign_criterion?.ad_schedule?.end_minute ?? "ZERO",
    },
    bid_modifier: e.campaign_criterion?.bid_modifier,
  }))

  const newCriteria = schedules.map(schedule => ({
    campaign: campaignResourceName,
    type:     "AD_SCHEDULE" as const,
    ad_schedule: {
      day_of_week: schedule.day_of_week,
      start_hour:  schedule.start_hour,
      start_minute:"ZERO" as const,
      end_hour:    schedule.end_hour,
      end_minute:  "ZERO" as const,
    },
    bid_modifier: schedule.bid_modifier,
  }))

  // Đợt 11d: gỡ lịch cũ + tạo lịch mới trong MỘT lệnh nguyên khối qua lớp ghi an toàn. Bản cũ gỡ rồi mới tạo (2 lệnh) — hỏng
  // giữa chừng thì chiến dịch KHÔNG có lịch (chạy 24/7) và phải tự khôi phục. Nguyên khối: hỏng là không đổi gì. Lệnh ngược =
  // gỡ lịch mới + tạo lại lịch cũ (hoàn tác ở /api/write-log).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removeOps = existing.map((e: any) => ({ entity: "campaign_criterion", operation: "remove" as const, resource: String(e.campaign_criterion.resource_name) }))
  const createOps = newCriteria.map((r) => ({ entity: "campaign_criterion", operation: "create" as const, resource: { campaign: r.campaign, ad_schedule: r.ad_schedule, bid_modifier: r.bid_modifier } }))
  let writeId: string | undefined
  try {
    const g = await guardedMutate({
      company, source: "toolkit/dayparting", label: `Lịch chạy ${campaignResourceName.split("/").pop()}: ${schedules.length} khung (tạm dừng ${Array.isArray(pauseHours) ? pauseHours.length : 0} giờ)`,
      ops: [...removeOps, ...createOps],
      inverseOf: (resp) => [
        ...createdNames(resp).slice(removeOps.length).filter((n): n is string => !!n).map((n) => ({ entity: "campaign_criterion", operation: "remove" as const, resource: n })),
        ...previousCriteria.map((r: { campaign: string; ad_schedule: unknown; bid_modifier?: number }) => ({ entity: "campaign_criterion", operation: "create" as const, resource: { campaign: r.campaign, ad_schedule: r.ad_schedule, ...(r.bid_modifier ? { bid_modifier: r.bid_modifier } : {}) } })),
      ],
      validateOnly, confirmText, actor: user.email,
    })
    if (!g.entry) return NextResponse.json({ success: true, validated: true, schedulesApplied: 0, count: schedules.length })
    writeId = g.entry.id
  } catch (e) {
    if (e instanceof WriteGuardError) return NextResponse.json({ success: false, error: friendlyError(e.message), needsConfirm: e.status === 428, validated: e.validated }, { status: e.status })
    throw e
  }

  console.log("Saved schedule history:", {
    company,
    campaignResourceName,
    pauseHours:    JSON.stringify(pauseHours),
    reduceBidDays: JSON.stringify(reduceBidDays),
    appliedAt:     new Date(),
  })

  return NextResponse.json({
    success:        true,
    schedulesApplied: schedules.length,
    writeId,
  })
}
