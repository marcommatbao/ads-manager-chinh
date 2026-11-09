"use client"
import { useState, useEffect, useCallback } from "react"
import { useAdsStore }         from "@/store/useAdsStore"
import { companyIds } from "@/lib/companies/registry";
import { isCompany } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

type Company = string

// Google and Meta expose different CPL semantics, so the API returns
// different field names per channel (see app/api/attribution/route.ts).
interface GoogleChannelStats {
  spend: number
  conv: number
  revenue: number
  roas: number
  share: number
  cpl: number
  viewThrough: number
  conversionBasis: string
  /** Rổ conversion của Google gồm những action nào. Rỗng = không tách được,
   *  KHÔNG phải "tài khoản không có conversion action nào". */
  conversionActions?: Array<{ name: string; category: string; conv: number }>
}

interface FacebookChannelStats {
  spend: number
  conv: number
  revenue: number
  roas: number
  share: number
  cpl_lastClick: number
  conversionBasis: string
  companySplit: string
  unclassifiedSpend: number
  unclassifiedCampaigns: number
}

interface CampaignRow {
  name: string
  /** Trạng thái hiện tại của campaign Google ("PAUSED"/"REMOVED"/"ENABLED").
   *  Rỗng với Facebook — Meta không trả ở mức này. */
  status?: string
  platform: string
  /** Google advertising_channel_type, e.g. SEARCH / PERFORMANCE_MAX. */
  type: string
  spend: number
  conv: number
  revenue: number
  roas: number
  cpl: number
  viewThrough: number
  viewThroughShare: number
  role: string
}

interface AttributionData {
  dateRange: string
  summary?: { totalSpend: number; totalConv: number; totalRevenue: number; totalCPL: number; totalRoas: number }
  channels: { google: GoogleChannelStats; facebook: FacebookChannelStats }
  campaignBreakdown: CampaignRow[]
  facebookBreakdown: CampaignRow[]
  wasted?: {
    google: { campaigns: number; spend: number }
    facebook: { campaigns: number; spend: number }
  }
  dataQuality?: {
    window: { from: string; to: string; days: number }
    metaError: string | null
    revenueSource: string
  }
  keyInsights: string[]
}

// Nhãn hiển thị cho các vai trò API trả bằng tiếng Việt (vai trò khác hiện nguyên giá trị).
const ROLE_LABEL: Record<string, MessageKey> = {
  "VỪA ĐÓNG VỪA HỖ TRỢ": "overview.attribution.roleMixed",
  "CHƯA ĐỦ DỮ LIỆU": "overview.attribution.roleNoData",
  "KHÔNG ĐO ĐƯỢC": "overview.attribution.roleNotMeasurable",
  "KHÔNG CÓ CONVERSION": "overview.attribution.roleNoConv",
}

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))
}

const ROLE_BADGE: Record<string, string> = {
  AWARENESS:        "bg-blue-100 text-blue-700",
  CLOSING:          "bg-green-100 text-green-700",
  FULL_CREDIT:      "bg-purple-100 text-purple-700",
  "AWARENESS/ASSIST": "bg-orange-100 text-orange-700",
  "VỪA ĐÓNG VỪA HỖ TRỢ": "bg-amber-100 text-amber-700", // key = giá trị API (logic), nhãn hiển thị qua ROLE_LABEL
  "CHƯA ĐỦ DỮ LIỆU": "bg-slate-100 text-slate-500",
  "KHÔNG ĐO ĐƯỢC": "bg-slate-100 text-slate-400",
  "KHÔNG CÓ CONVERSION": "bg-red-100 text-red-700",
}

// Doanh thu 0 kèm conversion > 0 KHÔNG phải hiệu quả bằng 0 — đó là chiến dịch
// chưa gắn giá trị chuyển đổi (lead-gen trên Meta mặc định không có giá trị).
// Hiện "₫0 / 0.00x" ở đây đọc thành thất bại, trong khi sự thật là không đo được.
function revenueCell(revenue: number, conv: number, t: TFunction, loc: string): { revenue: string; roas: string; note?: string } {
  if (revenue > 0) return { revenue: fmtVnd(revenue, loc), roas: "" }
  if (conv > 0) return { revenue: "—", roas: "—", note: t("overview.attribution.noConvValue") }
  return { revenue: "—", roas: "—" }
}

