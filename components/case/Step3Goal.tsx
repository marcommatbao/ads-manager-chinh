// ============================================================
// Bước 3 — Chốt mục tiêu cuối trước khi hệ thống xếp hạng nguyên nhân.
// ============================================================
"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getJson, postJson, ApiError } from "./api";
import { vnd } from "./format";
import { productGroupOf, PRODUCT_LABEL } from "@/lib/case/product";
import type { CampaignCase } from "@/lib/case/store";
import type { Company } from "@/lib/case/types";
import type { CaseBasis, TargetBasis } from "@/lib/case/verdict";
import { evidenceGoalKind } from "@/lib/case/goal-kind";
import { useT, useIntlLocale } from "@/lib/i18n/client";

// Hình dạng tối thiểu của một dòng /api/case-targets — chỉ lấy phần cần để
// gợi ý mục tiêu, KHÔNG import lib/case/targets.ts (đó là file backend có fs).
interface TargetRow {
  company: Company;
  group: string;
  basis: TargetBasis;
  target: number;
  ceiling: number;
  cplTarget?: number | null;
  cplCeiling?: number | null;
}

export function Step3Goal({
  c,
  onBack,
  onSubmitted,
  busy,
}: {
  c: CampaignCase;
  onBack: () => void;
  onSubmitted: (next: CampaignCase) => void;
  busy?: boolean;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const group = productGroupOf(c.campaignName);
  const groupLabel = PRODUCT_LABEL[group];
  const { data } = useSWR<{ success: true; rows: TargetRow[] }>("/api/case-targets", getJson);

  // Đợt 23 (3d): chiến dịch thu lead chấm theo chi phí mỗi lead (CPL) — gợi ý từ CPL mục tiêu/trần của sản phẩm.
  const leads = evidenceGoalKind(c.evidence) === "leads";
  const hasCpl = (r: TargetRow) => Number(r.cplTarget) > 0 && Number(r.cplCeiling) > 0;
  const hasSales = (r: TargetRow) => Number(r.target) > 0 && Number(r.ceiling) > 0;
  const ok = leads ? hasCpl : hasSales;
  const row = data?.rows.find((r) => r.company === c.company && r.group === group && ok(r))
    ?? data?.rows.find((r) => r.company === c.company && r.group === "DEFAULT" && ok(r));
  const existing = useMemo<{ basis: CaseBasis; target: number; ceiling: number } | undefined>(() => (!row ? undefined
    : leads ? { basis: "cpl", target: Number(row.cplTarget), ceiling: Number(row.cplCeiling) }
    : { basis: row.basis, target: row.target, ceiling: row.ceiling }), [row, leads]);

  const [basis, setBasis] = useState<CaseBasis>(leads ? "cpl" : c.goal?.basis ?? existing?.basis ?? "cpa");
  const [target, setTarget] = useState<string>(String(c.goal?.target ?? existing?.target ?? ""));
  const [ceiling, setCeiling] = useState<string>(String(c.goal?.ceiling ?? existing?.ceiling ?? ""));
  const [where, setWhere] = useState<string>(c.goal?.where ?? "");
  const [saveAsDefault, setSaveAsDefault] = useState(!c.goal);
  const [prefilled, setPrefilled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Chỉ điền sẵn MỘT LẦN khi mục tiêu hiện có tải xong — sau đó để người dùng
  // tự gõ, không ghi đè giữa lúc họ đang sửa.
  useEffect(() => {
    if (prefilled || c.goal || !existing) return;
    setBasis(existing.basis);
    setTarget(String(existing.target));
    setCeiling(String(existing.ceiling));
    setPrefilled(true);
  }, [existing, prefilled, c.goal]);

  const targetN = Number(target);
  const ceilingN = Number(ceiling);
  const clientError =
    !target || !ceiling ? null
    : !(targetN > 0) || !(ceilingN > 0) ? t("overview.step3.err.positive")
    : basis === "cpa" && targetN > ceilingN ? t("overview.step3.err.cpa")
    : basis === "cpl" && targetN > ceilingN ? t("overview.step3.err.cpl")
    : basis === "roas" && targetN < ceilingN ? t("overview.step3.err.roas")
    : null;

  async function submit() {
    if (clientError || !target || !ceiling) { setErr(clientError ?? t("overview.step3.err.fill")); return; }
    setSaving(true);
    setErr(null);
    try {
      const json = await postJson(`/api/cases/${c.id}/goal`, {
        basis, target: targetN, ceiling: ceilingN, where: where.trim(), saveAsDefault,
      });
      onSubmitted(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step3.err.save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">{t("overview.step3.title")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t("overview.step3.subtitle")} <b>{groupLabel}</b></p>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("overview.step3.basis")}</label>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {(leads ? ([["cpl", t("overview.step3.basis.cpl")]] as const) : ([["cpa", t("overview.step3.basis.cpa")], ["roas", "ROAS"]] as const)).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setBasis(v)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  basis === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="ac-where" className="mb-1.5 block text-sm font-medium text-slate-700">{leads ? t("overview.step3.where.lead") : t("overview.step3.where.order")}</label>
          <Input
            id="ac-where"
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder={leads ? t("overview.step3.where.leadPh") : t("overview.step3.where.orderPh")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ac-target" className="mb-1.5 block text-sm font-medium text-slate-700">
              {basis === "cpl" ? t("overview.step3.target.cpl") : basis === "cpa" ? t("overview.step3.target.cpa") : t("overview.step3.target.roas")} <span className="text-red-500">*</span>
            </label>
            <Input id="ac-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="ac-cap" className="mb-1.5 block text-sm font-medium text-slate-700">
              {basis === "cpl" ? t("overview.step3.ceil.cpl") : basis === "cpa" ? t("overview.step3.ceil.cpa") : t("overview.step3.ceil.roas")} <span className="text-red-500">*</span>
            </label>
            <Input id="ac-cap" inputMode="numeric" value={ceiling} onChange={(e) => setCeiling(e.target.value)} required />
          </div>
        </div>
        {basis !== "roas" && targetN > 0 && ceilingN > 0 && (
          <p className="text-xs text-slate-400">{t("overview.step3.overCeil", { amount: vnd(ceilingN, intl), unit: basis === "cpl" ? t("overview.step3.unit.lead") : t("overview.step3.unit.order") })}</p>
        )}

        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-slate-700">
          <Checkbox checked={saveAsDefault} onCheckedChange={setSaveAsDefault} />
          {t("overview.step3.saveDefault")} <b>{groupLabel} ({c.company})</b>
        </label>

        {(clientError || err) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err ?? clientError}</div>
        )}
      </div>

      <div className="flex justify-between">
        <Button className="h-10" variant="outline" onClick={onBack} disabled={busy || saving}>{t("overview.step3.back")}</Button>
        <Button className="h-10" onClick={submit} disabled={busy || saving || !!clientError}>
          {saving ? t("overview.step3.saving") : t("overview.step3.submit")}
        </Button>
      </div>
    </div>
  );
}
