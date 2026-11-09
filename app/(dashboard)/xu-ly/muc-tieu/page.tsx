"use client";

// ============================================================
// Mục tiêu theo sản phẩm — mỗi (công ty × sản phẩm) có 2 ngưỡng: mục tiêu
// (muốn đạt) và trần (vượt là cắt). Dùng bởi bảng Tổng quan + bước 3 của
// phiên xử lý (lib/case/targets.ts targetFor()).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { getJson, putJson, ApiError } from "@/components/case/api";
import { PRODUCT_LABEL } from "@/lib/case/product";
import type { ProductGroup } from "@/lib/case/product";
import type { Company } from "@/lib/case/types";
import type { TargetBasis } from "@/lib/case/verdict";
import { companyIds, companyLabel, hasPack } from "@/lib/companies/registry";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

interface TargetRow { company: Company; group: ProductGroup; basis: TargetBasis; target: number; ceiling: number; cplTarget?: number | null; cplCeiling?: number | null }
// Đợt 23 (3a): + CPL mục tiêu / CPL trần cho chiến dịch thu lead (tuỳ chọn).
type Draft = { basis: TargetBasis; target: string; ceiling: string; cplTarget?: string; cplCeiling?: string };

const GROUPS = Object.keys(PRODUCT_LABEL) as ProductGroup[];
// Đợt 23: công ty theo bản cài (trước đây ghim ["MBI","MBC"] → bản khách KHÔNG đặt được mục tiêu nào, Xử lý chiến dịch
// không bao giờ chấm đỏ). Bản Mắt Bão: vẫn MBI rồi MBC như cũ.
const companiesOf = (): Company[] => [...companyIds()].sort((a, b) => (a === "MBI" ? -1 : b === "MBI" ? 1 : 0)) as Company[];
/** Nhóm sản phẩm là của Mắt Bão (Hosting, Tên miền, HĐĐT…) — công ty khác chỉ có "Mặc định" (áp cho mọi chiến dịch). */
const groupsOf = (company: Company): ProductGroup[] => (hasPack(company, "matbao") ? GROUPS : ["DEFAULT"]);

function keyOf(company: Company, group: ProductGroup) { return `${company}:${group}`; }

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

function validateDraft(t: TFunction, basis: TargetBasis, target: number, ceiling: number): string | null {
  if (!(target > 0) || !(ceiling > 0)) return t("overview.xuly.goal.errPositive");
  if (basis === "cpa" && target > ceiling) return t("overview.xuly.goal.errCpa");
  if (basis === "roas" && target < ceiling) return t("overview.xuly.goal.errRoas");
  return null;
}

