"use client";

// ============================================================
// Khối "Việc cần làm" đầu trang Radar Chính Sách
// ------------------------------------------------------------
// Người dùng nói thẳng: "có chính sách mà tôi không có thời gian đọc". 16 thẻ,
// mỗi thẻ một tóm tắt, vẫn là 16 lần phải tự đọc rồi tự xâu chuỗi. Khối này trả
// lời đúng một câu hỏi: **giờ tôi phải làm gì, cái nào trước.**
//
// Ba nguyên tắc hiển thị:
//  1. KHÔNG tự gọi AI khi mở trang. Vào trang chỉ đọc bản đã lưu. Dựng lại phải
//     có người bấm — nút nói rõ nó tốn token.
//  2. Kế hoạch cũ so với danh sách hiện tại thì phải NÓI RA. Danh sách việc
//     trông "gọn gàng" mà thiếu mục mới còn nguy hơn không có danh sách.
//  3. Không dựng được thì hiện lý do. Danh sách trống trơn đọc thành "không có
//     việc gì phải làm" — một câu hoàn toàn khác.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, AlertTriangle, Wrench, User, EyeOff, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface PolicyAction {
  title: string;
  lane: "account" | "tool" | "ignore";
  deadline: string | null;
  deadlineNote: string;
  why: string;
  severity: "high" | "medium" | "low";
  sourceItemIds: string[];
}

interface PolicyActionPlan {
  generatedAt: string;
  itemCount: number;
  itemsFingerprint: string;
  truncated: boolean;
  actions: PolicyAction[];
  ignored: Array<{ itemId: string; title: string; reason: string }>;
  error: string | null;
}

interface ApiState {
  plan: PolicyActionPlan | null;
  openCount: number;
  stale: boolean;
  neverBuilt: boolean;
}

/** Số ngày còn lại — âm nghĩa là đã quá hạn. */
function daysLeft(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  const t = useT();
  if (!deadline) {
    return (
      <span className="text-[11px] text-slate-400 shrink-0">{t("meta.policy.plan.noDeadline")}</span>
    );
  }
  const n = daysLeft(deadline);
  const label = n < 0 ? t("meta.policy.plan.overdue", { n: -n }) : n === 0 ? t("meta.policy.plan.today") : t("meta.policy.plan.daysLeft", { n });
  const tone =
    n < 0 ? "bg-red-100 text-red-700 border-red-200"
    : n <= 7 ? "bg-red-50 text-red-700 border-red-200"
    : n <= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0", tone)}>
      {label} · {deadline}
    </span>
  );
}

const LANE_META = {
  account: { label: "meta.policy.plan.lane.account" as MessageKey, icon: User, cls: "bg-blue-50 text-blue-700 border-blue-200" },
  tool: { label: "meta.policy.plan.lane.tool" as MessageKey, icon: Wrench, cls: "bg-violet-50 text-violet-700 border-violet-200" },
  ignore: { label: "meta.policy.plan.lane.ignore" as MessageKey, icon: EyeOff, cls: "bg-slate-100 text-slate-500 border-slate-200" },
} as const;

