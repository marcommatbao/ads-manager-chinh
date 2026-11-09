"use client";

// ============================================================
// Sổ kinh nghiệm — "Kết quả áp dụng (chấm sau 14 / 28 ngày)" (Đợt 9 · 4 / 7c)
// ------------------------------------------------------------
// Đọc GET /api/playbook/outcomes?company= — CHỈ ĐỌC. Job playbook_outcomes
// (hằng ngày) tự chấm chiến dịch nào đã dùng kinh nghiệm (7b ghi
// data/playbook/usage.json) đủ 14/28 ngày, so với các chiến dịch cùng sản
// phẩm cùng kỳ (xem lib/playbook/outcomes.ts). Trang chỉ hiển thị lại.
//
// BUILD RULE: client component — KHÔNG import GIÁ TRỊ từ lib/playbook/*
// (kéo theo fs/google-ads-api/meta-client vào bundle trình duyệt). Chỉ
// `import type` cho kiểu OutcomeRecord.
// ============================================================

import { useState } from "react";
import { AlertCircle, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { useToast } from "@/components/Toast";
import { vnd, num, datetimeVN } from "@/components/case/format";
import { postJson, ApiError } from "@/components/case/api";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { OutcomeRecord } from "@/lib/playbook/outcomes";
import type { Company } from "@/lib/case/types";

export interface OutcomeCheckpoint {
  days: 14 | 28;
  due: string;
  status: "done" | "pending_run" | "waiting";
  record: OutcomeRecord | null;
}
export interface OutcomeUsage {
  key: string;
  at: string;
  by: string;
  platform: "facebook" | "google";
  productKey: string;
  campaignId: string;
  campaignName: string;
  entries: { id: string; label: string }[];
  overriddenAvoid: { id: string; label: string }[];
  checkpoints: OutcomeCheckpoint[];
}
/** Hình dạng đúng của GET /api/playbook/outcomes (route KHÔNG trả lại `company` — trang gọi
 *  ghép company vào lúc fetch, xem app/(dashboard)/so-kinh-nghiem/page.tsx). */
export interface OutcomesApiResponse {
  success: true;
  usages: OutcomeUsage[];
  canRunNow: boolean;
  jobId: string;
  company: Company;
}

const VERDICT_STYLE: Record<OutcomeRecord["verdict"], { tone: PillTone; text: MessageKey }> = {
  better: { tone: "green", text: "overview.playbook.outcomes.better" },
  worse: { tone: "red", text: "overview.playbook.outcomes.worse" },
  neutral: { tone: "grey", text: "overview.playbook.outcomes.neutral" },
  insufficient: { tone: "grey", text: "overview.playbook.outcomes.insufficient" },
};

const PLATFORM_BADGE: Record<OutcomeUsage["platform"], { text: MessageKey; cls: string }> = {
  facebook: { text: "overview.playbook.outcomes.platFb", cls: "bg-blue-100 text-blue-700" },
  google: { text: "overview.playbook.outcomes.platGg", cls: "bg-red-100 text-red-600" },
};

export function PlaybookOutcomesSection({
  responses,
  loading,
  error,
  onReload,
}: {
  responses: OutcomesApiResponse[];
  loading: boolean;
  error: unknown;
  onReload: () => unknown;
}) {
  const t = useT();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const usages = responses.flatMap((r) => r.usages.map((u) => ({ ...u, company: r.company })));
  const canRunNow = responses.some((r) => r.canRunNow);
  const jobId = responses.find((r) => r.jobId)?.jobId ?? "playbook_outcomes";

  async function runNow() {
    setRunning(true);
    try {
      const res = await postJson(`/api/jobs/${jobId}/trigger`);
      await onReload();
      toast({
        title: res?.success ? t("overview.playbook.outcomes.toastDone") : t("overview.playbook.outcomes.toastJobErr"),
        variant: res?.success ? "success" : "error",
      });
    } catch (e) {
      toast({ title: t("overview.playbook.outcomes.toastRunErr"), description: e instanceof ApiError ? e.message : undefined, variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">{t("overview.playbook.outcomes.title")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("overview.playbook.outcomes.desc")}
          </p>
        </div>
        {canRunNow && (
          <Button size="sm" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            {t("overview.playbook.outcomes.runNow")}
          </Button>
        )}
      </div>

      {loading && <div className="h-32 animate-pulse rounded-xl bg-slate-100" />}

      {error != null && !loading && (
        <EmptyState
          compact
          icon={AlertCircle}
          title={t("overview.playbook.outcomes.loadErrTitle")}
          description={error instanceof ApiError ? error.message : t("overview.playbook.outcomes.apiErr")}
        />
      )}

      {!loading && error == null && usages.length === 0 && (
        <EmptyState
          compact
          title={t("overview.playbook.outcomes.emptyTitle")}
          description={t("overview.playbook.outcomes.emptyDesc")}
        />
      )}

      {!loading && error == null && usages.length > 0 && (
        <div className="space-y-3">
          {usages.map((u) => <UsageCard key={u.key} usage={u} />)}
        </div>
      )}
    </div>
  );
}

function UsageCard({ usage }: { usage: OutcomeUsage & { company: Company } }) {
  const intl = useIntlLocale();
  const t = useT();
  const badge = PLATFORM_BADGE[usage.platform];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-start gap-2">
          <span className={cn("mt-0.5 inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[9px] font-bold", badge.cls)}>{t(badge.text)}</span>
          <div>
            <div className="font-semibold text-slate-900">{usage.campaignName}</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {t("overview.playbook.outcomes.createdAt", { company: usage.company, at: datetimeVN(usage.at, intl) })}{usage.by ? t("overview.playbook.outcomes.createdBy", { by: usage.by }) : ""}
            </div>
          </div>
        </div>
      </div>

      {(usage.entries.length > 0 || usage.overriddenAvoid.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
          {usage.entries.map((e) => <Pill key={e.id} tone="blue">{e.label}</Pill>)}
          {usage.overriddenAvoid.map((e) => <Pill key={e.id} tone="amber">{t("overview.playbook.outcomes.overridden", { label: e.label })}</Pill>)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {usage.checkpoints.map((cp) => <CheckpointCard key={cp.days} checkpoint={cp} />)}
      </div>
    </div>
  );
}

function CheckpointCard({ checkpoint }: { checkpoint: OutcomeCheckpoint }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-1.5 text-xs font-semibold text-slate-500">{t("overview.playbook.outcomes.checkpoint", { days: checkpoint.days })}</div>
      {checkpoint.status === "waiting" && (
        <div className="text-sm text-slate-400">{t("overview.playbook.outcomes.waitUntil", { due: checkpoint.due })}</div>
      )}
      {checkpoint.status === "pending_run" && (
        <div className="text-sm text-slate-500">{t("overview.playbook.outcomes.pendingRun")}</div>
      )}
      {checkpoint.status === "done" && checkpoint.record && (
        <RecordDetail record={checkpoint.record} />
      )}
    </div>
  );
}

function RecordDetail({ record }: { record: OutcomeRecord }) {
  const intl = useIntlLocale();
  const t = useT();
  const v = VERDICT_STYLE[record.verdict];
  return (
    <div className="space-y-1.5">
      <Pill tone={v.tone}>{t(v.text)}</Pill>
      <p className="text-xs text-slate-600">{record.why}</p>
      {record.cpr !== null && record.peerMedian !== null && (
        <div className="text-xs tabular-nums text-slate-500">{t("overview.playbook.outcomes.cprVsMedian", { cpr: vnd(record.cpr, intl), median: vnd(record.peerMedian, intl) })}</div>
      )}
      {record.odoo && (
        "orders" in record.odoo ? (
          <div className="text-xs tabular-nums text-slate-500">
            {t("overview.playbook.outcomes.odooOrders", { n: num(record.odoo.orders, undefined, intl), revenue: vnd(record.odoo.revenue, intl) })}
            {record.odoo.tags.length > 0 && <span className="text-slate-400">{t("overview.playbook.outcomes.odooTags", { tags: record.odoo.tags.join(", ") })}</span>}
          </div>
        ) : (
          <div className="text-xs text-slate-400">{t("overview.playbook.outcomes.odooErr", { error: record.odoo.error })}</div>
        )
      )}
    </div>
  );
}