export default function CaseTargetsPage() {
  const t = useT();
  const { data, error, isLoading, mutate } = useSWR<{ success: true; rows: TargetRow[] }>("/api/case-targets", getJson);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [prefilled, setPrefilled] = useState(false);
  const [savingCompany, setSavingCompany] = useState<Company | null>(null);
  useCompaniesVersion();
  const COMPANIES = companiesOf();
  const [saveErr, setSaveErr] = useState<Record<Company, string | null>>({});
  const [saveOk, setSaveOk] = useState<Record<Company, boolean>>({});

  useEffect(() => {
    if (prefilled || !data) return;
    const next: Record<string, Draft> = {};
    for (const r of data.rows) {
      next[keyOf(r.company, r.group)] = {
        basis: r.basis,
        target: Number(r.target) > 0 ? String(r.target) : "", ceiling: Number(r.ceiling) > 0 ? String(r.ceiling) : "",
        cplTarget: r.cplTarget ? String(r.cplTarget) : "", cplCeiling: r.cplCeiling ? String(r.cplCeiling) : "",
      };
    }
    setDrafts(next);
    setPrefilled(true);
  }, [data, prefilled]);

  const emptyDraft: Draft = { basis: "cpa", target: "", ceiling: "" };

  function setDraft(company: Company, group: ProductGroup, patch: Partial<Draft>) {
    const k = keyOf(company, group);
    setDrafts((prev) => {
      const base = prev[k] ?? emptyDraft;
      return { ...prev, [k]: { ...base, ...patch } };
    });
  }

  async function saveCompany(company: Company) {
    const rows: TargetRow[] = [];
    const errors: string[] = [];
    for (const group of groupsOf(company)) {
      const d = drafts[keyOf(company, group)];
      const hasSales = !!d && (!!d.target.trim() || !!d.ceiling.trim());
      const hasCpl = !!d && (!!d.cplTarget?.trim() || !!d.cplCeiling?.trim());
      if (!d || (!hasSales && !hasCpl)) continue; // bỏ trống = chưa muốn đặt
      const target = hasSales ? Number(d.target) : 0, ceiling = hasSales ? Number(d.ceiling) : 0;
      const err = hasSales ? validateDraft(t, d.basis, target, ceiling) : null;
      if (err) { errors.push(`${PRODUCT_LABEL[group]}: ${err}`); continue; }
      let cplTarget: number | null = null, cplCeiling: number | null = null;
      if (hasCpl) {
        cplTarget = Number(d.cplTarget); cplCeiling = Number(d.cplCeiling);
        if (!(cplTarget > 0) || !(cplCeiling > 0)) { errors.push(`${PRODUCT_LABEL[group]}: ${t("overview.xuly.goal.errCplPositive")}`); continue; }
        if (cplTarget > cplCeiling) { errors.push(`${PRODUCT_LABEL[group]}: ${t("overview.xuly.goal.errCplOrder")}`); continue; }
      }
      rows.push({ company, group, basis: d.basis, target, ceiling, cplTarget, cplCeiling });
    }
    if (errors.length > 0) { setSaveErr((p) => ({ ...p, [company]: errors.join(" · ") })); return; }
    if (rows.length === 0) { setSaveErr((p) => ({ ...p, [company]: t("overview.xuly.goal.errNoRows") })); return; }

    setSavingCompany(company);
    setSaveErr((p) => ({ ...p, [company]: null }));
    setSaveOk((p) => ({ ...p, [company]: false }));
    try {
      await putJson("/api/case-targets", { rows });
      await mutate();
      setSaveOk((p) => ({ ...p, [company]: true }));
    } catch (e) {
      setSaveErr((p) => ({ ...p, [company]: e instanceof ApiError ? e.message : t("overview.xuly.goal.saveFailed") }));
    } finally {
      setSavingCompany(null);
    }
  }

  const rowsByCompany = useMemo(() => {
    const m: Record<Company, TargetRow[]> = Object.fromEntries(companiesOf().map((c) => [c, [] as TargetRow[]]));
    for (const r of data?.rows ?? []) m[r.company]?.push(r);
    return m;
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("overview.xuly.goal.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          {rich(t("overview.xuly.goal.subtitle"))}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      )}

      {!isLoading && error && (
        <EmptyState
          icon={AlertTriangle}
          title={t("overview.xuly.goal.loadFailed")}
          description={error instanceof ApiError ? error.message : t("overview.xuly.goal.loadError")}
          action={<Button className="h-10" onClick={() => mutate()}>{t("overview.xuly.goal.retry")}</Button>}
        />
      )}

      {!isLoading && !error && data && COMPANIES.map((company) => (
        <div key={company} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">{company === "MBC" || company === "MBI" ? company : companyLabel(company)}</span>
            <span className="text-xs text-slate-400">{t("overview.xuly.goal.productsWithGoal", { n: (rowsByCompany[company] ?? []).length })}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("overview.xuly.goal.thProduct")}</th>
                <th className="px-3 py-2 font-medium">{t("overview.xuly.goal.thBasis")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.xuly.goal.thTarget")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.xuly.goal.thCeiling")}</th>
                <th className="px-3 py-2 text-right font-medium" title={t("overview.xuly.goal.cplTargetTip")}>{t("overview.xuly.goal.cplTarget")}</th>
                <th className="px-3 py-2 text-right font-medium" title={t("overview.xuly.goal.cplCeilingTip")}>{t("overview.xuly.goal.cplCeiling")}</th>
              </tr>
            </thead>
            <tbody>
              {groupsOf(company).map((group) => {
                const k = keyOf(company, group);
                const d = drafts[k] ?? { basis: "cpa" as TargetBasis, target: "", ceiling: "" };
                return (
                  <tr key={group} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-700">{PRODUCT_LABEL[group]}</td>
                    <td className="px-3 py-2">
                      <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                        {(["cpa", "roas"] as TargetBasis[]).map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setDraft(company, group, { basis: b })}
                            className={cn(
                              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                              d.basis === b ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50",
                            )}
                          >
                            {b === "cpa" ? "CPA" : "ROAS"}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        inputMode="numeric"
                        aria-label={t("overview.xuly.goal.ariaTarget", { product: PRODUCT_LABEL[group], company })}
                        value={d.target}
                        onChange={(e) => setDraft(company, group, { target: e.target.value })}
                        className="ml-auto w-28 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        inputMode="numeric"
                        aria-label={t("overview.xuly.goal.ariaCeiling", { product: PRODUCT_LABEL[group], company })}
                        value={d.ceiling}
                        onChange={(e) => setDraft(company, group, { ceiling: e.target.value })}
                        className="ml-auto w-28 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        inputMode="numeric"
                        aria-label={t("overview.xuly.goal.ariaCplTarget", { product: PRODUCT_LABEL[group], company })}
                        placeholder="—"
                        value={d.cplTarget ?? ""}
                        onChange={(e) => setDraft(company, group, { cplTarget: e.target.value })}
                        className="ml-auto w-28 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        inputMode="numeric"
                        aria-label={t("overview.xuly.goal.ariaCplCeiling", { product: PRODUCT_LABEL[group], company })}
                        placeholder="—"
                        value={d.cplCeiling ?? ""}
                        onChange={(e) => setDraft(company, group, { cplCeiling: e.target.value })}
                        className="ml-auto w-28 text-right tabular-nums"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="text-sm">
              {saveErr[company] && <span className="text-red-600">{saveErr[company]}</span>}
              {!saveErr[company] && saveOk[company] && <span className="text-emerald-600">{t("overview.xuly.goal.saved")}</span>}
            </div>
            <Button className="h-10" onClick={() => saveCompany(company)} disabled={savingCompany === company}>
              {savingCompany === company && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("overview.xuly.goal.save", { company })}
            </Button>
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <div className="mb-1 font-semibold text-slate-800">Facebook</div>
        {rich(t("overview.xuly.goal.fbNote"))}
      </div>
    </div>
  );
}
