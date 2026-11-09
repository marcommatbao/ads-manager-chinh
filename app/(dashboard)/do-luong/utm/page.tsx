"use client";

// ============================================================
// Liên kết quảng cáo sai quy ước utm (Đợt 4 · B, mở rộng Google 27/09)
// ------------------------------------------------------------
// Meta không cho sửa nội dung quảng cáo đã chạy; Google cho sửa URL đích
// nhưng thay đổi làm quảng cáo bị duyệt lại → cả hai nền tảng tool chỉ PHÁT
// HIỆN + giao việc, không có nút áp trực tiếp. Bảng link chuẩn do người dùng
// nhập tay (readStandardLinks/writeStandardLinks ở lib/measure/utm-links.ts),
// tách theo CÔNG TY và NỀN TẢNG (lib/measure/utm-rules.ts).
// ============================================================

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, Copy, Info, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/components/SessionProvider";
import { useToast } from "@/components/Toast";
import { resolveCompanyScope, hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { vnd, num } from "@/components/case/format";
import { getJson, putJson, ApiError } from "@/components/case/api";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { UTM_RULES, linksOfCompany, type AdPlatform, type LinkProblem, type StandardLink } from "@/lib/measure/utm-rules";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, isYmd, lastDays, rangeDays } from "@/lib/case/dates";
import type { Company } from "@/lib/case/types";
import type { MetaHealth } from "@/lib/measure/meta-health";
import type { GoogleHealth } from "@/lib/measure/google-health";
import type { LinkSuggestion } from "@/lib/measure/utm-suggest";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type Platform = AdPlatform;
type HealthResponse =
  | ({ success: true; platform: "facebook" } & MetaHealth)
  | ({ success: true; platform: "google" } & GoogleHealth);
type LinksResponse = { success: true; links: StandardLink[]; updatedBy: string | null; updatedAt: string | null; isDefault: boolean; rules: { source: string; medium: string } };

const rich = (s: string) => s.split(/<(b|code)>(.*?)<\/\1>/).map((part, i, a) => (i % 3 === 2 ? (a[i - 1] === "b" ? <b key={i}>{part}</b> : <code key={i}>{part}</code>) : i % 3 === 1 ? null : part));

const PROBLEM_COPY: Record<LinkProblem, { tone: PillTone; text: MessageKey }> = {
  missing_utm: { tone: "red", text: "meta.utm.p.missing_utm" },
  wrong_source_medium: { tone: "amber", text: "meta.utm.p.wrong_source_medium" },
  campaign_not_standard: { tone: "amber", text: "meta.utm.p.campaign_not_standard" },
};

/** Đọc `?from=&to=` từ URL ở LẦN RENDER ĐẦU (reload) — không hợp lệ thì về mặc định 30 ngày. */
function initialRange(sp: ReturnType<typeof useSearchParams>): DateRangeValue {
  const from = sp.get("from");
  const to = sp.get("to");
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to };
  return lastDays(DEFAULT_VIEW_DAYS);
}

export default function DoLuongUtmPage() {
  // useSearchParams bắt buộc Suspense boundary khi build tĩnh (xem
  // node_modules/next/dist/docs/.../use-search-params.md) — bọc ở default export.
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl p-6"><div className="h-64 animate-pulse rounded-xl bg-slate-100" /></div>}>
      <DoLuongUtmPageInner />
    </Suspense>
  );
}

