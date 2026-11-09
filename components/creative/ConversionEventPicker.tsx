"use client";

// ============================================================
// Bộ chọn "Sự kiện chuyển đổi" — dựng theo Ads Manager
// ============================================================
// Thay cho <select> 5 mục cứng trước đây. Danh sách lấy thật từ
// /api/creative/pixel-events: sự kiện đang bắn về Pixel + chuyển đổi tùy
// chỉnh của tài khoản + phần còn lại của danh mục tiêu chuẩn.
//
// Về nhãn bên phải: Ads Manager gắn "API Chuyển đổi" cho sự kiện nhận qua
// Conversions API. /{pixel_id}/stats KHÔNG nói được sự kiện đến từ trình
// duyệt hay từ server, nên ở đây hiển thị SỐ LƯỢT THẬT trong cửa sổ thống kê
// thay vì chép cái nhãn đó — số lượt vừa kiểm chứng được vừa hữu ích hơn khi
// chọn mục tiêu. Khi không đọc được thống kê thì không vẽ chấm xanh và không
// hiện số nào cả.

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronDown, Search, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { ConversionEventOption, PixelEventsPayload } from "@/lib/meta-pixel-events";

export interface ConversionEventSelection {
  /** enum custom_event_type — có với sự kiện tiêu chuẩn */
  pixelEvent?: string;
  /** ID chuyển đổi tùy chỉnh */
  customConversionId?: string;
  /** tên sự kiện tùy chỉnh web tự bắn */
  pixelCustomEventName?: string;
  /** nhãn để hiện lại trên nút và lưu vào bản nháp */
  label: string;
  key: string;
}

interface Props {
  pixelId: string;
  value: ConversionEventSelection;
  onChange: (v: ConversionEventSelection) => void;
}

/** Xuất ra để Đợt 7b tái dùng: khớp gợi ý Sổ kinh nghiệm với danh sách sự kiện
 *  thật của Pixel rồi dựng đúng hình dạng ConversionEventSelection. */
export function optionToSelection(o: ConversionEventOption): ConversionEventSelection {
  if (o.kind === "custom_conversion") {
    return { customConversionId: o.customConversionId, label: o.label, key: o.key };
  }
  if (o.kind === "custom_event") {
    return { pixelCustomEventName: o.pixelEventName, label: o.label, key: o.key };
  }
  return { pixelEvent: o.enumValue, label: o.label, key: o.key };
}

function formatCount(n: number, t: TFunction): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")}${t("creative.brief.convPicker.millionSuffix")}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")}${t("creative.brief.convPicker.thousandSuffix")}`;
  return String(n);
}

const fetcher = async (url: string): Promise<PixelEventsPayload> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function ConversionEventPicker({ pixelId, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // SWR thay cho useEffect + setState: vừa tránh luật react-hooks/set-state-in-effect,
  // vừa tự huỷ lượt gọi cũ khi người dùng đổi Pixel giữa chừng.
  const { data, error: loadError, isLoading: loading } = useSWR<PixelEventsPayload>(
    pixelId ? `/api/creative/pixel-events?pixelId=${encodeURIComponent(pixelId)}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Ô tìm kiếm được Radix tự lấy nét khi mở (phần tử focus được đầu tiên trong
  // panel), nên không cần effect nào; dọn từ khoá ngay tại chỗ đóng panel.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  const options = useMemo(() => data?.options ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ?? "").toLowerCase().includes(q) ||
        (o.pixelEventName ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  // Ba nhóm, đúng thứ tự Ads Manager dùng: đang hoạt động → chuyển đổi tùy
  // chỉnh → phần còn lại. Khi không đọc được thống kê thì không có nhóm "đang
  // hoạt động" (không biết thì không xếp).
  const groups = useMemo(() => {
    const activeGroup: ConversionEventOption[] = [];
    const customConv: ConversionEventOption[] = [];
    const rest: ConversionEventOption[] = [];
    for (const o of filtered) {
      if (o.kind === "custom_conversion") customConv.push(o);
      else if (o.active) activeGroup.push(o);
      else rest.push(o);
    }
    activeGroup.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return [
      { title: data ? t("creative.brief.convPicker.activeTitleDays", { days: data.statsWindowDays }) : t("creative.brief.convPicker.activeTitle"), items: activeGroup },
      { title: t("creative.brief.convPicker.customConversions"), items: customConv },
      {
        title: data?.activityKnown
          ? t("creative.brief.convPicker.otherEvents", { days: data.statsWindowDays })
          : t("creative.brief.convPicker.conversionEvents"),
        items: rest,
      },
    ].filter((g) => g.items.length > 0);
  }, [filtered, data, t]);

  const selectedOption = options.find((o) => o.key === value.key);
  const triggerLabel = selectedOption?.label ?? value.label ?? t("creative.brief.convPicker.choose");

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-amber-300 focus:border-amber-400 focus:outline-none"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-none p-0"
        >
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 focus-within:border-amber-400">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("creative.brief.convPicker.search")}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-300"
              />
            </div>
          </div>

          {!pixelId && (
            <p className="px-3 py-3 text-xs text-slate-400">{t("creative.brief.convPicker.needPixel")}</p>
          )}

          {loading && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("creative.brief.convPicker.reading")}
            </p>
          )}

          {loadError && (
            <p className="flex items-start gap-1.5 px-3 py-2 text-[11px] text-red-600">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t("creative.brief.convPicker.apiError", { message: loadError instanceof Error ? loadError.message : String(loadError) })}
            </p>
          )}

          {data && data.warnings.length > 0 && (
            <div className="flex items-start gap-1.5 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <div>{data.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && !loading && pixelId && (
              <p className="px-3 py-3 text-xs text-slate-400">{t("creative.brief.convPicker.noMatch", { query })}</p>
            )}

            {groups.map((group) => (
              <div key={group.title}>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500">{group.title}</p>
                {group.items.map((o) => {
                  const isSelected = o.key === value.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => { onChange(optionToSelection(o)); setOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition",
                        isSelected ? "bg-amber-50" : "hover:bg-slate-50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          isSelected ? "border-amber-500 bg-amber-500" : "border-slate-300"
                        )}
                      >
                        {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>

                      {/* Chấm xanh CHỈ khi đọc được thống kê và sự kiện thật sự có bắn */}
                      {o.active && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />}

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-700">{o.label}</span>
                        {o.sublabel && o.sublabel !== o.label && (
                          <span className="block truncate text-[11px] text-slate-400">{o.sublabel}</span>
                        )}
                      </span>

                      {typeof o.count === "number" && o.count > 0 && (
                        <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          {t("creative.brief.convPicker.count", { count: formatCount(o.count, t) })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {data?.source === "fallback" && (
        <p className="mt-1 text-[10px] text-amber-600">
          {t("creative.brief.convPicker.fallback")}
        </p>
      )}
      {data?.activityKnown === false && data?.source === "live" && (
        <p className="mt-1 text-[10px] text-slate-400">
          {t("creative.brief.convPicker.activityUnknown")}
        </p>
      )}
    </div>
  );
}
