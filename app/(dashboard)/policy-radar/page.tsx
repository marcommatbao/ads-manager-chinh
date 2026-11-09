"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { Plus, RefreshCw, Radar, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/Toast";
import { useSession } from "@/components/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { PolicyCard } from "@/components/policy-radar/PolicyCard";
import { PolicyDetailSheet } from "@/components/policy-radar/PolicyDetailSheet";
import { PolicyDetailPanel } from "@/components/policy-radar/PolicyDetailPanel";
import { AddPolicyItemDialog } from "@/components/policy-radar/AddPolicyItemDialog";
import { PolicySummaryStrip } from "@/components/policy-radar/PolicySummaryStrip";
import { PolicyFilterChips } from "@/components/policy-radar/PolicyFilterChips";
import { ViewModeToggle, type PolicyViewMode } from "@/components/policy-radar/ViewModeToggle";
import { PolicyTimelineView } from "@/components/policy-radar/PolicyTimelineView";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/policy-radar/labels";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import ActionPlanPanel from "@/components/policy-radar/ActionPlanPanel";
import type {
  PolicyCategory,
  PolicyPlatform,
  PolicyRadarItem,
  PolicyReviewStatus,
  PolicySeverity,
} from "@/lib/policy-radar/types";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error("Không tải được dữ liệu Policy Radar");
  return r.json();
});

const SEVERITY_VALUES: PolicySeverity[] = ["high", "medium", "low"];
const STATUS_VALUES = Object.keys(STATUS_LABELS) as PolicyReviewStatus[];
const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as PolicyCategory[];

// Sheet content is portaled to document.body, so wrapping it in a `lg:hidden`
// div does NOT stop it from rendering on desktop — has to be gated in JS.
// Matches the `lg` breakpoint (1024px) used everywhere else on this page.
// useSyncExternalStore (not useState+useEffect) so the subscription is the
// single source of truth — no synchronous setState-in-effect, no hydration
// mismatch (getServerSnapshot matches the mobile-first default).
function subscribeDesktopQuery(callback: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function getIsDesktopSnapshot() {
  return window.matchMedia("(min-width: 1024px)").matches;
}
function getIsDesktopServerSnapshot() {
  return false;
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktopQuery, getIsDesktopSnapshot, getIsDesktopServerSnapshot);
}

