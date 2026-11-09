// ============================================================
// Chẩn đoán gắn thẻ (Đợt 4 · bổ sung) — nội dung tab thứ 3 của "Sức khoẻ đo
// lường". Tự fetch/tự quản loading-error-empty vì API + hình dạng dữ liệu
// khác hẳn health (facebook/google): có ackIfAlone/confirmText/history và
// một luồng ghi thật lên Google (xem TagDoctorFixPanel).
// ------------------------------------------------------------
// QUAN TRỌNG: đây là client component. lib/measure/tag-doctor.ts và
// lib/measure/google-goal-fix.ts kéo theo fs / google-ads-api / odoo-client /
// meta-client ở đầu file — CHỈ được `import type` từ hai module đó, không
// bao giờ import giá trị (hằng số, hàm). Hằng số cần cho UI (vd confirmText)
// lấy thẳng từ payload API trả về, không import từ lib.
// ============================================================
"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, Check, Copy, Info, Loader2, RefreshCw, Stethoscope, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { SourceTable } from "@/components/measure/SourceTable";
import { datetimeVN, num } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/components/SessionProvider";
import { ExecutionCard, TagDoctorFixPanel } from "@/components/measure/TagDoctorFixPanel";
import { GtmFixPanel, type GtmMeta } from "@/components/measure/GtmFixPanel";
import { rangeDays } from "@/lib/case/dates";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";
import type { DateRangeValue } from "@/components/DateRangeControl";
import type { Company } from "@/lib/case/types";
import type { CanonicalRow, RoadmapStep, TagDoctorReport, TagIssue } from "@/lib/measure/tag-doctor";
import type { GoalFixExecution } from "@/lib/measure/google-goal-fix";
import type { GtmContainer, GtmPixelTag } from "@/lib/measure/gtm";

/** Hình dạng đúng của GET /api/measure/tags — xem app/api/measure/tags/route.ts (KHÔNG sửa nghiệp vụ route,
 *  chỉ đọc để khớp kiểu). Route trả `gtmFix` (không phải `gtm`) cho khối cấu hình sửa GTM — `gtm` đã là
 *  mảng GtmContainer[] của TagDoctorReport (mục 2 "Thẻ Facebook Pixel trong GTM"); đặt trùng tên sẽ bị
 *  object literal phía route ghi đè mất mảng đó (đã sửa ở route.ts, xem chú thích tại đó). */
export interface TagDoctorApiResponse extends TagDoctorReport {
  success: true;
  ackIfAlone: Record<string, boolean>;
  confirmText: string;
  history: GoalFixExecution[];
  gtmFix: GtmMeta;
}

const VERDICT_STYLE: Record<CanonicalRow["verdict"]["tone"], { tone: PillTone; symbol: string }> = {
  ok: { tone: "green", symbol: "✓" },
  warn: { tone: "amber", symbol: "⚠" },
  bad: { tone: "red", symbol: "✕" },
};

const ROADMAP_STYLE: Record<RoadmapStep["status"], { tone: PillTone; symbol: string }> = {
  done: { tone: "green", symbol: "✓" },
  todo: { tone: "amber", symbol: "➜" },
  waiting: { tone: "grey", symbol: "◌" },
};

const bold = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

const SEVERITY_STYLE: Record<TagIssue["severity"], { tone: PillTone; text: MessageKey }> = {
  bad: { tone: "red", text: "meta.measure.td.sev.bad" },
  warn: { tone: "amber", text: "meta.measure.td.sev.warn" },
};

const PLATFORM_CHIP: Record<TagIssue["platform"], string> = { meta: "Meta", google: "Google", gtm: "GTM" };

/** Thông điệp thân thiện khi Meta/Google chặn vì vượt hạn mức gọi API (#613…) — cùng luật với app/(dashboard)/do-luong/page.tsx. */
function quotaHint(message: string, t: TFunction): string | null {
  return /hạn mức|quota|rate limit|#613/i.test(message) ? t("meta.measure.td.quota") : null;
}

