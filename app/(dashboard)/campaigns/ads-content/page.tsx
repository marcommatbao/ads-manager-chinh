"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { useAdsStore } from "@/store/useAdsStore";
import { useToast } from "@/components/Toast";
import { EmptyState } from "@/components/ui/empty-state";
import { AdsContentHeader } from "@/components/ads-content/AdsContentHeader";
import { SummaryStrip } from "@/components/ads-content/SummaryStrip";
import { AdsContentFilterBar } from "@/components/ads-content/AdsContentFilterBar";
import { CampaignGroupSection } from "@/components/ads-content/CampaignGroupSection";
import { CreativeDetailDrawer } from "@/components/ads-content/CreativeDetailDrawer";
import { CompareDialog } from "@/components/ads-content/CompareDialog";
import { BulkActionBar } from "@/components/ads-content/BulkActionBar";
import { PinnedCompareTray } from "@/components/ads-content/PinnedCompareTray";
import { currentMonth } from "@/lib/ads-content/month-range";
import { applyFilters, sortItems, groupByCampaign, DEFAULT_FILTERS, type AdsContentFilters } from "@/lib/ads-content/filtering";
import type { AdsContentResponse, CreativeItem } from "@/types/creative-content.types";
import { Images } from "lucide-react";
import { useT } from "@/lib/i18n/client";

const PINNED_KEY = "ads_content_pinned_compare";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error("Failed to load Ads Content");
  return r.json();
});

async function downloadExport(url: string, items: CreativeItem[], filename: string, extra?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, ...extra }),
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

async function downloadExcel(items: CreativeItem[]) {
  return downloadExport("/api/campaigns/ads-content/export", items, `ads-content-${new Date().toISOString().split("T")[0]}.xlsx`);
}

async function downloadPdf(items: CreativeItem[], month: string, currency: string, filters: AdsContentFilters) {
  return downloadExport("/api/campaigns/ads-content/export/pdf", items, `ads-content-${new Date().toISOString().split("T")[0]}.pdf`, { month, currency, filters });
}

