"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ToastMessage } from "@/components/Toast";
import { SeverityBadge, PolicyPlatformBadge, OfficialSourceBadge } from "./badges";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { PolicyReviewStatus, PolicyRadarItem } from "@/lib/policy-radar/types";

const STATUS_OPTIONS: PolicyReviewStatus[] = ["unread", "reviewed", "flagged_for_followup", "archived"];

interface PolicyDetailPanelProps {
  item: PolicyRadarItem;
  canManage: boolean;
  onUpdated: (item: PolicyRadarItem) => void;
  onToast: (msg: Omit<ToastMessage, "id">) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function PolicyDetailPanel({ item, canManage, onUpdated, onToast, onPrev, onNext, hasPrev, hasNext }: PolicyDetailPanelProps) {
  const t = useT();
  const intl = useIntlLocale();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote(item.internalNote ?? "");
  }, [item.id, item.internalNote]);

  const save = async (status: PolicyReviewStatus, opts: { silent?: boolean } = {}) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/policy-radar/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, internalNote: note }),
      });
      const json = await res.json();
      if (json.success) {
        onUpdated(json.data);
        if (!opts.silent) onToast({ title: t("meta.policy.detail.updated") });
        else onToast({ title: t("meta.policy.detail.noteSaved") });
      } else {
        onToast({ title: `❌ ${json.error}`, variant: "error" });
      }
    } catch {
      onToast({ title: t("meta.policy.apiError"), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PolicyPlatformBadge platform={item.platform} />
            <SeverityBadge severity={item.severity} />
            <span className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
              {t(`meta.policy.cat.${item.category}`)} · {t(`meta.policy.change.${item.changeType}`)}
            </span>
            {item.official && item.verifiedFromSource && <OfficialSourceBadge />}
          </div>
          {(onPrev || onNext) && (
            <div className="flex shrink-0 gap-1">
              <Button variant="outline" size="icon-sm" disabled={!hasPrev} onClick={onPrev} title={t("meta.policy.detail.prev")}>
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={!hasNext} onClick={onNext} title={t("meta.policy.detail.next")}>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <h2 className="text-base font-semibold text-slate-900">{item.title}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {!item.verifiedFromSource && (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {t("meta.policy.detail.unverifiedBox")}
          </div>
        )}

        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          {t("meta.policy.detail.aiNotice")}
        </p>

        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t("meta.policy.detail.summary")}</h4>
          <p className="text-sm text-slate-700">{item.summaryShort}</p>
        </section>

        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t("meta.policy.detail.why")}</h4>
          <p className="text-sm text-slate-700">{item.whyItMatters}</p>
        </section>

        {/* Việc rút từ chính bài viết — tách khỏi khối "theo nhóm ảnh hưởng" bên
            dưới để người đọc luôn biết câu nào do AI đọc bài mà ra, câu nào là
            câu mẫu cố định theo luật (lib/policy-radar/action-mapper.ts). */}
        {(item.aiSuggestedActions?.length ?? 0) > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
              {t("meta.policy.detail.aiActions")}
            </h4>
            <ul className="space-y-1.5">
              {item.aiSuggestedActions!.map((action) => (
                <li key={action} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {action}
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.recommendedActions.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.areaActions")}</h4>
            <ul className="space-y-1.5">
              {item.recommendedActions.map((action) => (
                <li key={action} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                  {action}
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.affectedAreas.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.areas")}</h4>
            <div className="flex flex-wrap gap-1.5">
              {item.affectedAreas.map((area) => (
                <span key={area} className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                  {t(`meta.policy.area.${area}`)}
                </span>
              ))}
            </div>
          </section>
        )}

        {item.affectedModules.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.modules")}</h4>
            <div className="flex flex-wrap gap-1.5">
              {item.affectedModules.map((mod) => (
                <a key={mod} href={mod} className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 hover:bg-blue-100">
                  {mod}
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.source")}</h4>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            {item.sourceLabel} <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-xs text-slate-400 mt-1">
            {item.publishedAt
              ? t("meta.policy.detail.updatedAt", { date: new Date(item.publishedAt).toLocaleDateString(intl) })
              : t("meta.policy.detail.noUpdateDate")}
          </p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.reviewStatus")}</h4>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={item.status === status ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => save(status)}
                >
                  {saving && item.status !== status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t(`meta.policy.status.${status}`)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              {t("meta.policy.detail.currentStatus", { status: t(`meta.policy.status.${item.status}`) })}
            </p>
          )}
          {item.reviewedBy && (
            <p className="text-xs text-slate-400 mt-2">
              {t("meta.policy.detail.lastReviewed", { user: item.reviewedBy, time: item.reviewedAt ? new Date(item.reviewedAt).toLocaleString(intl) : "" })}
            </p>
          )}
        </section>

        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t("meta.policy.detail.internalNote")}</h4>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("meta.policy.detail.notePlaceholder")}
            disabled={!canManage}
            className="mb-2"
          />
          {canManage && (
            <Button size="sm" variant="outline" disabled={saving} onClick={() => save(item.status, { silent: true })}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("meta.policy.detail.saveNote")}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