function gtmBadge(inGtm: boolean | null, t: TFunction): { tone: PillTone; text: string } {
  if (inGtm === true) return { tone: "green", text: t("meta.measure.td.gtm.yes") };
  if (inGtm === false) return { tone: "red", text: t("meta.measure.td.gtm.no") };
  return { tone: "grey", text: t("meta.measure.td.gtm.unknown") };
}

export function TagDoctorView({ company, range }: { company: Company; range: DateRangeValue }) {
  const intl = useIntlLocale();
  const t = useT();
  const { user } = useSession();
  const canEdit = !!user && hasPermission(user.role, "can_edit");

  const url = `/api/measure/tags?company=${company}&from=${range.from}&to=${range.to}`;
  const { data, error, isLoading, mutate } = useSWR<TagDoctorApiResponse>(url, getJson);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[] | null>(null);
  const [gtmHighlightIds, setGtmHighlightIds] = useState<string[] | null>(null);

  async function reload(force = false) {
    if (!force) {
      await mutate();
      return;
    }
    setPulling(true);
    try {
      const json = await getJson(`${url}&force=1`);
      setPullError(null);
      await mutate(json, { revalidate: false });
    } catch (e) {
      setPullError(e instanceof ApiError ? e.message : t("meta.measure.td.pullFail"));
    } finally {
      setPulling(false);
    }
  }

  function openFixFlow(ids: string[]) {
    setHighlightIds(ids);
    const el = document.getElementById(ids[0] ? `fix-row-${ids[0]}` : "fix-panel") ?? document.getElementById("fix-panel");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightIds(null), 4000);
  }

  function openGtmFixFlow(ids: string[]) {
    setGtmHighlightIds(ids);
    const el = document.getElementById(ids[0] ? `gtm-fix-row-${ids[0]}` : "gtm-fix-panel") ?? document.getElementById("gtm-fix-panel");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setGtmHighlightIds(null), 4000);
  }

  const errorMessage = pullError ?? (error instanceof ApiError ? error.message : error ? t("meta.measure.td.loadFail") : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Stethoscope className="h-4.5 w-4.5 text-blue-600" aria-hidden="true" /> {t("meta.measure.td.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {t("meta.measure.td.subtitle")}
          </p>
        </div>
        <Button className="h-10" variant="outline" size="sm" onClick={() => reload(true)} disabled={pulling}>
          {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("meta.measure.td.refresh")}
        </Button>
      </div>

      {isLoading && <TagDoctorSkeleton />}

      {!isLoading && errorMessage && (
        <EmptyState
          icon={AlertTriangle}
          title={errorMessage}
          description={quotaHint(errorMessage, t) ?? t("meta.measure.td.staleNote")}
          action={<Button className="h-10" onClick={() => reload(true)} disabled={pulling}>{pulling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} {t("meta.measure.td.retry")}</Button>}
        />
      )}

      {!isLoading && !errorMessage && data && (
        <>
          {!data.current && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("meta.measure.td.pastRange")}</span>
            </div>
          )}

          {data.roadmap.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.roadmap.title")}</h3>
              <p className="mb-3 text-sm text-slate-500">
                {t("meta.measure.td.roadmap.desc")}
              </p>
              <ol className="space-y-2">
                {data.roadmap.map((step, i) => <RoadmapStepCard key={step.id} index={i + 1} step={step} />)}
              </ol>
            </section>
          )}

          <SourceTable sources={data.sources} />

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s1.title")}</h3>
            <p className="mb-3 text-sm text-slate-500">
              {bold(t("meta.measure.td.s1.desc"))}
            </p>
            <CanonicalTable rows={data.canonical} company={company} days={rangeDays(data.range)} />
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s2.title")}</h3>
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {t("meta.measure.td.s2.note")}
            </div>
            {data.gtm.length === 0 ? (
              <EmptyState compact title={t("meta.measure.td.s2.emptyTitle")} description={t("meta.measure.td.s2.emptyDesc")} />
            ) : (
              <div className="space-y-4">
                {data.gtm.map((g) => <GtmContainerTable key={g.id} container={g} />)}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s3.title")}</h3>
            {data.issues.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <Pill tone="green">{t("meta.measure.td.s3.none")}</Pill>
              </div>
            ) : (
              <div className="space-y-3">
                {data.issues.map((issue) => <IssueCard key={issue.id} issue={issue} onFix={openFixFlow} onFixGtm={openGtmFixFlow} />)}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s4.title")}</h3>
            {data.dualSource.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">{t("meta.measure.td.s4.none")}</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">{t("meta.measure.td.s4.event")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("meta.measure.td.s4.browser")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("meta.measure.td.s4.server")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dualSource.map((d, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-800"><code className="text-xs">{d.event}</code></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{num(d.browser, undefined, intl)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{num(d.server, undefined, intl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section id="fix-panel">
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s5.title")}</h3>
            {data.fixes.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <Pill tone="green">{t("meta.measure.td.s5.none")}</Pill>
              </div>
            ) : (
              <TagDoctorFixPanel
                company={company}
                fixes={data.fixes}
                ackIfAlone={data.ackIfAlone}
                confirmText={data.confirmText}
                canEdit={canEdit}
                highlightIds={highlightIds}
                onChanged={reload}
              />
            )}
          </section>

          <section id="gtm-fix-panel">
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s6.title")}</h3>
            <GtmFixPanel
              company={company}
              gtmFixes={data.gtmFixes}
              gtm={data.gtmFix}
              canEdit={canEdit}
              highlightIds={gtmHighlightIds}
              onChanged={reload}
            />
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">{t("meta.measure.td.s7.title")}</h3>
            <TagDoctorHistory history={data.history} company={company} canEdit={canEdit} onChanged={reload} />
          </section>
        </>
      )}
    </div>
  );
}

function RoadmapStepCard({ index, step }: { index: number; step: RoadmapStep }) {
  const t = useT();
  const s = ROADMAP_STYLE[step.status];
  const isTodo = step.status === "todo";
  return (
    <li
      className={cn(
        "rounded-xl border p-3.5 text-sm",
        isTodo ? "border-amber-300 bg-amber-50" : step.status === "done" ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            step.status === "done" ? "bg-emerald-100 text-emerald-700" : isTodo ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400",
          )}
        >
          {index}
        </span>
        <Pill tone={s.tone}>{s.symbol} {step.label}</Pill>
      </div>
      <p className="mt-1.5 pl-8 text-xs text-slate-500">{step.evidence}</p>
      {isTodo && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
          <span className="text-sm font-medium text-amber-800">{step.action}</span>
          <Link href={step.href}>
            <Button className="h-8" size="sm">{t("meta.measure.td.roadmap.go")}</Button>
          </Link>
        </div>
      )}
    </li>
  );
}

function CanonicalTable({ rows, company, days }: { rows: CanonicalRow[]; company: Company; days: number }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="px-4 py-2 font-medium">{t("meta.measure.td.ct.action")}</th>
            <th className="px-3 py-2 font-medium">Meta</th>
            <th className="px-3 py-2 font-medium">Google Ads</th>
            <th className="px-3 py-2 font-medium">{t("meta.measure.td.ct.odoo")}</th>
            <th className="px-3 py-2 font-medium">{t("meta.measure.td.ct.verdict")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const v = VERDICT_STYLE[row.verdict.tone];
            const odooText = row.key !== "purchase" ? "—" : row.odooOrders !== null ? t("meta.measure.td.ct.orders", { n: num(row.odooOrders, undefined, intl) }) : company === "MBC" ? t("meta.measure.td.ct.noFilter") : "—";
            return (
              <tr key={row.key} className="border-b border-slate-50 last:border-0 align-top">
                <td className="px-4 py-2.5 font-semibold whitespace-nowrap text-slate-800">{row.label}</td>
                <td className="px-3 py-2.5">
                  {row.meta.length === 0 ? (
                    <span className="text-slate-400">{t("meta.measure.td.ct.notUsed")}</span>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.meta.map((m) => (
                        <div key={m.name}>
                          <code className="text-xs">{m.name}</code>{" "}
                          <Pill tone={m.standard ? "grey" : "amber"} className="ml-1">{m.standard ? t("meta.measure.td.ct.standard") : t("meta.measure.td.ct.custom")}</Pill>
                          <div className="mt-0.5 text-xs text-slate-400 tabular-nums">{t("meta.measure.td.ct.days", { days, total: num(m.total, undefined, intl), last7: num(m.last7, undefined, intl) })}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {row.google.length === 0 ? (
                    <span className="text-slate-400">{t("meta.measure.td.ct.noGoogle")}</span>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.google.map((g, i) => {
                        const badge = gtmBadge(g.inGtm, t);
                        return (
                          <div key={i}>
                            <code className="text-xs">{g.name}</code>{" "}
                            <span className={cn("ml-1 text-xs font-semibold", g.primary ? "text-slate-800" : "text-slate-500 font-normal")}>{g.primary ? t("meta.measure.td.ct.primary") : t("meta.measure.td.ct.secondary")}</span>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 tabular-nums">
                              <span>{t("meta.measure.td.ct.perDays", { total: num(g.total, { maximumFractionDigits: 1 }, intl), days, last7: num(g.last7, { maximumFractionDigits: 1 }, intl) })}</span>
                              <Pill tone={badge.tone}>{t("meta.measure.td.ct.gtm", { value: badge.text })}</Pill>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-slate-700">{odooText}</td>
                <td className="px-3 py-2.5 min-w-[220px]">
                  <Pill tone={v.tone} className="whitespace-normal text-left">{v.symbol} {row.verdict.text}</Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GtmContainerTable({ container }: { container: GtmContainer }) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
        {t("meta.measure.td.gt.version", { id: container.id, version: container.version ?? "?" })}
      </div>
      {container.pixelTags.length === 0 ? (
        <div className="p-4 text-sm text-slate-400">{t("meta.measure.td.gt.noTags")}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">{t("meta.measure.td.gt.tag")}</th>
              <th className="px-3 py-2 font-medium">{t("meta.measure.td.gt.kind")}</th>
              <th className="px-3 py-2 font-medium">{t("meta.measure.td.gt.event")}</th>
              <th className="px-3 py-2 font-medium">event_id</th>
              <th className="px-3 py-2 font-medium">{t("meta.measure.td.gt.source")}</th>
            </tr>
          </thead>
          <tbody>
            {container.pixelTags.map((tag: GtmPixelTag, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-slate-800">{tag.tagId}</td>
                <td className="px-3 py-2.5 text-slate-600">{tag.kind === "standard" ? "Standard" : "Custom"}</td>
                <td className="px-3 py-2.5">{tag.dynamic ? <span className="text-slate-400 italic">{t("meta.measure.td.gt.dynamic")}</span> : <code className="text-xs">{tag.eventName}</code>}</td>
                <td className="px-3 py-2.5">{tag.hasEventId ? <Pill tone="green">✓</Pill> : <Pill tone="red">✕</Pill>}</td>
                <td className="px-3 py-2.5 text-slate-600">{tag.source === "template" ? t("meta.measure.td.gt.template") : "HTML"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function IssueCard({ issue, onFix, onFixGtm }: { issue: TagIssue; onFix: (ids: string[]) => void; onFixGtm: (ids: string[]) => void }) {
  const t = useT();
  const sev = SEVERITY_STYLE[issue.severity];
  const isWebTeamNote = issue.id.startsWith("gtm_dl_silent_");
  return (
    <div className={cn("rounded-xl border p-3.5 text-sm", issue.severity === "bad" ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={sev.tone}>{t(sev.text)}</Pill>
        <Pill tone="blue">{PLATFORM_CHIP[issue.platform]}</Pill>
        <span className="font-semibold text-slate-800">{issue.title}</span>
      </div>
      <p className="mt-2 text-slate-600">{issue.detail}</p>
      {issue.steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700" style={{ listStyle: "decimal" }}>
          {issue.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {(issue.fixIds.length > 0 || (issue.gtmFixIds && issue.gtmFixIds.length > 0) || isWebTeamNote) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {issue.fixIds.length > 0 && (
            <Button className="h-10" size="sm" onClick={() => onFix(issue.fixIds)}>{t("meta.measure.td.issue.fixGoogle")}</Button>
          )}
          {issue.gtmFixIds && issue.gtmFixIds.length > 0 && (
            <Button className="h-10" size="sm" onClick={() => onFixGtm(issue.gtmFixIds!)}>{t("meta.measure.td.issue.fixGtm")}</Button>
          )}
          {isWebTeamNote && <CopyWebTeamStepsButton issue={issue} />}
        </div>
      )}
    </div>
  );
}

/** Lỗi `gtm_dl_silent_*` là việc của đội web (trang không đẩy sự kiện dataLayer) — tool không tự
 *  sửa được, chỉ đưa dặn việc để dán sang kênh trao đổi với đội web. */
function CopyWebTeamStepsButton({ issue }: { issue: TagIssue }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = [issue.title, issue.detail, ...issue.steps.map((s, i) => `${i + 1}. ${s}`)].join("\n");
  return (
    <Button
      className="h-10"
      variant="outline"
      size="sm"
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? t("meta.measure.td.copy.done") : t("meta.measure.td.copy.btn")}
    </Button>
  );
}

// Lịch sử dùng chung khối hiển thị readback với TagDoctorFixPanel (component
// con export cả ExecutionCard) — xem import gộp ở đầu file.
function TagDoctorHistory({ history, company, canEdit, onChanged }: { history: GoalFixExecution[]; company: Company; canEdit: boolean; onChanged: (force?: boolean) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const [undoTarget, setUndoTarget] = useState<GoalFixExecution | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runUndo() {
    if (!undoTarget) return;
    setUndoing(true);
    setErr(null);
    try {
      await postJson("/api/measure/google-fix/undo", { company, id: undoTarget.id });
      setUndoTarget(null);
      await onChanged(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("meta.measure.td.hist.undoFail"));
    } finally {
      setUndoing(false);
    }
  }

  if (history.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">{t("meta.measure.td.hist.none")}</div>;
  }

  return (
    <div className="space-y-3">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {history.map((ex) => (
        <div key={ex.id} className="space-y-2">
          <ExecutionCard exec={ex} title={ex.status === "done" ? t("meta.measure.td.hist.done", { by: ex.by }) : t("meta.measure.td.hist.failed", { by: ex.by })} />
          {ex.changes.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t("meta.measure.td.hist.changes", { list: ex.changes.map((c) => c.label).join("; ") })}
            </div>
          )}
          {ex.undoneAt ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
              <div className="font-semibold">{t("meta.measure.td.hist.undoneAt", { time: datetimeVN(ex.undoneAt, intl) })}</div>
              {ex.undoReport && ex.undoReport.length > 0 && (
                <ul className="mt-1 list-disc pl-4">{ex.undoReport.map((line, i) => <li key={i}>{line}</li>)}</ul>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {!canEdit && <span className="text-xs text-slate-500">{t("meta.measure.td.hist.needEdit")}</span>}
              <Button
                className="h-10"
                variant="destructive"
                size="sm"
                onClick={() => setUndoTarget(ex)}
                disabled={!canEdit}
                title={!canEdit ? t("meta.measure.td.hist.needEdit") : undefined}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("meta.measure.td.hist.undo")}
              </Button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={!!undoTarget} onOpenChange={(o) => !o && setUndoTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("meta.measure.td.hist.dlgTitle")}</DialogTitle>
            <DialogDescription>
              {t("meta.measure.td.hist.dlgDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("meta.measure.td.hist.keep")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={runUndo} disabled={undoing}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.measure.td.hist.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TagDoctorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