export default function ActionPlanPanel({
  canManage,
  onOpenItem,
}: {
  canManage: boolean;
  /** Bấm vào nguồn thì mở đúng thẻ gốc — để kiểm chứng, không phải tin suông. */
  onOpenItem?: (itemId: string) => void;
}) {
  const t = useT();
  const intl = useIntlLocale();
  const [state, setState] = useState<ApiState | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  // Chỉ ĐỌC bản đã lưu. Không gọi AI ở đây — mở trang không được tốn token.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/policy-radar/action-plan");
      const json = (await res.json()) as ApiState & { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("meta.policy.plan.loadFail"));
      setState(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("meta.policy.plan.loadFail"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const rebuild = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/policy-radar/action-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = (await res.json()) as { plan?: PolicyActionPlan; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("meta.policy.plan.buildFail"));
      if (json.plan?.error) throw new Error(json.plan.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("meta.policy.plan.buildFail"));
    } finally {
      setBuilding(false);
    }
  }, [load, t]);

  const plan = state?.plan ?? null;
  const actions = plan?.actions ?? [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-600" /> {t("meta.policy.plan.title")}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("meta.policy.plan.desc", { open: state?.openCount ?? 0 })}
            {plan && !plan.error && (
              <> {t("meta.policy.plan.builtAt", { time: new Date(plan.generatedAt).toLocaleString(intl), count: plan.itemCount })}</>
            )}
          </p>
        </div>
        {canManage && (
          <button
            onClick={rebuild}
            disabled={building}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            // Nói thẳng nó tốn tiền. Nút "làm mới" trông vô hại mà gọi AI mỗi
            // lần bấm là cách nhanh nhất để đốt token mà không ai để ý.
            title={t("meta.policy.plan.rebuildTitle")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", building && "animate-spin")} />
            {building ? t("meta.policy.plan.reading") : plan ? t("meta.policy.plan.rebuild") : t("meta.policy.plan.build")}
          </button>
        )}
      </div>

      {state?.stale && plan && (
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t("meta.policy.plan.stale")}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {plan?.error && !error && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {t("meta.policy.plan.lastFailed", { error: plan.error })}
        </div>
      )}

      {state?.neverBuilt && !building && (
        <p className="mt-3 text-sm text-slate-500">
          {t("meta.policy.plan.neverBuilt")}{" "}
          {canManage ? t("meta.policy.plan.neverBuiltCan")
                     : t("meta.policy.plan.neverBuiltCannot")}
        </p>
      )}

      {plan && !state?.neverBuilt && actions.length === 0 && !plan.error && (
        <p className="mt-3 text-sm text-slate-500">
          {t("meta.policy.plan.none", { n: plan.itemCount })}
          {plan.ignored.length > 0 && <> {t("meta.policy.plan.noneIgnored", { n: plan.ignored.length })}</>}.
        </p>
      )}

      {actions.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {actions.map((a, i) => {
            const meta = LANE_META[a.lane] ?? LANE_META.account;
            const Icon = meta.icon;
            return (
              <li key={`${a.title}-${i}`} className="rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2 min-w-0">
                    {a.severity === "high" && (
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-slate-800">{a.title}</span>
                  </div>
                  <DeadlineBadge deadline={a.deadline} />
                </div>

                <p className="text-xs text-slate-600 mt-1.5">{a.why}</p>

                {a.deadlineNote && (
                  <p className="text-[11px] text-slate-400 mt-1 flex items-start gap-1">
                    <Clock className="h-3 w-3 mt-0.5 shrink-0" /> {a.deadlineNote}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1", meta.cls)}>
                    <Icon className="h-3 w-3" /> {t(meta.label)}
                  </span>
                  {/* Neo về mục gốc: mọi câu ở trên phải kiểm chứng được, không
                      phải tin lời AI. Nhiều nguồn thì đánh số — lặp lại năm lần
                      chữ "xem mục gốc" y hệt nhau thì không ai biết bấm cái nào. */}
                  {a.sourceItemIds.map((id, n) => (
                    <button
                      key={id}
                      onClick={() => onOpenItem?.(id)}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      {a.sourceItemIds.length > 1 ? t("meta.policy.plan.source", { n: n + 1 }) : t("meta.policy.plan.viewOrigin")}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {plan && plan.ignored.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <button
            onClick={() => setShowIgnored((v) => !v)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            {t(showIgnored ? "meta.policy.plan.hideIgnored" : "meta.policy.plan.showIgnored", { n: plan.ignored.length })}
          </button>
          {showIgnored && (
            <ul className="mt-2 space-y-1">
              {plan.ignored.map((x) => (
                <li key={x.itemId} className="text-xs text-slate-500">
                  <span className="text-slate-600">{x.title}</span> — {x.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {plan?.truncated && (
        <p className="text-[11px] text-amber-600 mt-3">
          {t("meta.policy.plan.truncated", { n: plan.itemCount, total: state?.openCount ?? "?" })}
        </p>
      )}
    </div>
  );
}