export default function AdsContentPage() {
  const t = useT();
  const currency = useAdsStore((s) => s.currency);
  const { toast } = useToast();

  const [month, setMonth] = useState(currentMonth());
  const [filters, setFilters] = useState<AdsContentFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<CreativeItem | null>(null);
  const [compareItems, setCompareItems] = useState<[CreativeItem, CreativeItem] | null>(null);
  // Creative đã ghim phải giữ NGUYÊN VẸN cả object (không chỉ id): đổi sang
  // tháng khác là danh sách nạp lại và id cũ không còn tra ngược ra được gì.
  // sessionStorage để lỡ tay F5 giữa chừng không mất công ghim lại.
  const [pinned, setPinned] = useState<CreativeItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(PINNED_KEY);
      const parsed = raw ? (JSON.parse(raw) as CreativeItem[]) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 2) : [];
    } catch {
      return [];
    }
  });

  function persistPinned(next: CreativeItem[]) {
    setPinned(next);
    try {
      sessionStorage.setItem(PINNED_KEY, JSON.stringify(next));
    } catch { /* chế độ riêng tư chặn storage — ghim vẫn dùng được trong phiên */ }
  }
  const [exportingCurrentView, setExportingCurrentView] = useState(false);
  const [exportingSelected, setExportingSelected] = useState(false);
  const [exportingCurrentViewPdf, setExportingCurrentViewPdf] = useState(false);
  const [exportingSelectedPdf, setExportingSelectedPdf] = useState(false);

  const { data, error, isLoading, isValidating, mutate } = useSWR<AdsContentResponse>(
    `/api/campaigns/ads-content?month=${month}&company=ALL`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const allItems = useMemo(() => data?.items ?? [], [data]);

  const objectiveOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.campaignObjective).filter((o): o is string => Boolean(o)))).sort(),
    [allItems]
  );
  const productOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.campaignName))).sort(),
    [allItems]
  );

  const filteredItems = useMemo(() => sortItems(applyFilters(allItems, filters), filters.sort), [allItems, filters]);
  const groups = useMemo(() => groupByCampaign(filteredItems), [filteredItems]);
  const selectedItems = useMemo(() => filteredItems.filter((i) => selectedIds.has(i.id)), [filteredItems, selectedIds]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectGroup(ids: string[], select: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function handleExportCurrentView() {
    setExportingCurrentView(true);
    try {
      await downloadExcel(filteredItems);
      toast({ title: t("creative.adsContentPage.exportViewDone") });
    } catch {
      toast({ title: t("creative.adsContentPage.exportFailed") });
    } finally {
      setExportingCurrentView(false);
    }
  }

  async function handleExportSelected() {
    setExportingSelected(true);
    try {
      await downloadExcel(selectedItems);
      toast({ title: t("creative.adsContentPage.exportSelectedDone", { n: selectedItems.length }) });
    } catch {
      toast({ title: t("creative.adsContentPage.exportFailed") });
    } finally {
      setExportingSelected(false);
    }
  }

  async function handleExportCurrentViewPdf() {
    setExportingCurrentViewPdf(true);
    try {
      await downloadPdf(filteredItems, month, currency, filters);
      toast({ title: t("creative.adsContentPage.exportPdfViewDone") });
    } catch {
      toast({ title: t("creative.adsContentPage.exportPdfFailed") });
    } finally {
      setExportingCurrentViewPdf(false);
    }
  }

  async function handleExportSelectedPdf() {
    setExportingSelectedPdf(true);
    try {
      await downloadPdf(selectedItems, month, currency, filters);
      toast({ title: t("creative.adsContentPage.exportPdfSelectedDone", { n: selectedItems.length }) });
    } catch {
      toast({ title: t("creative.adsContentPage.exportPdfFailed") });
    } finally {
      setExportingSelectedPdf(false);
    }
  }

  function handleSendToImprove() {
    if (selectedItems.length === 0) return;
    const first = selectedItems[0];
    window.location.href = `/creative?ref=ads-content&company=${first.company}&objective=${encodeURIComponent(first.campaignObjective ?? "")}&product=${encodeURIComponent(first.campaignName)}`;
  }

  function handleCompare() {
    if (selectedItems.length !== 2) return;
    setCompareItems([selectedItems[0], selectedItems[1]]);
  }

  function handlePin() {
    if (selectedItems.length !== 1 || pinned.length >= 2) return;
    const item = selectedItems[0];
    if (pinned.some((p) => p.id === item.id)) {
      toast({ title: t("creative.adsContentPage.alreadyPinned") });
      return;
    }
    persistPinned([...pinned, item]);
    setSelectedIds(new Set());
    toast({
      title: pinned.length === 0
        ? t("creative.adsContentPage.pinned1")
        : t("creative.adsContentPage.pinned2"),
    });
  }

  function handleComparePinned() {
    if (pinned.length !== 2) return;
    setCompareItems([pinned[0], pinned[1]]);
  }

  return (
    <div className="flex flex-col gap-5">

      <AdsContentHeader
        isRefreshing={isValidating}
        onRefresh={() => mutate()}
        onExportCurrentView={handleExportCurrentView}
        exportingCurrentView={exportingCurrentView}
        onExportCurrentViewPdf={handleExportCurrentViewPdf}
        exportingCurrentViewPdf={exportingCurrentViewPdf}
        currentViewCount={filteredItems.length}
        generatedAt={data?.generatedAt ?? null}
      />

      {data && data.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">{t("creative.adsContentPage.warningsTitle")}</p>
            <ul className="mt-1 list-disc pl-4">
              {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <EmptyState
          icon={AlertTriangle}
          title={t("creative.adsContentPage.loadErrorTitle")}
          description={t("creative.adsContentPage.loadErrorDesc")}
        />
      )}

      <SummaryStrip items={filteredItems} isLoading={isLoading} />

      <AdsContentFilterBar
        month={month}
        onMonthChange={setMonth}
        filters={filters}
        onFiltersChange={setFilters}
        objectiveOptions={objectiveOptions}
        productOptions={productOptions}
      />

      {!isLoading && !error && groups.length === 0 && (
        <EmptyState
          icon={Images}
          title={t("creative.adsContentPage.emptyTitle")}
          description={t("creative.adsContentPage.emptyDesc")}
        />
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 pb-24">
        {groups.map((group) => (
          <CampaignGroupSection
            key={group.campaignId}
            group={group}
            currency={currency}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectGroup={toggleSelectGroup}
            onViewDetail={setDetailItem}
          />
        ))}
      </div>

      <PinnedCompareTray
        pinned={pinned}
        onUnpin={(id) => persistPinned(pinned.filter((p) => p.id !== id))}
        onCompare={handleComparePinned}
        onClear={() => persistPinned([])}
      />

      <BulkActionBar
        selectedItems={selectedItems}
        onClear={() => setSelectedIds(new Set())}
        onExportSelected={handleExportSelected}
        onExportSelectedPdf={handleExportSelectedPdf}
        onCompare={handleCompare}
        onPin={handlePin}
        pinnedCount={pinned.length}
        onSendToImprove={handleSendToImprove}
        exporting={exportingSelected}
        exportingPdf={exportingSelectedPdf}
        onToast={(message) => toast({ title: message })}
      />

      <CreativeDetailDrawer item={detailItem} currency={currency} onOpenChange={(open) => !open && setDetailItem(null)} />
      <CompareDialog items={compareItems} currency={currency} onOpenChange={(open) => !open && setCompareItems(null)} />
    </div>
  );
}
