"use client";

// ============================================================
// Sổ kinh nghiệm — Đợt 7a
// ------------------------------------------------------------
// Học từ những gì đã thắng trong 180 ngày qua, dùng lại khi tạo chiến dịch
// mới (Facebook + Google). Trang chỉ điều phối: fetch (một lượt GET mỗi
// công ty được phép xem — /api/playbook chỉ nhận MỘT company/lượt) + lọc
// client-side + Duyệt/Bỏ/Trả về gợi ý. Thiết kế: docs/DESIGN-DOT7.md.
//
// BUILD RULE: đây là client component — KHÔNG import GIÁ TRỊ từ lib/playbook/*
// (kéo theo fs/meta-client vào bundle trình duyệt). Chỉ `import type` cho các
// kiểu; giá trị chỉ lấy từ lib/permissions, lib/utils, lib/case/dates (an toàn).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { BookOpenCheck, Loader2, RefreshCw, Play, CloudDownload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/components/SessionProvider";
import { useToast } from "@/components/Toast";
import { resolveCompanyScope } from "@/lib/permissions";
import { getJson, patchJson, postJson, ApiError } from "@/components/case/api";
import { datetimeVN } from "@/components/case/format";
import { PlaybookTable } from "@/components/playbook/PlaybookTable";
import { PlaybookOutcomesSection, type OutcomesApiResponse } from "@/components/playbook/PlaybookOutcomesSection";
import { PLATFORM_LABEL, KIND_GROUP, KIND_GROUP_OPTIONS, kindGroupLabel, statusOptions } from "@/components/playbook/labels";
import type { PlaybookFile, PlaybookEntry, EntryStatus } from "@/lib/playbook/store";
import type { Platform } from "@/lib/playbook/engine";
import type { Company } from "@/lib/case/types";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface PlaybookApiResponse extends PlaybookFile {
  metaCoverage: { have: number; need: number };
  canDecide: boolean;
  canRunNow: boolean;
}

const DECISION_TOAST: Record<"approved" | "rejected" | "suggested", MessageKey> = {
  approved: "overview.experience.toastApproved",
  rejected: "overview.experience.toastRejected",
  suggested: "overview.experience.toastSuggested",
};

