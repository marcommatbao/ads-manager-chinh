"use client";

// ============================================================
// 🩺 Sức khoẻ tool — /settings/health
// ------------------------------------------------------------
// Đọc GET /api/system/health (jobs + connectors + kênh cảnh báo + đối chiếu
// số tuần), cho phép super admin gửi thử cảnh báo (POST test_alert), và một
// danh sách bấm thử thủ công sau mỗi lần cập nhật (PROD_CHECKLIST). Cùng
// phong cách với app/(dashboard)/settings/jobs/page.tsx.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { getJson, ApiError } from "@/components/case/api";
import type { HealthResponse } from "@/components/health/types";
import { SummaryStrip } from "@/components/health/SummaryStrip";
import { TestAlertButton } from "@/components/health/TestAlertButton";
import { JobsHealthTable } from "@/components/health/JobsHealthTable";
import { ConnectorsTable } from "@/components/health/ConnectorsTable";
import { NumbersCheckTable } from "@/components/health/NumbersCheckTable";
import { ChecklistPanel } from "@/components/health/ChecklistPanel";

export default function HealthPage() {
  const t = useT();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = (await getJson("/api/system/health")) as HealthResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("creative.settingsHealth.err.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-800">{t("creative.settingsHealth.title")}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("creative.settingsHealth.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 text-xs border-slate-200">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />{t("creative.settingsHealth.refresh")}
        </Button>
      </div>

      {/* Loading (lần đầu) */}
      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
        </div>
      )}

      {/* Lỗi — chưa có dữ liệu nào để hiện */}
      {error && !data && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">{t("creative.settingsHealth.errTitle")}</p>
          <p className="text-xs text-red-700 mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>{t("creative.settingsHealth.retry")}</Button>
        </div>
      )}

      {/* Lỗi ở lần refresh sau — vẫn còn dữ liệu cũ để hiện */}
      {error && data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          {t("creative.settingsHealth.errStale", { error })}
        </div>
      )}

      {data && (
        <>
          <SummaryStrip jobs={data.jobs} connectors={data.connectors} alertChannel={data.alertChannel} bootAt={data.bootAt} />

          {/* Đợt 24c: phiên bản mã + phiên bản dữ liệu */}
          {data.version && (
            <div className={`rounded-xl border px-4 py-2.5 text-sm ${data.version.data && (data.version.data.status === "failed" || data.version.data.status === "newer") ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"}`}>
              {t("creative.settingsHealth.ver.version")}<b className="text-slate-900">{data.version.app}</b>
              {data.version.data && <>{t("creative.settingsHealth.ver.data")}<b className="text-slate-900">v{data.version.data.to}</b>{data.version.data.status === "migrated" && <>{t("creative.settingsHealth.ver.migrated", { from: data.version.data.from ?? "" })}</>}</>}
              {data.version.data?.error && <div className="mt-1 text-xs">{data.version.data.error}</div>}
            </div>
          )}

          {data.canControl && <TestAlertButton />}

          <JobsHealthTable jobs={data.jobs} />

          <ConnectorsTable connectors={data.connectors} />

          <NumbersCheckTable numbersCheck={data.numbersCheck} />

          <ChecklistPanel />
        </>
      )}
    </div>
  );
}
