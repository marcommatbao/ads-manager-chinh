"use client"
import { useState, useEffect, useCallback } from "react"
import Link                                  from "next/link"
import { useAdsStore }                       from "@/store/useAdsStore"
import { useRouter }                         from "next/navigation"
import NbaTriage                             from "@/components/NbaTriage"
import { KeywordsView }                      from "./KeywordsView"

// ─────────────────────────────────────
// HƯỚNG DẪN XỬ LÝ THỦ CÔNG
// ─────────────────────────────────────
import { getManualGuide, type ManualGuide } from "@/lib/improvement-manual-guide";
import { isHiddenPage } from "@/lib/hidden-pages";
import { useIntlLocale, useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import type { TFunction } from "@/lib/i18n/translate"

const SOURCE_ICON: Record<string, string> = { GOOGLE: "🔴", FACEBOOK: "🔵", CROSS_CHANNEL: "🟣" }
const TYPE_LABEL:  Record<string, MessageKey> = {
  PAUSE_KEYWORD: "overview.improvements.type.PAUSE_KEYWORD",
  PAUSE_SEARCH_TERM: "overview.improvements.type.PAUSE_SEARCH_TERM",
  NEGATIVE_BRAND_LEAK: "overview.improvements.type.NEGATIVE_BRAND_LEAK",
  PAUSE_LOW_CTR_AD: "overview.improvements.type.PAUSE_LOW_CTR_AD",
  PAUSE_PMAX_ASSET: "overview.improvements.type.PAUSE_PMAX_ASSET",
  PAUSE_FB_AD_FATIGUE: "overview.improvements.type.PAUSE_FB_AD_FATIGUE",
  PAUSE_FB_AD_LOW_CTR: "overview.improvements.type.PAUSE_FB_AD_LOW_CTR",
  INCREASE_BID_HIGH_ROAS: "overview.improvements.type.INCREASE_BID_HIGH_ROAS",
  INCREASE_BUDGET_CAPPED: "overview.improvements.type.INCREASE_BUDGET_CAPPED",
  SHIFT_BUDGET_CHANNEL: "overview.improvements.type.SHIFT_BUDGET_CHANNEL",
  LOWER_TARGET_CPA: "overview.improvements.type.LOWER_TARGET_CPA",
  RAISE_BUDGET_TOP_CAMPAIGN: "overview.improvements.type.RAISE_BUDGET_TOP_CAMPAIGN",
  ADD_EXACT_MATCH: "overview.improvements.type.ADD_EXACT_MATCH",
  ADD_COMPETITOR_KW: "overview.improvements.type.ADD_COMPETITOR_KW",
  EXPAND_REMARKETING: "overview.improvements.type.EXPAND_REMARKETING",
  DUPLICATE_FB_WINNING_ADSET: "overview.improvements.type.DUPLICATE_FB_WINNING_ADSET",
  FIX_LOW_QS_KEYWORD: "overview.improvements.type.FIX_LOW_QS_KEYWORD",
  ADD_AD_EXTENSION: "overview.improvements.type.ADD_AD_EXTENSION",
  IMPROVE_PMAX_ASSETS: "overview.improvements.type.IMPROVE_PMAX_ASSETS",
  FIX_AD_STRENGTH: "overview.improvements.type.FIX_AD_STRENGTH",
  FB_AUDIENCE_OVERLAP: "overview.improvements.type.FB_AUDIENCE_OVERLAP",
  DEVICE_BID_ADJUSTMENT: "overview.improvements.type.DEVICE_BID_ADJUSTMENT",
  GEO_BID_ADJUSTMENT: "overview.improvements.type.GEO_BID_ADJUSTMENT",
  DAYPART_OPPORTUNITY: "overview.improvements.type.DAYPART_OPPORTUNITY",
}
const typeLabel = (t: TFunction, type: string): string => (TYPE_LABEL[type] ? t(TYPE_LABEL[type]) : type)

// ─────────────────────────────────────
// MODAL: Hướng dẫn xử lý thủ công
// ─────────────────────────────────────
function ManualGuideModal({
  imp,
  onClose,
}: {
  imp: any
  onClose: () => void
}) {
  const t = useT()
  const router = useRouter()
  const guide  = getManualGuide(imp)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">
              {SOURCE_ICON[imp.source]} {imp.source} · {imp.company}
            </p>
            <h2 className="text-base font-bold text-gray-900">
              {typeLabel(t, imp.type)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Tóm tắt */}
          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <p className="text-xs font-semibold text-blue-600 mb-1">
              {t("overview.improvements.modal.todo")}
            </p>
            <p className="text-sm text-blue-900 font-medium">{guide.whatToDo}</p>
          </div>

          {/* Metrics */}
          {(imp.currentMetric || imp.targetMetric) && (
            <div className="flex items-center gap-3 text-sm">
              {imp.currentMetric && (
                <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-gray-700">
                  {t("overview.improvements.modal.current")}<strong>{imp.currentMetric}</strong>
                </span>
              )}
              {imp.targetMetric && (
                <>
                  <span className="text-gray-300">→</span>
                  <span className="rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-green-700">
                    {t("overview.improvements.modal.target")}<strong>{imp.targetMetric}</strong>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {t("overview.improvements.modal.steps")}
            </p>
            <div className="space-y-2">
              {guide.steps.map((step, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5"
                >
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Impact */}
          {imp.impact && (
            <div className="rounded-xl bg-yellow-50 border border-yellow-100 px-4 py-2.5">
              <p className="text-xs font-semibold text-yellow-700 mb-0.5">
                {t("overview.improvements.modal.impact")}
              </p>
              <p className="text-sm text-yellow-800">{imp.impact}</p>
            </div>
          )}

          {/* AI Reasoning */}
          {imp.reasoning && (
            <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-2.5">
              <p className="text-xs font-semibold text-purple-600 mb-0.5">{t("overview.improvements.modal.aiNote")}</p>
              <p className="text-sm text-purple-800 italic">{imp.reasoning}</p>
            </div>
          )}

          {/* External hint */}
          {guide.externalHint && (
            <p className="text-xs text-gray-400">
              {t("overview.improvements.modal.location", { hint: guide.externalHint })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t px-6 py-4">
          {guide.internalLink && !isHiddenPage(guide.internalLink) && (
            <button
              onClick={() => { router.push(guide.internalLink!); onClose() }}
              className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600
                         px-4 py-2.5 text-sm font-semibold text-amber-950
                         transition-colors"
            >
              {guide.internalLabel}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2.5
                       text-sm font-medium text-gray-600 hover:bg-gray-50
                       transition-colors"
          >
            {t("overview.improvements.modal.close")}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────

import { useImprovementsStore } from "@/store/useImprovementsStore"
import { cn } from "@/lib/utils"
// import lucide icons if you have them, else use emojis or SVGs as defined below

// ─────────────────────────────────────
// SVG ICONS
// ─────────────────────────────────────
const FacebookIcon = ({ size, color = "currentColor" }: { size: number, color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
    <path d="M24 12.073C24 5.405 18.627 0 12 0C5.373 0 0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49H10.125V9.408c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
  </svg>
)

const GoogleIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
    <path fill="#4285F4" d="M23.745 12.27c0-.827-.074-1.62-.213-2.39H12v4.515h6.582c-.284 1.464-1.1 2.705-2.28 3.498v2.906h3.69c2.16-1.988 3.407-4.915 3.407-8.528z" />
    <path fill="#34A853" d="M12 24c3.303 0 6.074-1.096 8.098-2.964l-3.69-2.906c-1.094.733-2.49 1.168-4.408 1.168-3.393 0-6.262-2.292-7.288-5.372H.895v3.013C2.923 20.957 7.127 24 12 24z" />
    <path fill="#FBBC05" d="M4.712 14.926c-.261-.784-.41-1.626-.41-2.493 0-.867.149-1.709.41-2.493V6.927H.895C.324 8.064 0 9.356 0 10.933c0 1.577.324 2.869.895 4.006l3.817-3.013z" />
    <path fill="#EA4335" d="M12 4.788c1.796 0 3.408.618 4.676 1.826l3.504-3.504C18.065 1.182 15.295 0 12 0 7.127 0 2.923 3.043.895 7.072l3.817 3.013C5.738 7.005 8.607 4.788 12 4.788z" />
  </svg>
)

const CheckIcon = ({ size, strokeWidth = 2 }: { size: number, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)

// Add missing exports for backward compatibility if needed, or just let it be.
import { detectPlatform, Improvement, Platform, Priority } from "@/types/improvements"
import { ActionPlanPanel } from "./ActionPlanPanel"
import { orderedCompanyIds } from "@/lib/companies/registry";

// ─────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────
export default function ImprovementsPage() {
  const t = useT()
  const loc = useIntlLocale()
  const company = useAdsStore(s => s.selectedCompany)
  const store = useImprovementsStore()

  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [guideItem, setGuideItem] = useState<any>(null)

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  /** Nguồn dữ liệu lấy hụt ở lượt quét gần nhất. */
  const [dataErrors, setDataErrors] = useState<string[]>([])

  const fetchImprovements = useCallback(async () => {
    useImprovementsStore.getState().setLoading(true)
    try {
      const co = company || (orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
      const res = await fetch(`/api/improvements?company=${co}`)
      if (res.ok) {
        const data = await res.json()
        const items = data.improvements.map((i: any) => ({
          ...i,
          platform: detectPlatform(i)
        }))
        useImprovementsStore.getState().setItems(items)
        // Nguồn dữ liệu nào lấy hụt thì NÓI RA. Danh sách rỗng vì "tài khoản
        // sạch" và rỗng vì "không soi được" nhìn y hệt nhau — mà cái sau nghĩa
        // là tiền vẫn đang chảy không ai biết.
        const errs: string[] = [
          ...(Array.isArray(data.dataErrors) ? data.dataErrors : []),
          ...(data.facebookError ? [`Facebook: ${data.facebookError}`] : []),
        ]
        setDataErrors(errs)
      } else {
        useImprovementsStore.getState().setItems([])
        setDataErrors([t("overview.improvements.loadListError", { status: res.status })])
      }
    } catch (e) {
      useImprovementsStore.getState().setItems([])
      setDataErrors([e instanceof Error ? e.message : t("overview.improvements.connError")])
    } finally {
      useImprovementsStore.getState().setLoading(false)
    }
  }, [company, t])

  useEffect(() => {
    if (!company) return
    fetchImprovements()
  }, [company, fetchImprovements])

  // Context passing for children
  const pageContext = {
    company, applying, undoing, setApplying, setUndoing, fetchImprovements, showToast, setGuideItem
  }

  const { items, platformFilter, statusFilter, loading } = store
  const activeCount = items.filter(i => i.status === "ACTIVE").length
  const completedCount = items.filter(i => i.status === "COMPLETED").length
  const dismissedCount = items.filter(i => i.status === "DISMISSED").length
  
  const highCount = items.filter(i => i.priority === "HIGH" && i.status === "ACTIVE").length
  const mediumCount = items.filter(i => i.priority === "MEDIUM" && i.status === "ACTIVE").length
  // Soát dữ liệu 07/10: chỉ cộng khuyến nghị HIGH đang mở, số ĐO ĐƯỢC (bỏ ước lượng thô), mỗi chiến dịch tính 1 lần —
  // trước đây cộng mọi mục (kể cả đã xong/bỏ qua), trùng chiến dịch, gọi là "Impact/tháng".
  const totalImpact = (() => {
    const by = new Map<string, number>()
    for (const i of items) {
      if (i.status !== "ACTIVE" || i.priority !== "HIGH" || i.impactRough || !(i.impactValue! > 0)) continue
      const k = `${i.company}:${i.campaignName ?? i.id}`
      by.set(k, Math.max(by.get(k) ?? 0, i.impactValue!))
    }
    return [...by.values()].reduce((a, b) => a + b, 0)
  })()

  return (
    <div className="space-y-5 p-6 pb-20">
      {/* Nguồn dữ liệu lấy hụt — phải hiện TRƯỚC danh sách, vì nếu không thì
          một danh sách ngắn (hoặc rỗng) trông như "tài khoản đang sạch". */}
      {dataErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">
            {t("overview.improvements.incomplete", { n: dataErrors.length })}
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-xs">
            {dataErrors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
            {dataErrors.length > 6 && <li>{t("overview.improvements.moreSources", { n: dataErrors.length - 6 })}</li>}
          </ul>
          <p className="text-xs mt-1.5 opacity-80">
            {t("overview.improvements.notScanned")}
          </p>
        </div>
      )}

      {/* Next Best Action — hàng đợi xử lý hợp nhất (engine NBA) */}
      <NbaTriage />

      {/* Header (Topbar) */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t("overview.improvements.title")}</h1>
          <p className="text-sm text-gray-500">{t("overview.improvements.subtitle")}</p>
          <p className="text-xs text-gray-400 mt-1">
            {/* Link tới trang đang tạm ẩn thì bỏ luôn, không để người dùng bấm
                vào rồi gặp thông báo "trang đang tạm ẩn" — xem lib/hidden-pages.ts */}
            {t("overview.improvements.seeMore")}{" "}
            {!isHiddenPage("/google-audit") && (
              <>
                <Link href="/google-audit" className="text-blue-500 hover:underline">Google Audit</Link>
                {" · "}
              </>
            )}
            <Link href="/google-pmax" className="text-blue-500 hover:underline">PMax Insights</Link>
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-2 text-center">
            <p className="text-2xl font-bold text-red-600">{highCount}</p>
            <p className="text-xs text-red-500">{t("overview.improvements.highPriority")}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 border border-orange-200 px-4 py-2 text-center">
            <p className="text-2xl font-bold text-orange-600">{mediumCount}</p>
            <p className="text-xs text-orange-500">{t("overview.improvements.medium")}</p>
          </div>
          {totalImpact > 0 && (
            <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-2 text-center">
              <p className="text-lg font-bold text-green-600">
                ₫{new Intl.NumberFormat(loc).format(Math.round(totalImpact / 1_000_000))}M
              </p>
              <p className="text-xs text-green-500" title={t("overview.improvements.impactTip")}>{t("overview.improvements.impactLabel")}</p>
            </div>
          )}
        </div>
      </div>

      <ViewModeTabs />

      {store.viewMode === "keywords" ? (
        <KeywordsView company={company} showToast={showToast} />
      ) : (
        <>
          <PlatformTabs />

          {/* Toolbar: status + sort */}
          <div className="flex items-center justify-between mb-4">
            <StatusTabs
              activeCount={activeCount}
              completedCount={completedCount}
              dismissedCount={dismissedCount}
            />
            {/* Placeholder Sort (not fully requested in prompt logic, just UI structure) */}
            <select
              value={store.sortBy}
              onChange={(e) => store.setSortBy(e.target.value as any)}
              className="rounded-lg border px-3 py-2 text-sm text-gray-700 outline-none"
            >
              <option value="priority">{t("overview.improvements.sort.priority")}</option>
              <option value="impact">{t("overview.improvements.sort.impact")}</option>
              <option value="confidence">{t("overview.improvements.sort.confidence")}</option>
            </select>
          </div>

          <AutoApplyBanner pageContext={pageContext} />

          {loading ? (
            <div className="space-y-3 mt-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
              ))}
            </div>
          ) : (
            platformFilter === "ALL"
              ? <AllPlatformsView pageContext={pageContext} />
              : <SinglePlatformView platform={platformFilter} pageContext={pageContext} />
          )}
        </>
      )}

      {/* Modals & Toasts */}
      {guideItem && (
        <ActionPlanPanel
          improvement={guideItem}
          company={company || ""}
          onClose={() => setGuideItem(null)}
        />
      )}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-50 rounded-2xl px-5 py-3 shadow-lg text-sm font-medium text-white max-w-sm transition-all duration-300",
          toast.type === "success" ? "bg-green-600" : "bg-red-500"
        )}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function ViewModeTabs() {
  const t = useT()
  const store = useImprovementsStore()
  const { viewMode, setViewMode } = store

  const tabs: Array<{ key: "cards" | "keywords"; label: string }> = [
    { key: "cards", label: t("overview.improvements.tab.cards") },
    { key: "keywords", label: t("overview.improvements.tab.keywords") },
  ]

  return (
    <div className="flex gap-2 mb-3">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => setViewMode(tab.key)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            viewMode === tab.key
              ? "bg-gray-900 border-gray-900 text-white dark:bg-white dark:text-gray-900"
              : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function PlatformTabs() {
  const t = useT()
  const store = useImprovementsStore()
  const { platformFilter, setPlatformFilter } = store
  
  // Calculate counts based on currently active status
  const items = store.items.filter(i => i.status === "ACTIVE")
  const counts = {
    all: items.length,
    facebook: items.filter(i => i.platform === "FACEBOOK").length,
    google: items.filter(i => i.platform === "GOOGLE").length,
  }

  const tabs: any[] = [
    { key: "ALL", label: t("overview.improvements.all"), count: counts.all, icon: null, style: "neutral" },
    { key: "FACEBOOK", label: "Facebook", count: counts.facebook, icon: <FacebookIcon size={14} />, style: "facebook" },
    { key: "GOOGLE", label: "Google", count: counts.google, icon: <GoogleIcon size={14} />, style: "google" },
  ]

  return (
    <div className="flex gap-2 mb-5">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => setPlatformFilter(tab.key)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border-2 transition-all",
            tab.style === "neutral" && platformFilter === "ALL" &&
              "bg-gray-900 border-gray-900 text-white dark:bg-white dark:text-gray-900",
            tab.style === "neutral" && platformFilter !== "ALL" &&
              "bg-white border-gray-200 text-gray-500 hover:bg-gray-50",
            tab.style === "facebook" &&
              "bg-blue-50 dark:bg-blue-950",
            tab.style === "facebook" && platformFilter === "FACEBOOK" &&
              "border-blue-500 shadow-[0_0_0_3px_rgba(24,119,242,0.15)]",
            tab.style === "facebook" && platformFilter !== "FACEBOOK" &&
              "border-transparent text-blue-900 hover:border-blue-200",
            tab.style === "google" &&
              "bg-indigo-50 dark:bg-indigo-950",
            tab.style === "google" && platformFilter === "GOOGLE" &&
              "border-indigo-500 shadow-[0_0_0_3px_rgba(66,133,244,0.15)]",
            tab.style === "google" && platformFilter !== "GOOGLE" &&
              "border-transparent text-indigo-900 hover:border-indigo-200",
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          <span className={cn(
            "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
            tab.style === "facebook" && "bg-blue-500 text-white",
            tab.style === "google"   && "bg-indigo-500 text-white",
            tab.style === "neutral" && platformFilter === "ALL"
              ? "bg-white/20 text-white"
              : tab.style === "neutral" ? "bg-gray-100 text-gray-500" : ""
          )}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  )
}

function StatusTabs({ activeCount, completedCount, dismissedCount }: any) {
  const t = useT()
  const { statusFilter, setStatusFilter } = useImprovementsStore()
  return (
    <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit">
      {[
        { label: t("overview.improvements.status.active", { n: activeCount }), value: "ACTIVE" },
        { label: t("overview.improvements.status.completed", { n: completedCount }), value: "COMPLETED" },
        { label: t("overview.improvements.status.dismissed", { n: dismissedCount }), value: "DISMISSED" },
      ].map(tab => (
        <button
          key={tab.value}
          onClick={() => setStatusFilter(tab.value as any)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            statusFilter === tab.value
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function AutoApplyBanner({ pageContext }: { pageContext: any }) {
  const t = useT()
  const store = useImprovementsStore()
  const { platformFilter, statusFilter } = store
  
  if (statusFilter !== "ACTIVE") return null

  // Use the selector logic inline for simplicity since zustand hooks outside component are tricky
  const items = store.items.filter(
    (i) => i.priority === "HIGH" && i.status === "ACTIVE" && i.canAutoApply
  )
  const currentItems = platformFilter === "ALL" 
    ? items 
    : items.filter(i => i.platform === platformFilter)

  if (!currentItems.length) return null

  const config: Record<string, any> = {
    ALL: {
      label:  t("overview.improvements.banner.all.label", { n: currentItems.length }),
      // KHÔNG hứa Undo: /api/improvements/apply trả 501 cho mọi yêu cầu undo
      // ("chưa được hỗ trợ") vì không chỗ nào ghi lại giá trị TRƯỚC khi sửa.
      // Hứa hoàn tác được trên một nút ghi thẳng vào tài khoản quảng cáo là
      // loại sai nguy hiểm nhất — người dùng bấm vì tin rằng lỡ tay còn gỡ được.
      sub:    t("overview.improvements.banner.all.sub", { fb: currentItems.filter((i)=>i.platform==="FACEBOOK").length, gg: currentItems.filter((i)=>i.platform==="GOOGLE").length }),
      btnText:t("overview.improvements.banner.all.btn", { n: currentItems.length }),
      color:  "red",
    },
    FACEBOOK: {
      label:  t("overview.improvements.banner.fb.label", { n: currentItems.length }),
      sub:    t("overview.improvements.banner.fb.sub"),
      btnText:t("overview.improvements.banner.fb.btn", { n: currentItems.length }),
      color:  "facebook",
    },
    GOOGLE: {
      label:  t("overview.improvements.banner.gg.label", { n: currentItems.length }),
      sub:    t("overview.improvements.banner.gg.sub"),
      btnText:t("overview.improvements.banner.gg.btn", { n: currentItems.length }),
      color:  "google",
    },
  }
  const curr = config[platformFilter];

  const handleApply = async () => {
    // Liệt kê ĐÍCH DANH sẽ đổi gì. Hộp xác nhận cũ chỉ hiện một con số và một
    // lời hứa sai ("đều có thể Undo") — người dùng đồng ý mà không biết mình
    // vừa đồng ý cái gì, trên một nút ghi thẳng vào tài khoản đang tiêu tiền.
    const byType = new Map<string, number>()
    for (const i of currentItems as any[]) {
      const ty = String(i.type ?? t("overview.improvements.confirm.unknownType"))
      byType.set(ty, (byType.get(ty) ?? 0) + 1)
    }
    const TYPE_VI: Record<string, string> = {
      PAUSE_KEYWORD: t("overview.improvements.confirm.type.PAUSE_KEYWORD"),
      UPDATE_KEYWORD_CPC: t("overview.improvements.confirm.type.UPDATE_KEYWORD_CPC"),
      UPDATE_BUDGET: t("overview.improvements.confirm.type.UPDATE_BUDGET"),
      UPDATE_TARGET_CPA: t("overview.improvements.confirm.type.UPDATE_TARGET_CPA"),
      ADD_NEGATIVE: t("overview.improvements.confirm.type.ADD_NEGATIVE"),
      UPDATE_DEVICE_BID: t("overview.improvements.confirm.type.UPDATE_DEVICE_BID"),
    }
    const lines = [...byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ty, n]) => `  • ${TYPE_VI[ty] ?? ty}: ${n}`)
      .join("\n")
    const sample = (currentItems as any[]).slice(0, 5)
      .map(i => `  – ${i.campaignName ?? i.title ?? i.id}`).join("\n")

    const confirmed = window.confirm(
      t("overview.improvements.confirm.body", {
        n: currentItems.length,
        lines,
        sample,
        more: currentItems.length > 5 ? t("overview.improvements.confirm.more", { n: currentItems.length - 5 }) : "",
      })
    )
    if (!confirmed) return

    pageContext.setApplying("BULK")
    try {
      const res  = await fetch("/api/improvements/apply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          company: pageContext.company,
          bulk:    true,
          items:   currentItems.map((i: any) => ({
            id: i.id,
            applyPayload: typeof i.applyPayload === "string" ? JSON.parse(i.applyPayload) : i.applyPayload,
          })),
        }),
      })
      const json = await res.json()
      if (json.applied) {
        pageContext.showToast(t("overview.improvements.bulkApplied", { ok: json.applied, total: json.applied + json.failed }), "success")
      } else {
        pageContext.showToast(json.error || t("overview.improvements.bulkNone"), "error")
      }
      pageContext.fetchImprovements()
    } catch (err: any) {
      pageContext.showToast(err.message, "error")
    }
    pageContext.setApplying(null)
  }

  return (
    <div className={cn(
      "flex items-center justify-between gap-4 rounded-xl px-5 py-4 mb-5 border",
      platformFilter === "FACEBOOK" && "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
      platformFilter === "GOOGLE"   && "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800",
      platformFilter === "ALL"      && "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
    )}>
      <div className="flex items-center gap-3">
        <span className={cn(
          "w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0",
          platformFilter === "FACEBOOK" && "bg-blue-500",
          platformFilter === "GOOGLE"   && "bg-indigo-500",
          platformFilter === "ALL"      && "bg-red-600",
        )} />
        <div>
          <p className="text-sm font-semibold">{curr.label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{curr.sub}</p>
        </div>
      </div>
      <button
        onClick={handleApply}
        disabled={pageContext.applying === "BULK"}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold text-white whitespace-nowrap disabled:opacity-60 transition-colors",
          platformFilter === "FACEBOOK" && "bg-[#1877F2] hover:bg-[#1565e0]",
          platformFilter === "GOOGLE"   && "bg-[#4285F4] hover:brightness-110",
          platformFilter === "ALL"      && "bg-red-600 hover:bg-red-700",
        )}
      >
        <CheckIcon size={14} strokeWidth={3} />
        {pageContext.applying === "BULK" ? t("overview.improvements.applying") : curr.btnText}
      </button>
    </div>
  )
}

function AllPlatformsView({ pageContext }: any) {
  return (
    <div>
      <PlatformSectionHeader platform="FACEBOOK" />
      <PriorityGroupList platform="FACEBOOK" pageContext={pageContext} />
      <div className="h-8" />
      <PlatformSectionHeader platform="GOOGLE" />
      <PriorityGroupList platform="GOOGLE" pageContext={pageContext} />
    </div>
  )
}

function SinglePlatformView({ platform, pageContext }: any) {
  return (
    <div>
      <PriorityGroupList platform={platform} pageContext={pageContext} />
    </div>
  )
}

function PlatformSectionHeader({ platform }: { platform: "FACEBOOK" | "GOOGLE" }) {
  const t = useT()
  const store = useImprovementsStore()
  // Active filtered count
  const count = store.items.filter(i => i.platform === platform && i.status === store.statusFilter).length

  if (count === 0) return null

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-lg mb-4 text-sm font-bold",
      platform === "FACEBOOK" && "bg-blue-50 text-blue-800",
      platform === "GOOGLE"   && "bg-indigo-50 text-indigo-800",
    )}>
      {platform === "FACEBOOK" ? <FacebookIcon size={16} /> : <GoogleIcon size={16} />}
      <span>
        {t("overview.improvements.sectionHeader", { name: platform === "FACEBOOK" ? "Facebook Ads" : "Google Ads", n: count })}
      </span>
      <div className="flex-1 h-px bg-current opacity-20" />
    </div>
  )
}

function PriorityGroupList({ platform, pageContext }: { platform: Platform, pageContext: any }) {
  const t = useT()
  const store = useImprovementsStore()
  const { statusFilter, sortBy } = store
  
  let items = store.items.filter(i => (platform === "ALL" || i.platform === platform) && i.status === statusFilter)
  
  // Sort logic within priority groups if requested
  items = [...items].sort((a, b) => {
    if (sortBy === "impact") return (b.impactValue || 0) - (a.impactValue || 0);
    if (sortBy === "confidence") return (b.confidence || 0) - (a.confidence || 0);
    return 0; // priority handled by structural grouping
  });

  const groups = {
    HIGH:   items.filter(i => i.priority === "HIGH"),
    MEDIUM: items.filter(i => i.priority === "MEDIUM"),
    LOW:    items.filter(i => i.priority === "LOW"),
  }

  // If no items in this platform for current status
  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        {t("overview.improvements.emptyPlatform", { name: platform === "FACEBOOK" ? "Facebook" : "Google" })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Quick Toggle Summary Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {(["HIGH", "MEDIUM", "LOW"] as Priority[]).map((priority) => {
          if (groups[priority].length === 0) return null;
          const groupId = `${platform}-${priority}`;
          const isCollapsed = store.collapsedGroups[groupId];
          return (
            <button
              key={priority}
              onClick={() => {
                store.toggleGroup(groupId);
                // Also scroll a bit if expanding, though usually just clicking is fine 
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors shadow-sm",
                !isCollapsed
                  ? priority === "HIGH" ? "bg-red-500 text-white border-red-600" 
                  : priority === "MEDIUM" ? "bg-orange-500 text-white border-orange-600"
                  : "bg-emerald-500 text-white border-emerald-600"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              )}
            >
              <span>{priority}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-black/10 text-[10px]">
                {groups[priority].length}
              </span>
              <span className="opacity-70 ml-0.5" style={{ fontSize: '9px' }}>
                {isCollapsed ? "▼" : "▲"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-6 mt-2">
        {(["HIGH", "MEDIUM", "LOW"] as Priority[]).map((priority) => (
          groups[priority].length > 0 && (
            <PriorityGroup
              key={priority}
              priority={priority}
              items={groups[priority]}
              platform={platform}
              groupId={`${platform}-${priority}`}
              pageContext={pageContext}
            />
          )
        ))}
      </div>
    </div>
  )
}

function PriorityGroup({ priority, items, platform, groupId, pageContext }: any) {
  const t = useT()
  const store = useImprovementsStore()
  const { collapsedGroups, toggleGroup } = store
  const isCollapsed = collapsedGroups[groupId]

  const BADGE_STYLE: Record<string, string> = {
    HIGH:   "bg-red-100 text-red-700",
    MEDIUM: "bg-orange-100 text-orange-700",
    LOW:    "bg-emerald-100 text-emerald-700",
  }

  return (
    <div>
      <button
        onClick={() => toggleGroup(groupId)}
        className="flex items-center gap-3 w-full py-2 mb-2 group hover:bg-gray-50 px-2 rounded-lg transition-colors cursor-pointer"
      >
        <span className={cn(
          "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wide",
          BADGE_STYLE[priority],
        )}>
          • {priority}
        </span>
        <span className="text-xs text-gray-500 font-medium">
          {t("overview.improvements.itemsCount", { n: items.length })}
        </span>
        <div className="flex-1 h-px bg-gray-200" />
        <span className={cn(
          "text-xs text-gray-400 transition-transform duration-200 font-mono",
          isCollapsed && "rotate-[-90deg]",
        )}>
          ▼
        </span>
      </button>

      {!isCollapsed && (
        <div className="flex flex-col gap-3">
          {items.map((item: any) => (
            <ImprovementCard
              key={item.id}
              item={item}
              showPlatformIcon={store.platformFilter === "ALL"}
              pageContext={pageContext}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const t = useT()
  const filled = Math.round(value / 100 * 5)
  return (
    <div className="flex items-center gap-1.5 ml-2" title={t("overview.improvements.confidenceTip")}>
      <div className="flex gap-0.5">
        {Array.from({length: 5}, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1 h-2 rounded-[1px]",
              i < filled ? "bg-[#8b5cf6]" : "bg-gray-200",
            )}
          />
        ))}
      </div>
      <span className="text-xs text-gray-500 font-medium">{value}%</span>
    </div>
  )
}

function ImprovementCard({ item, showPlatformIcon, pageContext }: any) {
  const t = useT()
  const store = useImprovementsStore()
  
  const justApplied = store.justApplied.has(item.id)
  
  const handleApply = async () => {
    pageContext.setApplying(item.id)
    try {
      const payload = typeof item.applyPayload === "string" ? JSON.parse(item.applyPayload) : item.applyPayload

      const res  = await fetch("/api/improvements/apply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          improvementId: item.id,
          company:       item.company || pageContext.company,
          applyPayload:  payload,
        }),
      })
      const json = await res.json()
      if (json.success) {
        store.addJustApplied(item.id)
        pageContext.showToast(t("overview.improvements.applied", { title: item.title }))
        // Give time for UI feedback before refetch
        setTimeout(() => pageContext.fetchImprovements(), 1500)
      } else {
        pageContext.showToast(json.errors?.[0] || json.error || t("overview.improvements.applyError"), "error")
      }
    } catch (err: any) {
      pageContext.showToast(err.message, "error")
    }
    pageContext.setApplying(null)
  }

  const handleUndo = async () => {
    pageContext.setUndoing(item.id)
    try {
      const res  = await fetch("/api/improvements/apply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          improvementId: item.id,
          company:       item.company || pageContext.company,
          undo:          true,
        }),
      })
      const json = await res.json()
      if (json.success) {
        store.removeJustApplied(item.id)
        pageContext.showToast(t("overview.improvements.undone", { title: item.title }))
        pageContext.fetchImprovements()
      } else {
        pageContext.showToast(json.error || t("overview.improvements.undoError"), "error")
      }
    } catch (err: any) {
      pageContext.showToast(err.message, "error")
    }
    pageContext.setUndoing(null)
  }

  const handleDismiss = async () => {
    try {
      const res  = await fetch("/api/improvements/apply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          improvementId: item.id,
          company:       item.company || pageContext.company,
          dismiss:       true,
        }),
      })
      const json = await res.json().catch(() => ({}))
      // Previously the response was discarded and the "đã bỏ qua" toast fired
      // unconditionally — including when the dismissal was rejected, in which
      // case the item reappeared on the next refresh with no explanation.
      if (!res.ok || json.success === false) {
        pageContext.showToast(json.error || t("overview.improvements.dismissError", { status: res.status }), "error")
        return
      }
      pageContext.showToast(t("overview.improvements.dismissed"))
      pageContext.fetchImprovements()
    } catch (err) {
      pageContext.showToast(err instanceof Error ? err.message : t("overview.improvements.dismissConnError"), "error")
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4 transition-all shadow-sm",
        justApplied
          ? "border-green-200 bg-green-50/50"
          : item.priority === "HIGH"
          ? "border-red-100 bg-white hover:border-red-200 hover:shadow-md"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md"
      )}
    >
      <div className="flex items-start justify-between gap-4">

        {/* Platform icon for "ALL" view */}
        {showPlatformIcon && (
          <div className={cn(
            "w-8 h-8 mt-1 rounded-md flex items-center justify-center flex-shrink-0 border",
            item.platform === "FACEBOOK" ? "bg-blue-50 border-blue-100" : "bg-indigo-50 border-indigo-100",
          )}>
            {item.platform === "FACEBOOK"
              ? <FacebookIcon size={16} color="#1877F2" />
              : <GoogleIcon size={16} />
            }
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          {/* Row 1: Type + Confidence */}
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-sm font-extrabold tracking-tight text-gray-900">
              {typeLabel(t, item.type)}
            </span>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              {item.company}
            </span>
            <ConfidenceBar value={item.confidence} />
          </div>

          {/* Row 2: Title */}
          <p className="text-[15px] font-medium text-gray-800 leading-snug">{item.title}</p>
          <p className="text-sm text-gray-500">{item.description}</p>

          {/* Row 3: Tags / Metadata */}
          <div className="flex gap-2 flex-wrap mt-1">
            {item.campaignName && (
              <span className="rounded bg-blue-50/70 border border-blue-100
                               px-2 py-1 text-xs text-blue-700 font-medium max-w-xs truncate flex items-center">
                <span className="text-blue-400 mr-1.5 flex-shrink-0">⚑</span> {item.campaignName}
              </span>
            )}
            {item.keyword && (
              <span className="rounded bg-purple-50 border border-purple-100
                               px-2 py-1 text-xs text-purple-700 font-medium">
                {item.keyword}
              </span>
            )}
          </div>

          {/* Row 4: Metrics Update */}
          {(item.currentMetric || item.targetMetric) && (
            <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50/50 p-2.5 rounded-lg border border-gray-100 mt-2">
              {item.currentMetric && <span>{item.currentMetric}</span>}
              {item.currentMetric && item.targetMetric && (
                <span className="text-gray-300">➜</span>
              )}
              {item.targetMetric && (
                <span className="text-green-600 font-bold">{item.targetMetric}</span>
              )}
            </div>
          )}

          {/* Row 5: Impact */}
          {item.impact && (
            <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5 mt-2">
              <span className="text-base leading-none">💡</span> {item.impact}
              {item.impactRough && <span className="text-[10px] font-normal text-slate-400">{t("overview.improvements.roughShort")}</span>}
            </p>
          )}
        </div>

        {/* Actions Segment */}
        <div className="flex items-center gap-2 flex-shrink-0 relative">
          
          {store.statusFilter === "ACTIVE" && !justApplied && (
            <button
              onClick={handleDismiss}
              className="text-xs font-medium text-slate-400 hover:text-slate-700 px-3 py-1.5
                         rounded-lg hover:bg-slate-100 transition-colors"
            >
              {t("overview.improvements.dismiss")}
            </button>
          )}

          {justApplied && (
            <button
              onClick={handleUndo}
              disabled={pageContext.undoing === item.id}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600
                         hover:bg-gray-50 disabled:opacity-50 transition-all bg-white shadow-sm"
            >
              {pageContext.undoing === item.id ? t("overview.improvements.undoing") : t("overview.improvements.undo")}
            </button>
          )}

          {store.statusFilter === "ACTIVE" && !justApplied && (
            <button
              onClick={() => pageContext.setGuideItem(item)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-500 hover:text-amber-950 transition-all shadow-sm"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
              {t("overview.improvements.viewEdit")}
            </button>
          )}

          {item.canAutoApply && !justApplied && store.statusFilter === "ACTIVE" && (
            <button
              onClick={handleApply}
              disabled={pageContext.applying === item.id || pageContext.applying === "BULK"}
              className="rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-1.5
                         text-xs font-bold text-amber-950 transition-all shadow-sm
                         disabled:opacity-50 border border-amber-600"
            >
              {pageContext.applying === item.id ? "⏳..." : t("overview.improvements.apply")}
            </button>
          )}

          {store.statusFilter === "COMPLETED" && (
            <span className="rounded-xl bg-green-100 border border-green-200 text-green-700
                             px-3 py-1 text-xs font-bold shadow-sm inline-flex items-center gap-1">
              <CheckIcon size={12} strokeWidth={3} /> {t("overview.improvements.appliedBadge")}
            </span>
          )}
        </div>

      </div>
    </div>
  )
}
