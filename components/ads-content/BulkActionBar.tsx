"use client";

import { Download, FileText, Copy, Columns2, Sparkles, X, Loader2, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";

function buildClipboardText(items: CreativeItem[]): string {
  return items
    .map((item) => {
      const lines = [
        `# ${item.name} (${item.campaignName})`,
        item.headline ? `Headline: ${item.headline}` : null,
        item.primaryText ? `Text: ${item.primaryText}` : null,
        (item.descriptions ?? []).length ? `Descriptions: ${item.descriptions!.join(" | ")}` : null,
        item.finalUrl ? `URL: ${item.finalUrl}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

interface BulkActionBarProps {
  selectedItems: CreativeItem[];
  onClear: () => void;
  onExportSelected: () => void;
  onExportSelectedPdf: () => void;
  onCompare: () => void;
  /** Ghim creative đang chọn để so với một creative ở THÁNG KHÁC — bộ chọn
   *  bên trái chỉ nạp creative của tháng đang xem, nên nếu không có chỗ ghim
   *  thì hai video thay phiên nhau theo thời gian (đúng tình huống hay gặp
   *  nhất khi đổi video) sẽ không bao giờ đứng cạnh nhau được. */
  onPin: () => void;
  pinnedCount: number;
  onSendToImprove: () => void;
  exporting?: boolean;
  exportingPdf?: boolean;
  onToast: (message: string) => void;
}

export function BulkActionBar({ selectedItems, onClear, onExportSelected, onExportSelectedPdf, onCompare, onPin, pinnedCount, onSendToImprove, exporting, exportingPdf, onToast }: BulkActionBarProps) {
  const t = useT();
  if (selectedItems.length === 0) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildClipboardText(selectedItems));
      onToast(t("creative.adsContent.bulk.copied", { n: selectedItems.length }));
    } catch {
      onToast(t("creative.adsContent.bulk.copyFail"));
    }
  }

  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
      <span className="text-sm font-semibold text-slate-700">{t("creative.adsContent.bulk.selected", { n: selectedItems.length })}</span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" /> {t("creative.adsContent.bulk.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={onCompare} disabled={selectedItems.length !== 2} title={selectedItems.length !== 2 ? t("creative.adsContent.bulk.compareTitle") : undefined}>
          <Columns2 className="h-3.5 w-3.5" /> {t("creative.adsContent.bulk.compare")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPin}
          disabled={selectedItems.length !== 1 || pinnedCount >= 2}
          title={
            pinnedCount >= 2 ? t("creative.adsContent.bulk.pinFull")
              : selectedItems.length !== 1 ? t("creative.adsContent.bulk.pinOne")
              : t("creative.adsContent.bulk.pinHint")
          }
        >
          <Pin className="h-3.5 w-3.5" /> {t("creative.adsContent.bulk.pin")}{pinnedCount > 0 ? ` (${pinnedCount}/2)` : ""}
        </Button>
        <Button variant="outline" size="sm" onClick={onSendToImprove}>
          <Sparkles className="h-3.5 w-3.5" /> {t("creative.adsContent.bulk.sendImprove")}
        </Button>
        <Button variant="default" size="sm" onClick={onExportSelected} disabled={exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {t("creative.adsContent.bulk.exportExcel")}
        </Button>
        <Button variant="outline" size="sm" onClick={onExportSelectedPdf} disabled={exportingPdf}>
          {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {t("creative.adsContent.bulk.exportPdf")}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClear} title={t("creative.adsContent.bulk.clear")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
