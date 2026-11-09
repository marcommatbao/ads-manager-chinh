"use client";

// ============================================================
// Nội dung chính của /meta-xray. Đọc GET /api/meta/xray (lib/meta/xray.ts +
// lib/meta/recommend.ts — SERVER, kéo Meta Graph SDK) nên ở đây CHỈ `import type`
// từ hai module đó, không bao giờ import giá trị/hàm. Trang này CHỈ ĐỌC: việc
// ghi duy nhất (mở nhóm quảng cáo mới chỉ tính lượt bấm / tối ưu Mua hàng) đi
// qua phiên /xu-ly có sẵn — xem components/meta/MetaRecommendations.tsx.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { getJson, ApiError } from "@/components/case/api";
import { vnd, num, pct, datetimeVN } from "@/components/case/format";
import { Kpi } from "@/components/measure/Kpi";
import { Button } from "@/components/ui/button";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import { MetaRecommendations } from "./MetaRecommendations";
import { MetaCampaignTable } from "./MetaCampaignTable";
import { MetaDetailSection } from "./MetaDetailSection";
import type { MetaXray } from "@/lib/meta/xray";
import type { MetaRecommendation } from "@/lib/meta/recommend";

type Company = string;
type Range = { from: string; to: string };

interface XrayResponse extends MetaXray {
  success: true;
  recommendations: MetaRecommendation[];
  canEdit: boolean;
}

// ── Section 2: cảnh báo ──

function WarningBanner({ warnings }: { warnings: MetaXray["warnings"] }) {
  const t = useT();
  const bad = warnings.filter((w) => w.level === "bad");
  const warn = warnings.filter((w) => w.level === "warn");
  if (bad.length === 0 && warn.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        {t("meta.xray.view.noWarnings")}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {bad.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("meta.xray.view.warning")}
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-red-700">
            {bad.map((w) => <li key={w.id} className="flex gap-1.5"><span className="shrink-0 font-bold">✕</span><span>{w.text}</span></li>)}
          </ul>
        </div>
      )}
      {warn.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <ul className="space-y-1.5 text-xs text-amber-700">
            {warn.map((w) => <li key={w.id} className="flex gap-1.5"><span className="shrink-0 font-bold">⚠</span><span>{w.text}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function XraySkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );
}

// ── Root ──

export function MetaXrayView({ company, range }: { company: Company; range: Range }) {
  const intl = useIntlLocale();
  const t = useT();
  const [data, setData] = useState<XrayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { force?: boolean; detail?: boolean }) => {
    if (opts?.force) setReloading(true);
    else if (opts?.detail) setDetailLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ company, from: range.from, to: range.to });
      if (opts?.detail) qs.set("detail", "1");
      if (opts?.force) qs.set("force", "1");
      const json = await getJson(`/api/meta/xray?${qs.toString()}`);
      setData(json as XrayResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("meta.xray.view.connErr"));
    } finally {
      setLoading(false);
      setReloading(false);
      setDetailLoading(false);
    }
  }, [company, range.from, range.to, t]);

  useEffect(() => { load(); }, [load]);

  // "Tải lại số mới" giữ nguyên phần chi tiết nếu đã tải — không âm thầm bỏ mất
  // 4 bảng người dùng vừa mở ra xem.
  const refresh = useCallback(() => load({ force: true, detail: !!data?.detail }), [load, data?.detail]);
  const loadDetail = useCallback(() => load({ detail: true }), [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("meta.xray.view.readOnly")}</p>
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={refresh} disabled={loading || reloading}>
          {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("meta.xray.view.reload")}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <XraySkeleton />
      ) : !data ? null : data.totals.spend === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
          <ScanLine className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-500">{t("meta.xray.view.noSpendTitle")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("meta.xray.view.noSpendDesc", { company })}</p>
        </div>
      ) : (
        <>
          {data.errors.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("meta.xray.view.partial", { errors: data.errors.join(" · ") })}
            </p>
          )}

          {/* ── 1. Chỉ số lớn ── */}
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi label={t("meta.xray.kpi.spend")} value={vnd(data.totals.spend, intl)} />
              <Kpi label={t("meta.xray.kpi.metaPurchases")} value={num(data.totals.purchases, { maximumFractionDigits: 1 }, intl)} />
              <Kpi label={t("meta.xray.kpi.click")} value={num(data.totals.click, { maximumFractionDigits: 1 }, intl)} />
              <Kpi
                label={t("meta.xray.kpi.view")}
                value={num(data.totals.view, { maximumFractionDigits: 1 }, intl)}
                sub={data.totals.purchases > 0 ? t("meta.xray.kpi.viewSub", { pct: pct(data.totals.view / data.totals.purchases, 0, intl) }) : undefined}
                bad={data.warnings.some((w) => w.id === "view_heavy_account")}
              />
              <Kpi
                label={t("meta.xray.kpi.ga4")}
                value={data.totals.ga4Facebook !== null ? num(data.totals.ga4Facebook, { maximumFractionDigits: 1 }, intl) : t("meta.xray.kpi.notReconciled")}
              />
            </div>
            <p className="text-[11px] italic text-slate-400">
              {t("meta.xray.view.viewNote")}
            </p>
          </section>

          {/* ── 2. Cảnh báo ── */}
          <WarningBanner warnings={data.warnings} />

          {/* ── 3. Việc nên làm ── */}
          <div>
            <h3 className="text-base font-extrabold text-slate-900">{t("meta.xray.view.todo")}</h3>
          </div>
          <MetaRecommendations recommendations={data.recommendations} company={company} range={range} />

          {/* ── 4. Bảng chiến dịch ── */}
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("meta.xray.view.campaigns")}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t("meta.xray.view.campaignsHint")}</p>
          </div>
          <MetaCampaignTable campaigns={data.campaigns} />

          {/* ── 5. Phân tích chi tiết ── */}
          <MetaDetailSection detail={data.detail} loading={detailLoading} onLoad={loadDetail} />

          {/* ── 6. Ghi chú + lượt gọi ── */}
          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            {data.notes.map((n, i) => <p key={i}>{n}</p>)}
            <p>{t("meta.xray.view.calls", { n: data.calls })}</p>
          </div>
          <p className="text-right text-[10px] text-slate-300">{t("meta.xray.view.updatedAt", { time: datetimeVN(data.collectedAt, intl) })}</p>
        </>
      )}
    </div>
  );
}