const fmtVnd = (n: number, loc: string) => `₫${n.toLocaleString(loc)}`

export default function AttributionPage() {
  const t = useT()
  const loc = useIntlLocale()

  const storeCompany         = useAdsStore(s => s.selectedCompany)
  // /api/attribution resolves a single Google Ads customer, so it only accepts
  // MBC or MBI. The store's default is "all", which this page used to forward
  // verbatim — canAccessCompany() rejected it with 403 and the render below
  // then crashed on `data.channels.google`.
  const [company, setCompany] = useState<Company>(
    storeCompany === "MBI" ? "MBI" : "MBC"
  )
  const [range,   setRange]  = useState("LAST_30_DAYS")
  const [data,    setData]   = useState<AttributionData | null>(null)
  const [error,   setError]  = useState<string | null>(null)
  const [loading, setLoading]= useState(true)

  useEffect(() => {
    if (isCompany(storeCompany)) setCompany(storeCompany)
  }, [storeCompany])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/attribution?company=${company}&range=${range}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json || json.error) {
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      setData(json as AttributionData)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : t("overview.attribution.errLoad"))
    } finally {
      setLoading(false)
    }
  }, [company, range, t])

  useEffect(() => { void fetchData() }, [fetchData])

  return (
    <div className="space-y-5 p-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {t("overview.attribution.title")}
          </h1>
          <p className="text-sm text-gray-500">
            {/* Đổi từ "Khách đi qua kênh nào trước khi mua?" — hệ thống không có
                dữ liệu điểm chạm đa kênh, nên tiêu đề cũ hứa một thứ số liệu bên
                dưới không đỡ được. Đây là so sánh last-click giữa hai nền tảng. */}
            {t("overview.attribution.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          {companyIds().map(c => (
            <button key={c}
              onClick={() => setCompany(c)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                company === c
                  ? "bg-amber-500 text-amber-950"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          {[
            { label: t("overview.attribution.range30"), value: "LAST_30_DAYS" },
            { label: t("overview.attribution.range60"), value: "LAST_60_DAYS" },
            { label: t("overview.attribution.range90"), value: "LAST_90_DAYS" },
          ].map(opt => (
            <button key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                range === opt.value
                  ? "bg-amber-500 text-amber-950"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {t("overview.attribution.errBanner", { error: error })}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i}
              className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : data?.channels?.google && data.channels.facebook ? (
        <>
          {/* ── Key Insights Banner ── */}
          {data.keyInsights?.length > 0 && (
            <div className="space-y-2">
              {data.keyInsights.map((ins: string, i: number) => (
                <div key={i}
                  className="rounded-2xl bg-blue-50 border border-blue-200
                               px-5 py-3 flex gap-3">
                  <span className="text-lg">💡</span>
                  <p className="text-sm text-blue-800">{ins}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Channel Comparison ── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Google */}
            <div className="rounded-2xl border border-gray-100 bg-white
                            shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-red-100
                                flex items-center justify-center text-lg">
                  🔴
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">Google Ads</h3>
                  <p className="text-xs text-gray-500">
                    {t("overview.attribution.googleShare", { share: data.channels.google.share })}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  {
                    label: t("overview.attribution.spend"),
                    value: `₫${new Intl.NumberFormat(loc)
                      .format(data.channels.google.spend)}`
                  },
                  {
                    label: t("overview.attribution.conversions"),
                    value: (data.channels.google.conv ?? 0).toFixed(1),
                    note: data.channels.google.conversionBasis,
                  },
                  {
                    label: t("overview.attribution.revenue"),
                    value: revenueCell(data.channels.google.revenue ?? 0, data.channels.google.conv ?? 0, t, loc).revenue,
                    note: revenueCell(data.channels.google.revenue ?? 0, data.channels.google.conv ?? 0, t, loc).note,
                  },
                  {
                    label: "ROAS",
                    value: (data.channels.google.revenue ?? 0) > 0
                      ? `${(data.channels.google.roas ?? 0).toFixed(2)}x`
                      : "—",
                  },
                  {
                    label: t("overview.attribution.cpl"),
                    value: `₫${new Intl.NumberFormat(loc)
                      .format(data.channels.google.cpl)}`
                  },
                  {
                    label: t("overview.attribution.viewThrough"),
                    value: (data.channels.google.viewThrough ?? 0).toFixed(0),
                    note:  t("overview.attribution.viewThroughNote")
                  },
                ].map(item => (
                  <div key={item.label}
                    className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-800">
                        {item.value}
                      </span>
                      {item.note && (
                        <div className="text-xs text-gray-400">
                          {item.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Rổ conversion của Google — thứ quyết định con số ở trên có so
                  được với lead+purchase của Facebook hay không. Không bày ra
                  thì "56% vs 44%" chỉ là hai con số cạnh nhau, không ai kiểm
                  chứng được. */}
              {(data.channels.google.conversionActions?.length ?? 0) > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">
                    {t("overview.attribution.convIncludes", { n: data.channels.google.conv.toFixed(1) })}
                  </p>
                  <div className="space-y-1">
                    {data.channels.google.conversionActions!.slice(0, 6).map(a => (
                      <div key={a.name} className="flex justify-between gap-3 text-xs">
                        <span className="text-gray-600 truncate" title={`${a.name} · ${a.category}`}>
                          {a.name}
                          {a.category && (
                            <span className="text-gray-400"> · {a.category}</span>
                          )}
                        </span>
                        <span className="font-medium text-gray-700 shrink-0 tabular-nums">
                          {a.conv.toLocaleString(loc)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-amber-600 mt-2">
                    {rich(t("overview.attribution.fbOnlyCounts"))}
                  </p>
                </div>
              )}
            </div>

            {/* Facebook */}
            <div className="rounded-2xl border border-gray-100 bg-white
                            shadow-sm p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-100
                                flex items-center justify-center text-lg">
                  🔵
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">Facebook Ads</h3>
                  <p className="text-xs text-gray-500">
                    {t("overview.attribution.facebookShare", { share: data.channels.facebook.share })}
                  </p>
                </div>
              </div>

              {/* Meta lỗi thì phải nói ra. Con số 0 im lặng đọc thành
                  "Facebook không bán được gì" — một câu hoàn toàn khác. */}
              {data.dataQuality?.metaError && (
                <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  {t("overview.attribution.metaError", { error: data.dataQuality.metaError })}
                </div>
              )}

              <div className="space-y-3">
                {[
                  {
                    label: t("overview.attribution.spend"),
                    value: `₫${new Intl.NumberFormat(loc)
                      .format(data.channels.facebook.spend)}`,
                    note: undefined as string | undefined,
                  },
                  {
                    label: t("overview.attribution.conversions"),
                    value: String(data.channels.facebook.conv),
                    note: data.channels.facebook.conversionBasis,
                  },
                  {
                    label: t("overview.attribution.revenue"),
                    value: revenueCell(data.channels.facebook.revenue ?? 0, data.channels.facebook.conv ?? 0, t, loc).revenue,
                    note: revenueCell(data.channels.facebook.revenue ?? 0, data.channels.facebook.conv ?? 0, t, loc).note,
                  },
                  {
                    label: "ROAS",
                    value: (data.channels.facebook.revenue ?? 0) > 0
                      ? `${(data.channels.facebook.roas ?? 0).toFixed(2)}x`
                      : "—",
                    note: undefined,
                  },
                  {
                    label: t("overview.attribution.cpl"),
                    value: `₫${new Intl.NumberFormat(loc)
                      .format(data.channels.facebook.cpl_lastClick)}`,
                    note: undefined,
                  },
                ].map(item => (
                  <div key={item.label}
                    className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-800">
                        {item.value}
                      </span>
                      {item.note && (
                        <div className="text-xs text-gray-400 max-w-[220px]">{item.note}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Một ad account Meta dùng chung cho cả hai công ty — campaign
                  không mang dấu MBC/MBI thì không được tính vào công ty nào. */}
              {data.channels.facebook.unclassifiedCampaigns > 0 && (
                <p className="mt-3 text-[11px] text-slate-400">
                  {t("overview.attribution.unclassified", { n: data.channels.facebook.unclassifiedCampaigns, spend: fmtVnd(data.channels.facebook.unclassifiedSpend, loc) })}
                </p>
              )}
            </div>
          </div>

          {/* Cross-channel "customer journey" (multi-touch path breakdown)
              previously shown here was fabricated — fixed percentages with
              no real touchpoint/session data behind them. Removed rather
              than kept as fake data; real multi-touch attribution needs a
              real tracking pipeline this app doesn't have yet. */}

          {/* ── Campaign Breakdown — xếp theo doanh thu, không theo CPL rẻ ── */}
          <div className="rounded-2xl border border-gray-100 bg-white
                          shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="font-semibold text-gray-800">
                {t("overview.attribution.breakdownTitle")}
              </h3>
              {/* Campaign tiêu tiền mà không ra conversion từng bị lọc khỏi bảng
                  này — đúng những dòng cần nhìn nhất. Giờ chúng nằm trong bảng
                  và được cộng riêng ở đây để không phải tự dò. */}
              {data.wasted && (data.wasted.google.spend + data.wasted.facebook.spend) > 0 && (
                <p className="mt-1.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                  {rich(t("overview.attribution.wasted", {
                    spend: fmtVnd(data.wasted.google.spend + data.wasted.facebook.spend, loc),
                    n: data.wasted.google.campaigns + data.wasted.facebook.campaigns,
                  }))}
                  {data.summary?.totalSpend
                    ? t("overview.attribution.wastedPct", { pct: Math.round(((data.wasted.google.spend + data.wasted.facebook.spend) / data.summary.totalSpend) * 100) })
                    : ""}
                  {" "}{t("overview.attribution.wastedSplit", { google: fmtVnd(data.wasted.google.spend, loc), facebook: fmtVnd(data.wasted.facebook.spend, loc) })}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                {t("overview.attribution.breakdownNote")}
              </p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50 bg-gray-50 text-left">
                  <th className="px-5 py-3 text-gray-500 font-medium">{t("overview.attribution.thCampaign")}</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-right">{t("overview.attribution.spend")}</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-right">{t("overview.attribution.thConv")}</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-right">{t("overview.attribution.revenue")}</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-right">ROAS</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-right">CPL</th>
                  <th className="px-5 py-3 text-gray-500 font-medium text-center">{t("overview.attribution.thRole")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...(data.campaignBreakdown ?? []), ...(data.facebookBreakdown ?? [])]
                  .sort((a, b) => b.revenue - a.revenue || a.cpl - b.cpl)
                  .map((c: CampaignRow) => (
                  <tr key={`${c.platform}:${c.name}`} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800 truncate max-w-xs">
                        {c.name}
                      </div>
                      <div className="text-xs text-gray-400">
                        {c.platform === "facebook" ? "FACEBOOK" : c.type}
                        {c.viewThrough > 0 && ` · ${t("overview.attribution.viewThroughShare", { pct: c.viewThroughShare })}`}
                        {/* Campaign đã tắt vẫn nằm đây vì nó ĐÃ tiêu tiền trong
                            kỳ — đánh dấu để không ai tưởng nó đang chạy. */}
                        {c.status && c.status !== "ENABLED" && (
                          <span className="ml-1 text-amber-600">
                            · {c.status === "PAUSED" ? t("overview.attribution.paused") : t("overview.attribution.removed")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      ₫{new Intl.NumberFormat(loc).format(c.spend)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {(c.conv ?? 0).toFixed(1)}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-800">
                      {c.revenue > 0 ? fmtVnd(c.revenue, loc) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {c.revenue > 0 ? `${c.roas.toFixed(2)}x` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      ₫{new Intl.NumberFormat(loc).format(c.cpl)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`rounded-full px-3 py-1 text-xs
                                        font-medium ${ROLE_BADGE[c.role] || "bg-gray-100 text-gray-600"}`}>
                        {ROLE_LABEL[c.role] ? t(ROLE_LABEL[c.role]) : c.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Nguồn doanh thu + khoảng ngày thật đang dùng cho cả hai kênh. */}
          {data.dataQuality && (
            <p className="text-[11px] text-slate-400">
              {t("overview.attribution.dataQuality", { from: data.dataQuality.window.from, to: data.dataQuality.window.to, days: data.dataQuality.window.days })}
            </p>
          )}
        </>
      ) : !error ? (
        <p className="text-sm text-gray-500">{t("overview.attribution.noData")}</p>
      ) : null}
    </div>
  )
}
