import { NextRequest, NextResponse } from "next/server"
import { geoDisplayNameVi } from "@/lib/google-targeting"
import { safeDateRange, safeNumericId, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { enumName } from "@/lib/google-ads-enums"
import { getCurrentUser } from "@/lib/auth"
import { canAccessCompany } from "@/lib/permissions"
import { friendlyError } from "@/lib/not-configured";

// ── Segment analysis: Device / Location / Audience ──
/**
 * `geographic_view.location_type` về dưới dạng SỐ enum, không phải chữ.
 * Bản trước ép String() rồi in ra, nên nếu có in cũng chỉ ra "2" hay "3".
 *
 * Đo trên tài khoản MBC ngày 21/09/2026: chỉ gặp 2 và 3.
 *   2 = AREA_OF_INTEREST     — người ở NƠI KHÁC nhưng tìm về nơi này
 *   3 = LOCATION_OF_PRESENCE — người ĐANG Ở nơi này
 *
 * Phân biệt được hai cái này mới đọc được bảng: TP.HCM đứng hạng 1 (đang ở)
 * và hạng 3 (quan tâm) là HAI tập người khác nhau, không phải dòng trùng.
 * Nhận cả số lẫn chữ vì tuỳ phiên bản thư viện có thể trả ra dạng nào.
 */
function geoLocationTypeLabel(v: unknown): string {
  const k = String(v ?? "")
  if (k === "3" || k === "LOCATION_OF_PRESENCE") return "đang ở đây"
  if (k === "2" || k === "AREA_OF_INTEREST")     return "quan tâm tới đây"
  if (k === "1" || k === "UNKNOWN")              return "không rõ kiểu"
  return k ? `kiểu ${k}` : "không rõ kiểu"
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const company  = (searchParams.get("company")  || "MBC") as string
    const segment  = searchParams.get("segment")  || "device"  // device | location | adschedule
    let range: string
    try {
      range = safeDateRange(searchParams.get("range"))
    } catch (err) {
      if (err instanceof InvalidGaqlInput) return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
      throw err
    }

    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
    }

    const customer = getGoogleAdsCustomer(company)

    if (segment === "device") {
      const rows = await customer.query(`
        SELECT
          segments.device,
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND segments.date DURING ${range}
      `)

      const DEVICE_LABEL: Record<string, string> = {
        MOBILE:  "📱 Mobile",
        DESKTOP: "🖥️ Desktop",
        TABLET:  "📟 Tablet",
        CONNECTED_TV: "📺 TV",
        UNKNOWN: "Khác",
        UNSPECIFIED: "Không xác định",
      }

      const map: Record<string, { spend: number; clicks: number; impressions: number; conversions: number; convValue: number }> = {}
      for (const row of rows as any[]) {
        // segments.device comes back from customer.query() as a raw
        // numeric enum, not the string "MOBILE"/"DESKTOP" DEVICE_LABEL is
        // keyed by — every row fell through to the id-as-label fallback,
        // showing "2", "3"... instead of real device names. Aggregation
        // itself was still correct (all "2" rows grouped together) since
        // the bug was in the label lookup, not the grouping key.
        const device = enumName(enums.Device, row.segments?.device)
        if (!map[device]) map[device] = { spend: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 }
        map[device].spend        += Number(row.metrics?.cost_micros ?? 0) / 1_000_000
        map[device].clicks       += Number(row.metrics?.clicks ?? 0)
        map[device].impressions  += Number(row.metrics?.impressions ?? 0)
        map[device].conversions  += Number(row.metrics?.conversions ?? 0)
        map[device].convValue    += Number(row.metrics?.conversions_value ?? 0)
      }

      const total = Object.values(map).reduce((s, v) => s + v.spend, 0)
      const data = Object.entries(map)
        .filter(([, v]) => v.spend > 0)
        .map(([device, v]) => ({
          label:       DEVICE_LABEL[device] ?? device,
          device,
          spend:       Math.round(v.spend),
          clicks:      v.clicks,
          impressions: v.impressions,
          conversions: Math.round(v.conversions * 100) / 100,
          cpl:         v.conversions > 0 ? Math.round(v.spend / v.conversions) : null,
          ctr:         v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
          pctSpend:    total > 0 ? Math.round((v.spend / total) * 100) : 0,
        }))
        .sort((a, b) => b.spend - a.spend)

      return NextResponse.json({ success: true, segment: "device", data, totalSpend: Math.round(total) })
    }

    if (segment === "location") {
      const rows = await customer.query(`
        SELECT
          geographic_view.location_type,
          segments.geo_target_city,
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions
        FROM geographic_view
        WHERE segments.date DURING ${range}
          AND metrics.impressions > 0
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `)

      const total = (rows as any[]).reduce((s: number, r: any) =>
        s + Number(r.metrics?.cost_micros ?? 0) / 1_000_000, 0)

      // ── Tra TÊN THẬT của địa điểm ──
      // `segments.geo_target_city` chỉ trả resource name thô
      // ("geoTargetConstants/1028581"). Bản trước in thẳng chuỗi đó ra màn
      // hình, nên bảng Vị trí toàn mã số — không ai đọc được đó là đâu.
      // Tên nằm ở resource khác (`geo_target_constant`), phải hỏi thêm một
      // lượt. Gom hết mã rồi hỏi MỘT lần, không hỏi từng dòng.
      type GeoSeg = { segments?: { geo_target_city?: string } }
      type GeoConst = { geo_target_constant?: { resource_name?: string; name?: string } }

      const geoRns = Array.from(new Set(
        (rows as GeoSeg[])
          .map((r) => String(r.segments?.geo_target_city ?? ""))
          .filter((x) => x.startsWith("geoTargetConstants/"))
      ))
      const geoName = new Map<string, string>()
      if (geoRns.length > 0) {
        try {
          const g = await customer.query(`
            SELECT geo_target_constant.resource_name, geo_target_constant.name
            FROM geo_target_constant
            WHERE geo_target_constant.resource_name IN (${geoRns.map(x => `'${x.replace(/'/g, "")}'`).join(",")})
          `)
          for (const row of g as unknown as GeoConst[]) {
            const rn = row.geo_target_constant?.resource_name
            const nm = row.geo_target_constant?.name
            if (rn && nm) geoName.set(String(rn), String(nm))
          }
        } catch {
          // Tra hỏng thì để nguyên mã số — vẫn hơn là bịa tên. Dòng nào không
          // tra được sẽ hiện "Mã 1028581" để người đọc biết là mã, không phải tên.
        }
      }

      const data = (rows as any[])
        .filter((r: any) => Number(r.metrics?.cost_micros ?? 0) > 0)
        .map((r: any) => {
          const spend      = Number(r.metrics?.cost_micros ?? 0) / 1_000_000
          const clicks     = Number(r.metrics?.clicks ?? 0)
          const impr       = Number(r.metrics?.impressions ?? 0)
          const conv       = Number(r.metrics?.conversions ?? 0)
          const cityId     = String(r.segments?.geo_target_city ?? "")
          const locType    = geoLocationTypeLabel(r.geographic_view?.location_type)
          const rawName    = geoName.get(cityId)
          const viName     = geoDisplayNameVi(rawName)
            ?? (cityId ? `Mã ${cityId.split("/").pop()}` : "Không xác định")
          return {
            // Kèm kiểu vào nhãn: cùng một thành phố xuất hiện HAI dòng (người
            // đang ở đó / người quan tâm tới đó) nên nếu chỉ in tên thì trông
            // y như lỗi trùng dòng — và React cũng trùng key.
            label:       `${viName} · ${locType}`,
            locationName: viName,
            locationType: locType,
            spend:       Math.round(spend),
            clicks,
            impressions: impr,
            conversions: Math.round(conv * 100) / 100,
            cpl:         conv > 0 ? Math.round(spend / conv) : null,
            ctr:         impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
            pctSpend:    total > 0 ? Math.round((spend / total) * 100) : 0,
          }
        })
        .slice(0, 30)

      return NextResponse.json({ success: true, segment: "location", data, totalSpend: Math.round(total) })
    }

    if (segment === "adschedule") {
      // Reuse day-of-week + hour breakdown but aggregate differently
      const rows = await customer.query(`
        SELECT
          segments.day_of_week,
          metrics.cost_micros,
          metrics.clicks,
          metrics.conversions
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND segments.date DURING ${range}
      `)

      const DAY_VI: Record<string, string> = {
        MONDAY: "Thứ 2", TUESDAY: "Thứ 3", WEDNESDAY: "Thứ 4",
        THURSDAY: "Thứ 5", FRIDAY: "Thứ 6", SATURDAY: "Thứ 7", SUNDAY: "Chủ nhật",
      }

      const map: Record<string, { spend: number; clicks: number; conversions: number }> = {}
      for (const row of rows as any[]) {
        // Same raw-numeric-enum issue as the device segment above —
        // segments.day_of_week is a number (2=MONDAY..8=SUNDAY), not the
        // string DAY_VI is keyed by.
        const day = enumName(enums.DayOfWeek, row.segments?.day_of_week)
        if (!map[day]) map[day] = { spend: 0, clicks: 0, conversions: 0 }
        map[day].spend        += Number(row.metrics?.cost_micros ?? 0) / 1_000_000
        map[day].clicks       += Number(row.metrics?.clicks ?? 0)
        map[day].conversions  += Number(row.metrics?.conversions ?? 0)
      }

      const ORDER = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]
      const total = Object.values(map).reduce((s, v) => s + v.spend, 0)
      const data  = ORDER.map(day => {
        const v = map[day] ?? { spend: 0, clicks: 0, conversions: 0 }
        return {
          label:       DAY_VI[day] ?? day,
          day,
          spend:       Math.round(v.spend),
          clicks:      v.clicks,
          conversions: Math.round(v.conversions * 100) / 100,
          cpl:         v.conversions > 0 ? Math.round(v.spend / v.conversions) : null,
          pctSpend:    total > 0 ? Math.round((v.spend / total) * 100) : 0,
        }
      })

      return NextResponse.json({ success: true, segment: "adschedule", data, totalSpend: Math.round(total) })
    }

    return NextResponse.json({ success: false, error: "Unknown segment type" }, { status: 400 })
  } catch (error: any) {
    console.error("[Segments]", error)
    return NextResponse.json({ success: false, error: friendlyError(error.message) }, { status: 500 })
  }
}
