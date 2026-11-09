"use client";

// Danh sách bấm thử sau mỗi lần cập nhật — nguồn PROD_CHECKLIST (module thuần,
// xem lib/system/prod-checklist.ts). Trạng thái tích chỉ lưu TRÊN TRÌNH DUYỆT
// của người xem (localStorage) — không đồng bộ nhiều máy, không phải nguồn
// sự thật cho việc đã test hay chưa trên production.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PROD_CHECKLIST } from "@/lib/system/prod-checklist";
import { useT } from "@/lib/i18n/client";

const STORAGE_KEY = "health-checklist-v1";

/** Đọc lười — chỉ chạy lúc mount (qua useState initializer), không phải effect
 *  (mirror app/(dashboard)/automation/page.tsx: `useState(() => ...)` cho cùng
 *  bài toán "trạng thái riêng-trình-duyệt từ localStorage"). Chặn được ở
 *  server (không có `window`) lẫn localStorage bị khoá (chế độ ẩn danh). */
function loadChecked(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveChecked(v: Record<string, boolean>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // localStorage có thể bị chặn (chế độ ẩn danh, cấu hình trình duyệt) —
    // trang vẫn phải chạy được, chỉ là không nhớ trạng thái tích giữa các lượt.
  }
}

export function ChecklistPanel() {
  const t = useT();
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveChecked(next);
      return next;
    });
  };

  const clearAll = () => {
    setChecked({});
    saveChecked({});
  };

  const doneCount = PROD_CHECKLIST.filter((i) => checked[i.id]).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-800">{t("overview.health.checklist.title")}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("overview.health.checklist.hint")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-slate-500">{doneCount}/{PROD_CHECKLIST.length}</span>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={clearAll} disabled={doneCount === 0}>
            {t("overview.health.checklist.clear")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {PROD_CHECKLIST.map((item) => {
          const isChecked = !!checked[item.id];
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                isChecked ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100 bg-slate-50/40"
              )}
            >
              <Checkbox checked={isChecked} onCheckedChange={() => toggle(item.id)} className="mt-0.5" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-700">{item.area}</span>
                  <Link href={item.href} className="font-mono text-blue-600 hover:underline">{item.href}</Link>
                </div>
                <p className="text-slate-600 mt-1"><span className="font-medium text-slate-500">{t("overview.health.checklist.steps")}: </span>{item.steps}</p>
                <p className="text-slate-500 mt-0.5"><span className="font-medium">{t("overview.health.checklist.expect")}: </span>{item.expect}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