function DoLuongUtmPageInner() {
  const intl = useIntlLocale();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const { toast } = useToast();
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  const canEdit = !!user && hasPermission(user.role, "can_edit_thresholds");
  const [company, setCompany] = useState<Company>(() => orderedCompanyIds(["MBI"])[0] ?? "MBI") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [range, setRange] = useState<DateRangeValue>(() => initialRange(searchParams));
  const effectiveCompany = allowedCompanies.includes(company) ? company : allowedCompanies[0];
  const rule = UTM_RULES[platform];

  function handleRangeChange(next: DateRangeValue) {
    setRange(next);
    router.replace(`/do-luong/utm?from=${next.from}&to=${next.to}`, { scroll: false });
  }

  const { data: linksMeta, error: linksMetaError, isLoading: linksMetaLoading, mutate: mutateLinksMeta } = useSWR<LinksResponse>("/api/measure/utm-links", getJson);

  const healthUrl = effectiveCompany ? `/api/measure/health?platform=${platform}&company=${effectiveCompany}&from=${range.from}&to=${range.to}` : null;
  const { data: health, error: healthError, isLoading: healthLoading, mutate: mutateHealth } = useSWR<HealthResponse>(healthUrl, getJson);
  const rangeLabel = t("meta.utm.days", { n: rangeDays(health?.range ?? range) });
  const fbHealth = health && health.platform === "facebook" ? health : null;
  const googleHealthData = health && health.platform === "google" ? health : null;
  const googleRows = googleHealthData
    ? googleHealthData.utm.campaigns.flatMap((c) =>
        c.linkIssues.map((li, idx) => ({ key: `${c.campaignId}-${idx}`, campaignName: c.name, url: li.url, check: li.check })),
      )
    : [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StandardLink[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function startEdit() {
    setDraft((linksMeta?.links ?? []).map((l) => ({ ...l })));
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  function addRow() {
    setDraft((d) => [...d, { company: effectiveCompany ?? (orderedCompanyIds(["MBI"])[0] ?? "MBI"), platform, label: "", url: "" }]);
  }

  function removeRow(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }

  function patchRow(idx: number, patch: Partial<StandardLink>) {
    setDraft((d) => d.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const json = await putJson("/api/measure/utm-links", { links: draft });
      mutateLinksMeta(json, { revalidate: false });
      await mutateHealth(); // tableConfigured/bad phụ thuộc bảng link chuẩn — kéo lại cho khớp
      setEditing(false);
      toast({ title: t("meta.utm.saved") });
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : t("meta.utm.saveFail"));
    } finally {
      setSaving(false);
    }
  }

  async function copyTaskText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("meta.utm.copied") });
    } catch {
      toast({ title: t("meta.utm.copyFail"), variant: "error" });
    }
  }

  const rowsForCompany = effectiveCompany ? linksOfCompany(linksMeta?.links ?? [], effectiveCompany, platform) : [];
  const draftRowsForCompany = draft.map((r, i) => ({ ...r, i })).filter((r) => r.company === effectiveCompany && (r.platform ?? "facebook") === platform);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Link href="/do-luong" className="text-sm text-blue-600 hover:underline">{t("meta.utm.back")}</Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("meta.utm.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          {rich(t("meta.utm.intro"))}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.utm.dateRange")}</div>
          <DateRangeControl value={range} onChange={handleRangeChange} maxDays={MAX_RANGE_DAYS} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.utm.platform")}</div>
          <div role="tablist" aria-label={t("meta.utm.platform")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              { value: "facebook", label: "Facebook" },
              { value: "google", label: "Google Ads" },
            ] as const).map((p) => (
              <button
                key={p.value}
                role="tab"
                aria-selected={platform === p.value}
                onClick={() => setPlatform(p.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  platform === p.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.utm.company")}</div>
          <div role="tablist" aria-label={t("meta.utm.company")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(orderedCompanyIds(["MBI", "MBC"]) as Company[]).map((v) => {
              const allowed = allowedCompanies.includes(v);
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={effectiveCompany === v}
                  disabled={!allowed}
                  onClick={() => setCompany(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                    effectiveCompany === v ? "bg-blue-600 text-white" : allowed ? "text-slate-600 hover:bg-slate-50" : "cursor-not-allowed text-slate-300",
                  )}
                >
                  {v === "MBC" || v === "MBI" ? v : companyLabel(v)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {allowedCompanies.length === 0 && (
        <EmptyState icon={AlertTriangle} title={t("meta.utm.noCompany")} description={t("meta.utm.noCompanyDesc")} />
      )}

      {allowedCompanies.length > 0 && (
      <>
      {/* Bảng link chuẩn */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <span className="text-sm font-semibold text-slate-800">{t("meta.utm.tbl.title", { company: effectiveCompany ?? "", platform: platform === "facebook" ? "Facebook" : "Google Ads" })}</span>
          {canEdit && !editing && (
            <Button size="sm" variant="outline" onClick={startEdit} disabled={linksMetaLoading}>{t("meta.utm.tbl.edit")}</Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>{t("meta.utm.cancel")}</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.utm.save")}
              </Button>
            </div>
          )}
        </div>
        {saveError && <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{saveError}</div>}
        {linksMetaLoading && <div className="p-4 text-sm text-slate-400">{t("meta.utm.tbl.loading")}</div>}
        {linksMetaError && !linksMetaLoading && <div className="p-4 text-sm text-red-600">{linksMetaError instanceof ApiError ? linksMetaError.message : t("meta.utm.tbl.loadFail")}</div>}
        {!linksMetaLoading && !linksMetaError && !editing && (
          rowsForCompany.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">{t("meta.utm.tbl.none", { company: effectiveCompany ?? "", platform: platform === "facebook" ? "Facebook" : "Google Ads" })}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">{t("meta.utm.tbl.product")}</th>
                    <th className="px-3 py-2 font-medium">{t("meta.utm.tbl.stdLink")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsForCompany.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">{l.label}</td>
                      <td className="px-3 py-2.5"><code className="break-all text-xs text-slate-600">{l.url}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {editing && (
          <div className="space-y-2 p-4">
            {draftRowsForCompany.length === 0 && <div className="text-sm text-slate-400">{t("meta.utm.tbl.emptyDraft")}</div>}
            {draftRowsForCompany.map((r) => (
              <div key={r.i} className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-48"
                  placeholder={t("meta.utm.tbl.productPh")}
                  value={r.label}
                  onChange={(e) => patchRow(r.i, { label: e.target.value })}
                />
                <Input
                  className="min-w-[320px] flex-1 font-mono text-xs"
                  placeholder={`https://matbao.in/...?utm_source=${rule.source}&utm_medium=${rule.media[0]}&utm_campaign=...`}
                  value={r.url}
                  onChange={(e) => patchRow(r.i, { url: e.target.value })}
                />
                <Button size="icon-sm" variant="ghost" aria-label={t("meta.utm.tbl.removeRow")} onClick={() => removeRow(r.i)}>
                  <Trash2 className="h-4 w-4 text-red-500" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("meta.utm.tbl.addRow")}</Button>
          </div>
        )}
      </div>

      {/* Gợi ý bổ sung bảng link chuẩn (Đợt 9 · 3) */}
      {effectiveCompany && (
        <LinkSuggestSection
          company={effectiveCompany}
          platform={platform}
          canEdit={canEdit}
          existingLinks={linksMeta?.links ?? []}
          onSaved={(json) => { mutateLinksMeta(json, { revalidate: false }); mutateHealth(); }}
        />
      )}

      {/* Quy tắc kiểm */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-slate-800">{t("meta.utm.rules.title", { platform: platform === "facebook" ? "Facebook" : "Google Ads" })}</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{rich(t("meta.utm.rules.source", { value: rule.source }))}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{rich(t("meta.utm.rules.medium", { value: rule.media.join(t("meta.utm.rules.or")) }))}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{rich(t("meta.utm.rules.campaign"))}</span>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {platform === "facebook" ? (
          <span>{rich(t("meta.utm.why.fb"))}</span>
        ) : (
          <span>{rich(t("meta.utm.why.google"))}</span>
        )}
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{rich(t("meta.utm.shared"))}</span>
      </div>

      {healthLoading && <div className="h-64 animate-pulse rounded-xl bg-slate-100" />}

      {!healthLoading && healthError && (
        <EmptyState
          icon={AlertTriangle}
          title={healthError instanceof ApiError ? healthError.message : t("meta.utm.healthFail")}
          description={t("meta.measure.td.staleNote")}
          action={<Button className="h-10" onClick={() => mutateHealth()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("meta.measure.td.retry")}</Button>}
        />
      )}

      {!healthLoading && !healthError && fbHealth && (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            {t("meta.utm.fb.info", { a: num(fbHealth.links.onPlatform, undefined, intl), b: num(fbHealth.links.postRead, undefined, intl) })}
          </div>
          {fbHealth.links.postUnreadable > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {t("meta.utm.fb.unreadable", { n: num(fbHealth.links.postUnreadable, undefined, intl), pages: fbHealth.links.postNoToken.map((p) => p.pageId).join(", ") })}{" "}
                <Link href="/settings#ket-noi" className="font-medium underline underline-offset-2">{t("meta.measure.fh.lk.addToken")}</Link>
              </span>
            </div>
          )}
          {fbHealth.links.postTokenErrors.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {t("meta.measure.fh.lk.tokenExpired", { pages: fbHealth.links.postTokenErrors.map((p) => p.name ?? p.pageId).join(", ") })}{" "}
                <Link href="/settings#ket-noi" className="font-medium underline underline-offset-2">{t("meta.measure.fh.lk.addToken")}</Link>
              </span>
            </div>
          )}

          {!fbHealth.links.tableConfigured ? (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
                {t("meta.utm.noTable.title", { company: effectiveCompany ?? "" })}
              </div>
              <p className="px-4 pt-3 text-sm text-slate-500">
                {t("meta.utm.noTable.desc")}
              </p>
              {fbHealth.links.observed.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">{t("meta.utm.noTable.none")}</div>
              ) : (
                <div className="overflow-x-auto p-4 pt-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                        <th className="py-2 font-medium">utm_source</th>
                        <th className="py-2 font-medium">utm_medium</th>
                        <th className="py-2 font-medium">utm_campaign</th>
                        <th className="py-2 text-right font-medium">{t("meta.utm.noTable.ads")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fbHealth.links.observed.map((o, i) => (
                        <tr key={i} className="border-b border-slate-50 last:border-0">
                          <td className="py-2"><code className="text-xs">{o.source ?? t("meta.utm.noTable.empty")}</code></td>
                          <td className="py-2"><code className="text-xs">{o.medium ?? t("meta.utm.noTable.empty")}</code></td>
                          <td className="py-2"><code className="text-xs">{o.campaign ?? t("meta.utm.noTable.empty")}</code></td>
                          <td className="py-2 text-right tabular-nums">{num(o.count, undefined, intl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : fbHealth.links.bad.length === 0 ? (
            <EmptyState title={t("meta.utm.allOk.title")} description={t("meta.utm.allOk.desc", { company: effectiveCompany ?? "" })} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
                {t("meta.utm.bad.title", { n: num(fbHealth.links.bad.length, undefined, intl) })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">{t("meta.utm.bad.ad")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("meta.utm.bad.spend", { range: rangeLabel })}</th>
                      <th className="px-3 py-2 font-medium">{t("meta.utm.bad.current")}</th>
                      <th className="px-3 py-2 font-medium">{t("meta.utm.bad.error")}</th>
                      <th className="px-3 py-2 font-medium">{t("meta.utm.bad.suggested")}</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fbHealth.links.bad.map((row) => {
                      const taskText = [
                        t("meta.utm.bad.task1", { ad: row.adName, campaign: row.campaignName }),
                        t("meta.utm.bad.task2", { link: row.link ?? t("meta.utm.bad.unreadableLink") }),
                        row.check.suggestion
                          ? t("meta.utm.bad.task3", { url: row.check.suggestion.url })
                          : t("meta.utm.bad.task3none"),
                      ].join("\n");
                      return (
                        <tr key={row.adId} className="border-b border-slate-50 last:border-0 align-top">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-800">{row.adName}</div>
                            <div className="text-xs text-slate-400">{row.campaignName}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{vnd(row.cost, intl)}</td>
                          <td className="px-3 py-2.5"><code className="block max-w-[220px] break-all text-xs text-slate-600">{row.link ?? "—"}</code></td>
                          <td className="px-3 py-2.5">
                            <div className="flex max-w-[220px] flex-col gap-1">
                              {row.check.problems.map((p) => {
                                const copy = PROBLEM_COPY[p];
                                return <Pill key={p} tone={copy.tone}>{t(copy.text)}</Pill>;
                              })}
                              {row.check.detail && <div className="text-xs text-slate-500">{row.check.detail}</div>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {row.check.suggestion ? (
                              <div className="flex max-w-[220px] flex-wrap items-center gap-1.5">
                                <code className="break-all rounded bg-slate-50 px-1.5 py-1 text-[11px] text-slate-600">{row.check.suggestion.url}</code>
                                <Button size="icon-sm" variant="ghost" aria-label={t("meta.utm.bad.copyStd")} onClick={() => copyTaskText(row.check.suggestion!.url)}>
                                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">{t("meta.utm.bad.noStd")}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Button size="sm" variant="outline" onClick={() => copyTaskText(taskText)}>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t("meta.utm.bad.copyTask")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!healthLoading && !healthError && googleHealthData && (
        <>
          {!googleHealthData.utm.tableConfigured ? (
            <EmptyState
              title={t("meta.utm.g.noTable", { company: effectiveCompany ?? "" })}
              description={t("meta.utm.g.noTableDesc")}
            />
          ) : googleRows.length === 0 ? (
            <EmptyState title={t("meta.utm.g.allOk")} description={t("meta.utm.g.allOkDesc", { company: effectiveCompany ?? "" })} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
                {t("meta.utm.g.count", { n: num(googleRows.length, undefined, intl) })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">{t("meta.utm.g.campaign")}</th>
                      <th className="px-3 py-2 font-medium">URL</th>
                      <th className="px-3 py-2 font-medium">{t("meta.utm.bad.error")}</th>
                      <th className="px-3 py-2 font-medium">{t("meta.utm.bad.suggested")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleRows.map((row) => (
                      <tr key={row.key} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.campaignName}</td>
                        <td className="px-3 py-2.5"><code className="block max-w-[260px] break-all font-mono text-xs text-slate-600">{row.url}</code></td>
                        <td className="px-3 py-2.5">
                          <div className="flex max-w-[220px] flex-col gap-1">
                            {row.check.problems.map((p) => {
                              const copy = PROBLEM_COPY[p];
                              return <Pill key={p} tone={copy.tone}>{t(copy.text)}</Pill>;
                            })}
                            {row.check.detail && <div className="text-xs text-slate-500">{row.check.detail}</div>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {row.check.suggestion ? (
                            <div className="flex max-w-[220px] flex-wrap items-center gap-1.5">
                              <code className="break-all rounded bg-slate-50 px-1.5 py-1 text-[11px] text-slate-600">{row.check.suggestion.url}</code>
                              <Button size="icon-sm" variant="ghost" aria-label={t("meta.utm.bad.copyStd")} onClick={() => copyTaskText(row.check.suggestion!.url)}>
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{t("meta.utm.bad.noStd")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}

// ============================================================
// Gợi ý bổ sung bảng link chuẩn (Đợt 9 · 3) — lấy từ link quảng cáo ĐANG CHẠY
// chưa có trong bảng, người duyệt rồi bấm mới ghi (KHÔNG tự động thêm).
// ============================================================
interface SuggestResponse { success: true; suggestions: LinkSuggestion[]; observed: number }
type SuggestDraft = { selected: boolean; label: string; url: string };

function LinkSuggestSection({
  company,
  platform,
  canEdit,
  existingLinks,
  onSaved,
}: {
  company: Company;
  platform: Platform;
  canEdit: boolean;
  existingLinks: StandardLink[];
  onSaved: (json: LinksResponse) => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const { toast } = useToast();
  const url = `/api/measure/utm-links/suggest?company=${company}&platform=${platform}`;
  const { data, error, isLoading, mutate } = useSWR<SuggestResponse>(url, getJson);
  const [draft, setDraft] = useState<Record<string, SuggestDraft>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Object.fromEntries((data?.suggestions ?? []).map((s) => [s.key, { selected: false, label: s.label, url: s.url }])));
    setAddError(null);
  }, [data]);

  const suggestions = data?.suggestions ?? [];
  const chosen = suggestions.filter((s) => draft[s.key]?.selected);

  async function addSelected() {
    if (!chosen.length) return;
    setAdding(true);
    setAddError(null);
    try {
      const newRows: StandardLink[] = chosen.map((s) => ({ company, platform, label: (draft[s.key]?.label ?? s.label).trim(), url: (draft[s.key]?.url ?? s.url).trim() }));
      const json = await putJson("/api/measure/utm-links", { links: [...existingLinks, ...newRows] });
      onSaved(json);
      await mutate();
      toast({ title: t("meta.utm.sg.added", { n: newRows.length }) });
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : t("meta.utm.sg.addFail"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="text-sm font-semibold text-slate-800">
          {t("meta.utm.sg.title", { company, platform: platform === "facebook" ? "Facebook" : "Google Ads" })}
        </span>
        {canEdit && chosen.length > 0 && (
          <Button size="sm" onClick={addSelected} disabled={adding}>
            {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.utm.sg.add", { n: chosen.length })}
          </Button>
        )}
      </div>
      <p className="px-4 pt-3 text-sm text-slate-500">
        {rich(t("meta.utm.sg.intro"))}
      </p>
      {addError && <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</div>}
      {isLoading && <div className="p-4 text-sm text-slate-400">{t("meta.utm.tbl.loading")}</div>}
      {!isLoading && error && <div className="p-4 text-sm text-red-600">{error instanceof ApiError ? error.message : t("meta.utm.sg.loadFail")}</div>}
      {!isLoading && !error && suggestions.length === 0 && (
        <div className="p-4 text-sm text-slate-400">{t("meta.utm.sg.allIn")}</div>
      )}
      {!isLoading && !error && suggestions.length > 0 && (
        <div className="space-y-3 p-4">
          {suggestions.map((s) => {
            const d = draft[s.key] ?? { selected: false, label: s.label, url: s.url };
            return (
              <div key={s.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-100 p-3">
                <input
                  type="checkbox"
                  className="mt-2.5 h-4 w-4 shrink-0"
                  checked={d.selected}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((cur) => ({ ...cur, [s.key]: { ...d, selected: e.target.checked } }))}
                  aria-label={t("meta.utm.sg.choose", { label: s.label })}
                />
                <div className="min-w-[240px] flex-1 space-y-1.5">
                  <Input
                    className="max-w-xs"
                    value={d.label}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((cur) => ({ ...cur, [s.key]: { ...d, label: e.target.value } }))}
                  />
                  <Input
                    className="font-mono text-xs"
                    value={d.url}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((cur) => ({ ...cur, [s.key]: { ...d, url: e.target.value } }))}
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="grey">{t("meta.utm.sg.adsCost", { n: num(s.ads, undefined, intl), cost: vnd(s.cost, intl) })}</Pill>
                    {s.campaignProposedByTool && <Pill tone="amber">{t("meta.utm.sg.proposed")}</Pill>}
                  </div>
                  {s.variants.length > 0 && (
                    <div className="text-xs text-slate-500">
                      {t("meta.utm.sg.current", { list: s.variants.map((v) => `${v.source ?? t("meta.utm.noTable.empty")}/${v.medium ?? t("meta.utm.noTable.empty")} ×${v.count}`).join(", ") })}
                    </div>
                  )}
                  {s.campaigns.length > 0 && (
                    <div className="truncate text-xs text-slate-400" title={s.campaigns.join(", ")}>
                      {s.campaigns.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!canEdit && suggestions.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{t("meta.utm.sg.needEdit")}</div>
      )}
    </div>
  );
}