export default function SoKinhNghiemPage() {
  const intl = useIntlLocale();
  const { user } = useSession();
  const { toast } = useToast();
  const t = useT();

  const allowedCompanies = useMemo(
    () => resolveCompanyScope(user?.companies, user?.role),
    [user],
  );

  const swrKey =
    user && allowedCompanies.length > 0
      ? `playbook:${[...allowedCompanies].sort().join(",")}`
      : null;
  const { data, error, isLoading, mutate } = useSWR<PlaybookApiResponse[]>(swrKey, () =>
    Promise.all(allowedCompanies.map((co) => getJson(`/api/playbook?company=${co}`))),
  );

  // Kết quả áp dụng (Đợt 9 · 4 / 7c) — nguồn RIÊNG (/api/playbook/outcomes), route không trả lại
  // `company` nên ghép vào ngay lúc fetch.
  const outcomesKey =
    user && allowedCompanies.length > 0
      ? `playbook-outcomes:${[...allowedCompanies].sort().join(",")}`
      : null;
  const { data: outcomesData, error: outcomesError, isLoading: outcomesLoading, mutate: mutateOutcomes } = useSWR<OutcomesApiResponse[]>(outcomesKey, () =>
    Promise.all(allowedCompanies.map((co) => getJson(`/api/playbook/outcomes?company=${co}`).then((r) => ({ ...r, company: co })))),
  );

  const [companyFilter, setCompanyFilter] = useState<Company | "">("");
  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [actingId, setActingId] = useState<string | null>(null);
  const [running, setRunning] = useState<"playbook_extract" | "playbook_meta_sync" | null>(null);

  const companies = data ?? [];
  const allEntries = companies.flatMap((c) => c.entries);
  const updatedAt = companies.reduce<string | null>(
    (latest, c) => (!c.updatedAt ? latest : !latest || c.updatedAt > latest ? c.updatedAt : latest),
    null,
  );
  const metaCoverage = companies[0]?.metaCoverage ?? { have: 0, need: 12 };
  const canDecide = companies.some((c) => c.canDecide);
  const canRunNow = companies.some((c) => c.canRunNow);
  const neverRan = companies.length > 0 && companies.every((c) => !c.updatedAt);
  const hasAnyEntry = allEntries.length > 0;

  const productOptions = useMemo(
    () => Array.from(new Set(allEntries.map((e) => e.product))).sort(),
    [allEntries],
  );

  const filtered = allEntries.filter(
    (e) =>
      (!companyFilter || e.company === companyFilter) &&
      (!platformFilter || e.platform === platformFilter) &&
      (!productFilter || e.product === productFilter) &&
      (!kindFilter || KIND_GROUP[e.kind] === kindFilter) &&
      (!statusFilter || e.status === statusFilter),
  );
  const useEntries = filtered.filter((e) => e.direction === "use");
  const avoidEntries = filtered.filter((e) => e.direction === "avoid");
  const hasActiveFilters = !!(companyFilter || platformFilter || productFilter || kindFilter || statusFilter);

  async function decide(entry: PlaybookEntry, decision: "approved" | "rejected" | "suggested") {
    setActingId(entry.id);
    try {
      await patchJson("/api/playbook/entry", { company: entry.company, id: entry.id, decision });
      await mutate();
      toast({ title: t(DECISION_TOAST[decision]), variant: "success" });
    } catch (e) {
      toast({
        title: t("overview.experience.errSaveDecision"),
        description: e instanceof ApiError ? e.message : t("overview.experience.errGeneric"),
        variant: "error",
      });
    } finally {
      setActingId(null);
    }
  }

  async function runJob(jobId: "playbook_extract" | "playbook_meta_sync") {
    setRunning(jobId);
    try {
      const res = await postJson(`/api/jobs/${jobId}/trigger`);
      await mutate();
      toast({
        title: res?.success ? t("overview.experience.jobDone") : t("overview.experience.jobFailed"),
        description:
          jobId === "playbook_extract"
            ? t("overview.experience.jobExtractDone")
            : t("overview.experience.jobMetaDone"),
        variant: res?.success ? "success" : "error",
      });
    } catch (e) {
      toast({
        title: t("overview.experience.errRunJob"),
        description: e instanceof ApiError ? e.message : t("overview.experience.errGeneric"),
        variant: "error",
      });
    } finally {
      setRunning(null);
    }
  }

  const resetFilters = () => {
    setCompanyFilter("");
    setPlatformFilter("");
    setProductFilter("");
    setKindFilter("");
    setStatusFilter("");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <BookOpenCheck className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("overview.experience.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {t("overview.experience.subtitle")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("overview.experience.updatedLine")}{" "}
            <b className="text-slate-500">{updatedAt ? datetimeVN(updatedAt, intl) : t("overview.experience.neverRun")}</b>
          </p>
        </div>
        {canRunNow && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => runJob("playbook_meta_sync")} disabled={!!running}>
              {running === "playbook_meta_sync" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t("overview.experience.loadMeta")}
            </Button>
            <Button size="sm" onClick={() => runJob("playbook_extract")} disabled={!!running}>
              {running === "playbook_extract" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t("overview.experience.runNow")}
            </Button>
          </div>
        )}
      </div>

      {metaCoverage.have < metaCoverage.need && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          {t("overview.experience.metaCoverage", { have: metaCoverage.have, need: metaCoverage.need, days: metaCoverage.have * 15 })}
        </div>
      )}

      {companies.some((c) => c.notes.length > 0) && (
        <ul className="space-y-0.5 text-xs text-slate-400">
          {companies.flatMap((c) =>
            c.notes.map((n, i) => (
              <li key={`${c.company}-${i}`}>
                <span className="font-medium text-slate-500">{c.company}:</span> {n}
              </li>
            )),
          )}
        </ul>
      )}

      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-slate-100" />}

      {error && !isLoading && (
        <EmptyState
          icon={AlertCircle}
          title={t("overview.experience.errLoadTitle")}
          description={error instanceof ApiError ? error.message : t("overview.experience.errNoApi")}
          action={
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("overview.experience.retry")}
            </Button>
          }
        />
      )}

      {!isLoading && !error && neverRan && (
        <EmptyState
          icon={BookOpenCheck}
          title={t("overview.experience.neverRanTitle")}
          description={t("overview.experience.neverRanDesc")}
          action={
            canRunNow ? (
              <Button size="sm" onClick={() => runJob("playbook_extract")} disabled={!!running}>
                {running === "playbook_extract" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t("overview.experience.runNow")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && !neverRan && (
        <>
          <div>
            <h2 className="mb-1 text-sm font-semibold text-slate-700">{t("overview.experience.filterTitle")}</h2>
            <div className="flex flex-wrap gap-3">
              {allowedCompanies.length > 1 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.experience.fCompany")}</div>
                  <div role="tablist" aria-label={t("overview.experience.fCompany")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {(["", ...allowedCompanies] as (Company | "")[]).map((c) => (
                      <button
                        key={c || "all"}
                        role="tab"
                        aria-selected={companyFilter === c}
                        onClick={() => setCompanyFilter(c)}
                        className={
                          companyFilter === c
                            ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white"
                            : "rounded-md px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                        }
                      >
                        {c || t("overview.experience.all")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="min-w-[150px]">
                <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.experience.fPlatform")}</div>
                <Select value={platformFilter || "ALL"} onValueChange={(v) => setPlatformFilter((v && v !== "ALL" ? v : "") as Platform | "")}>
                  <SelectTrigger aria-label={t("overview.experience.fPlatform")}>
                    <SelectValue>{(v: string) => (v === "ALL" ? t("overview.experience.all") : PLATFORM_LABEL[v as Platform] ?? v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("overview.experience.all")}</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[200px]">
                <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.experience.fProduct")}</div>
                <Select value={productFilter || "ALL"} onValueChange={(v) => setProductFilter(v && v !== "ALL" ? v : "")}>
                  <SelectTrigger aria-label={t("overview.experience.fProduct")}>
                    <SelectValue>{(v: string) => (v === "ALL" ? t("overview.experience.all") : v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("overview.experience.all")}</SelectItem>
                    {productOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[210px]">
                <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.experience.fKind")}</div>
                <Select value={kindFilter || "ALL"} onValueChange={(v) => setKindFilter(v && v !== "ALL" ? v : "")}>
                  <SelectTrigger aria-label={t("overview.experience.fKind")}>
                    <SelectValue>{(v: string) => (v === "ALL" ? t("overview.experience.all") : kindGroupLabel(v, t))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("overview.experience.all")}</SelectItem>
                    {KIND_GROUP_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k}>{kindGroupLabel(k, t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[160px]">
                <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.experience.fStatus")}</div>
                <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter((v && v !== "ALL" ? v : "") as EntryStatus | "")}>
                  <SelectTrigger aria-label={t("overview.experience.fStatus")}>
                    <SelectValue>
                      {(v: string) => (v === "ALL" ? t("overview.experience.all") : statusOptions(t).find((s) => s.value === v)?.label ?? v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("overview.experience.all")}</SelectItem>
                    {statusOptions(t).map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <div className="flex items-end">
                  <Button variant="outline" size="sm" onClick={resetFilters}>{t("overview.experience.clearFilters")}</Button>
                </div>
              )}
            </div>
          </div>

          <PlaybookTable
            title={t("overview.experience.useTitle")}
            description={t("overview.experience.useDesc")}
            entries={useEntries}
            accent="use"
            canDecide={canDecide}
            actingId={actingId}
            onDecide={decide}
            emptyTitle={t("overview.experience.useEmptyTitle")}
            emptyDescription={
              hasAnyEntry
                ? t("overview.experience.useEmptyFiltered")
                : t("overview.experience.useEmptyNone")
            }
          />

          <PlaybookTable
            title={t("overview.experience.avoidTitle")}
            description={t("overview.experience.avoidDesc")}
            entries={avoidEntries}
            accent="avoid"
            canDecide={canDecide}
            actingId={actingId}
            onDecide={decide}
            emptyTitle={t("overview.experience.avoidEmptyTitle")}
            emptyDescription={t("overview.experience.avoidEmptyDesc")}
          />

          <PlaybookOutcomesSection
            responses={outcomesData ?? []}
            loading={outcomesLoading}
            error={outcomesError}
            onReload={mutateOutcomes}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            <span>{t("overview.experience.footerHint")}</span>
            <Button render={<Link href="/creative" />}>{t("overview.experience.createMeta")}</Button>
          </div>
        </>
      )}
    </div>
  );
}
