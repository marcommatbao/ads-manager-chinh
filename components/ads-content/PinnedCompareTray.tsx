"use client";

// Khay creative đã ghim — nổi trên màn hình và SỐNG QUA việc đổi tháng.
// Lý do tồn tại: danh sách Nội dung quảng cáo chỉ nạp creative có chi tiêu
// trong tháng đang xem, nên hai video thay phiên nhau (video người tháng 6,
// video AI tháng 9) không bao giờ cùng xuất hiện trong một danh sách để tick
// chọn. Ghim bên này, đổi tháng, ghim bên kia, rồi bấm So sánh.

import { Pin, X, Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";

interface Props {
  pinned: CreativeItem[];
  onUnpin: (id: string) => void;
  onCompare: () => void;
  onClear: () => void;
}

export function PinnedCompareTray({ pinned, onUnpin, onCompare, onClear }: Props) {
  const t = useT();
  if (pinned.length === 0) return null;

  return (
    <div className="sticky bottom-20 z-30 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-lg">
      <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span className="text-xs font-semibold text-amber-800">{t("creative.adsContent.tray.pinned", { n: pinned.length })}</span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {pinned.map((p) => (
          <span key={p.id} className="flex max-w-[220px] items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-slate-700">
            <span className="truncate" title={`${p.name} — ${p.campaignName}`}>{p.name}</span>
            <button type="button" onClick={() => onUnpin(p.id)} className="shrink-0 text-slate-400 hover:text-red-600" title={t("creative.adsContent.tray.unpin")}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={onCompare}
          disabled={pinned.length !== 2}
          title={pinned.length !== 2 ? t("creative.adsContent.tray.needTwo") : undefined}
        >
          <Columns2 className="h-3.5 w-3.5" /> {t("creative.adsContent.tray.compare")}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClear} title={t("creative.adsContent.tray.clear")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
