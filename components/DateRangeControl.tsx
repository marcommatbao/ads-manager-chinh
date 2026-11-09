"use client";

// ============================================================
// Bộ chọn khoảng ngày CÓ ĐIỀU KHIỂN (controlled) — dùng cho /xu-ly và
// /do-luong. KHÁC với components/DateRangePicker.tsx (component đó buộc vào
// store zustand toàn cục dùng chung cho dashboard/campaigns/pmax và tự sửa
// window.location — không đụng vào, không tái dùng ở đây).
// ------------------------------------------------------------
// value/onChange là nguồn sự thật duy nhất — trang cha tự quyết giữ khoảng
// ở đâu (state, URL query…). Ngày luôn ở dạng "YYYY-MM-DD" theo giờ VN
// (xem lib/case/dates.ts) — không bao giờ dùng new Date().toISOString().
// ============================================================

import * as React from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { vi, enUS } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, vnDate, rangeDays, MAX_RANGE_DAYS } from "@/lib/case/dates";

export interface DateRangeValue {
  from: string;
  to: string;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}
function startOfMonthStr(ymd: string): string {
  const [y, m] = ymd.split("-");
  return `${y}-${m}-01`;
}
function lastMonthRange(today: string): DateRangeValue {
  const lastDayPrev = addDays(startOfMonthStr(today), -1);
  return { from: startOfMonthStr(lastDayPrev), to: lastDayPrev };
}

/** Chỉ dùng để chọn 1/2 tháng lịch hiển thị — Popover chỉ mount lúc mở nên
 *  không có rủi ro lệch hydrate SSR/CSR. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function DateRangeControl({
  value,
  onChange,
  maxDays = MAX_RANGE_DAYS,
  minDays,
  className,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  maxDays?: number;
  minDays?: number;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [tempRange, setTempRange] = React.useState<DateRange | undefined>(() => ({
    from: parseYmd(value.from),
    to: parseYmd(value.to),
  }));
  const isDesktop = useIsDesktop();
  const today = vnDate();
  const todayDate = parseYmd(today);

  // Mở lại popover luôn khởi từ khoảng đang áp dụng — sửa dở rồi đóng ra
  // không được giữ lại (Huỷ coi như chưa từng sửa).
  React.useEffect(() => {
    if (open) setTempRange({ from: parseYmd(value.from), to: parseYmd(value.to) });
  }, [open, value.from, value.to]);

  const hasFullRange = !!tempRange?.from && !!tempRange?.to;
  const span = hasFullRange ? differenceInCalendarDays(tempRange!.to!, tempRange!.from!) + 1 : 0;
  const tooLong = hasFullRange && span > maxDays;
  const tooShort = hasFullRange && !!minDays && span < minDays;
  const validationMessage = tooLong
    ? t("panels.daterange.max", { max: maxDays, span })
    : tooShort
      ? t("panels.daterange.min", { min: minDays ?? 0, span })
      : null;
  const canApply = hasFullRange && !tooLong && !tooShort;

  const presets = React.useMemo(() => {
    const all = [
      { id: "panels.daterange.d7" as MessageKey, range: { from: addDays(today, -6), to: today } },
      { id: "panels.daterange.d30" as MessageKey, range: { from: addDays(today, -29), to: today } },
      { id: "panels.daterange.d90" as MessageKey, range: { from: addDays(today, -89), to: today } },
      { id: "panels.daterange.thisMonth" as MessageKey, range: { from: startOfMonthStr(today), to: today } },
      { id: "panels.daterange.lastMonth" as MessageKey, range: lastMonthRange(today) },
    ];
    return all.filter((p) => {
      const n = rangeDays(p.range);
      return n <= maxDays && (!minDays || n >= minDays);
    });
  }, [today, maxDays, minDays]);

  function applyPreset(range: DateRangeValue) {
    setTempRange({ from: parseYmd(range.from), to: parseYmd(range.to) });
  }

  function handleApply() {
    if (!canApply || !tempRange?.from || !tempRange?.to) return;
    onChange({ from: toYmd(tempRange.from), to: toYmd(tempRange.to) });
    setOpen(false);
  }

  function handleCancel() {
    setOpen(false); // không gọi onChange — useEffect ở lượt mở kế tiếp sẽ nạp lại `value`
  }

  const triggerLabel = `${format(parseYmd(value.from), "dd/MM/yyyy")} → ${format(parseYmd(value.to), "dd/MM/yyyy")} · ${t("panels.daterange.days", { n: rangeDays(value) })}`;

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-10 justify-between gap-2 rounded-lg border-slate-200 bg-white px-3 text-left text-sm font-normal focus:ring-2 focus:ring-amber-100"
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="font-medium text-slate-800">{triggerLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,320px)] p-0 sm:w-auto" align="start">
          <div className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-lg sm:flex-row">
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/50 p-2 sm:w-[140px] sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0 sm:p-3">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="shrink-0 rounded-md px-2.5 py-1.5 sm:px-3 sm:py-2 text-left text-sm font-medium whitespace-nowrap text-slate-700 transition-colors hover:bg-slate-200/50"
                  onClick={() => applyPreset(preset.range)}
                >
                  {t(preset.id)}
                </button>
              ))}
            </div>

            {/* Calendar + actions */}
            <div className="p-3">
              <Calendar
                mode="range"
                defaultMonth={tempRange?.from ?? todayDate}
                selected={tempRange}
                onSelect={setTempRange}
                numberOfMonths={isDesktop ? 2 : 1}
                locale={locale === "en" ? enUS : vi}
                // Tên thứ ngắn "T2…CN" — mặc định locale vi là "Th 2" dính nhau trên điện thoại.
                formatters={{ formatWeekdayName: (d) => t("panels.daterange.weekdays").split(",")[d.getDay()] }}
                disabled={{ after: todayDate }}
              />
              {validationMessage && (
                <div className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{validationMessage}</div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={handleCancel}>{t("panels.daterange.cancel")}</Button>
                <Button
                  size="sm"
                  className="bg-amber-500 text-amber-950 hover:bg-amber-600"
                  onClick={handleApply}
                  disabled={!canApply}
                >
                  {t("panels.daterange.apply")}
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