export default function PolicyRadarPage() {
  const t = useT();
  const intl = useIntlLocale();
  const SEVERITY_OPTIONS = SEVERITY_VALUES.map((value) => ({ value, label: t(`meta.policy.sev.${value}`) }));
  const STATUS_OPTIONS = STATUS_VALUES.map((value) => ({ value, label: t(`meta.policy.status.${value}`) }));
  const CATEGORY_OPTIONS = CATEGORY_VALUES.map((value) => ({ value, label: t(`meta.policy.cat.${value}`) }));
  const { user } = useSession();
  const canManage = !!user && hasPermission(user.role, "can_manage_policy_radar");
  const { toast } = useToast();
  const isDesktop = useIsDesktop();

  const [platform, setPlatform] = useState<PolicyPlatform | "all">("all");
  const [severity, setSeverity] = useState<PolicySeverity | "">("");
  const [category, setCategory] = useState<PolicyCategory | "">("");
  const [status, setStatus] = useState<PolicyReviewStatus | "">("");
  const [officialOnly, setOfficialOnly] = useState(false);
  const [viewMode, setViewMode] = useState<PolicyViewMode>("feed");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PolicyRadarItem>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const hasActiveFilters = platform !== "all" || !!severity || !!category || !!status || officialOnly;
  const resetFilters = () => {
    setPlatform("all"); setSeverity(""); setCategory(""); setStatus(""); setOfficialOnly(false);
  };

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (platform !== "all") params.set("platform", platform);
    if (severity) params.set("severity", severity);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (officialOnly) params.set("officialOnly", "true");
    return params.toString();
  }, [platform, severity, category, status, officialOnly]);

  const { data, error, isLoading, mutate } = useSWR(`/api/policy-radar/items?${query}`, fetcher);
  const { data: healthData } = useSWR("/api/policy-radar/source-health", fetcher);

  const items: PolicyRadarItem[] = (data?.data ?? []).map((i: PolicyRadarItem) => overrides[i.id] ?? i);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selectedIndex = items.findIndex((i) => i.id === selectedId);
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < items.length - 1;

  const openDetail = (item: PolicyRadarItem) => {
    setSelectedId(item.id);
    if (!isDesktop) setSheetOpen(true);
  };
  const goPrev = () => { if (hasPrev) setSelectedId(items[selectedIndex - 1].id); };
  const goNext = () => { if (hasNext) setSelectedId(items[selectedIndex + 1].id); };

  const handleUpdated = (updated: PolicyRadarItem) => {
    setOverrides((o) => ({ ...o, [updated.id]: updated }));
    mutate();
  };

  const list = (
    <div className="flex flex-col gap-3">
      {isLoading && <div className="text-sm text-slate-400 py-8 text-center">{t("meta.policy.page.loading")}</div>}

      {error && !isLoading && (
        <EmptyState
          icon={AlertCircle}
          title={t("meta.policy.page.errTitle")}
          description={t("meta.policy.page.errDesc")}
          action={<Button variant="outline" size="sm" onClick={() => mutate()}>{t("meta.policy.page.retry")}</Button>}
        />
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={Radar}
          title={t("meta.policy.page.emptyTitle")}
          description={t("meta.policy.page.emptyDesc")}
          action={hasActiveFilters ? <Button variant="outline" size="sm" onClick={resetFilters}>{t("meta.policy.page.clearFilters")}</Button> : undefined}
        />
      )}

      {!isLoading && !error && items.map((item) => (
        <PolicyCard key={item.id} item={item} onOpenDetail={openDetail} />
      ))}
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">

      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Radar className="h-5 w-5 text-blue-600" /> {t("meta.policy.page.title")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("meta.policy.page.subtitle")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> {t("meta.policy.page.add")}
          </Button>
        )}
      </div>

      {healthData?.syncMode === "hybrid" && (
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-4">
          <RefreshCw className="h-3.5 w-3.5" />
          {t("meta.policy.page.hybrid")}
          {healthData?.lastSyncAt && (
            <span className="text-slate-400">
              {t("meta.policy.page.lastScan", { time: new Date(healthData.lastSyncAt).toLocaleString(intl) })}
            </span>
          )}
        </div>
      )}

      {/* "Việc cần làm" đứng TRƯỚC dải thống kê: người mở trang này cần biết
          phải làm gì, không cần biết có bao nhiêu mục. Khối này không tự gọi AI
          khi mở trang — xem components/policy-radar/ActionPlanPanel. */}
      <div className="mt-4">
        <ActionPlanPanel
          canManage={canManage}
          onOpenItem={(id) => { setSelectedId(id); setSheetOpen(true); }}
        />
      </div>

      <div className="mt-4">
        <PolicySummaryStrip items={items} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
        <Tabs value={platform} onValueChange={(v) => setPlatform(v as PolicyPlatform | "all")}>
          <TabsList>
            <TabsTrigger value="all">{t("meta.policy.page.tabAll")}</TabsTrigger>
            <TabsTrigger value="google_ads">Google Ads</TabsTrigger>
            <TabsTrigger value="meta">Meta</TabsTrigger>
          </TabsList>
        </Tabs>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      <div className="mt-3">
        <PolicyFilterChips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} allLabel={t("meta.policy.page.allCategories")} />
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_400px] lg:gap-6 lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <PolicyFilterChips options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} allLabel={t("meta.policy.page.allSeverity")} />
            <PolicyFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} allLabel={t("meta.policy.page.allStatus")} />
            <label className="flex items-center gap-1.5 text-sm text-slate-600 px-1 shrink-0">
              <input type="checkbox" checked={officialOnly} onChange={(e) => setOfficialOnly(e.target.checked)} />
              {t("meta.policy.page.officialOnly")}
            </label>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
                <X className="h-3 w-3" /> {t("meta.policy.page.clearFilters")}
              </button>
            )}
          </div>

          {viewMode === "feed" ? list : (
            !isLoading && !error && (
              <PolicyTimelineView items={items} selectedId={selectedId} onOpenDetail={openDetail} />
            )
          )}
        </div>

        {/* Desktop: persistent sticky detail pane. Hidden below lg — tablet/mobile use the Sheet overlay instead. */}
        <div className="hidden lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)] lg:overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {selected ? (
            <PolicyDetailPanel
              item={selected}
              canManage={canManage}
              onUpdated={handleUpdated}
              onToast={toast}
              onPrev={goPrev}
              onNext={goNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
              <Radar className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-400">{t("meta.policy.page.pick")}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tablet/mobile detail overlay — gated by isDesktop in JS, not CSS, since
          Sheet content is portaled to document.body and a `hidden` ancestor
          class has no effect on it. Desktop selection shows in the sticky pane above. */}
      <PolicyDetailSheet
        item={selected}
        open={sheetOpen && !isDesktop}
        onOpenChange={setSheetOpen}
        canManage={canManage}
        onUpdated={handleUpdated}
        onToast={toast}
      />

      <AddPolicyItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => mutate()}
        onToast={toast}
      />
    </div>
  );
}
