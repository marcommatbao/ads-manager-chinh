"use client";

// ============================================================
// Settings → Chi phí kênh khác
//
// Chi phí Meta và Google được lấy tự động qua API. Các kênh không có API
// (TikTok, Zalo…) thì không có đường nào vào hệ thống — tháng nào chạy thêm là
// tổng chi phí trên KPI Tổng Quan và báo cáo Telegram bị hụt mà không ai biết.
// Trang này là chỗ khai số đó. Số nhập ở đây luôn được hiển thị TÁCH BẠCH khỏi
// số đo được, không bao giờ trộn im lặng.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";

type Company = string;

interface Entry {
  month: string;
  company: Company;
  channel: string;
  amount: number;
  note?: string;
  updatedBy: string;
  updatedAt: string;
}

interface ApiResponse {
  success: boolean;
  entries: Entry[];
  channels: Array<{ id: string; label: string }>;
  canEdit: boolean;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
// Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
const COMPANIES: Company[] = orderedCompanyIds(["MBC", "MBI"]) as Company[];

const fmt = (n: number, loc: string) => n.toLocaleString(loc);
const keyOf = (month: string, company: string, channel: string) => `${month}|${company}|${channel}`;

export default function ManualSpendPage() {
  const t = useT();
  const loc = useIntlLocale();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [company, setCompany] = useState<Company>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/manual-spend?year=${year}`);
      const json = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setDraft({});
    } catch (err) {
      toast({
        title: t("creative.settingsManualSpend.err.load"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, toast, t]);

  useEffect(() => { void load(); }, [load]);

  const saved = useMemo(() => {
    const map: Record<string, Entry> = {};
    for (const e of data?.entries ?? []) map[keyOf(e.month, e.company, e.channel)] = e;
    return map;
  }, [data]);

  const channels = data?.channels ?? [];
  const canEdit = data?.canEdit ?? false;

  const save = async (month: string, channel: string) => {
    const k = keyOf(month, company, channel);
    const raw = draft[k] ?? String(saved[k]?.amount ?? "");
    const amount = Number(String(raw).replace(/[^\d]/g, "")) || 0;

    setSaving(k);
    try {
      const res = await fetch("/api/settings/manual-spend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, company, channel, amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({ title: amount > 0 ? t("creative.settingsManualSpend.saved", { amount: fmt(amount, loc) }) : t("creative.settingsManualSpend.removed") });
      await load();
    } catch (err) {
      toast({
        title: t("creative.settingsManualSpend.err.save"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  const yearTotal = (data?.entries ?? [])
    .filter((e) => e.company === company)
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">{t("creative.settingsManualSpend.title")}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t("creative.settingsManualSpend.subtitle")}
        </p>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex gap-2.5">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 space-y-1">
          <p>{t("creative.settingsManualSpend.info.api.pre")}<strong>{t("creative.settingsManualSpend.info.api.bold")}</strong>{t("creative.settingsManualSpend.info.api.post")}</p>
          <p>{t("creative.settingsManualSpend.info.month.pre")}<strong>{t("creative.settingsManualSpend.info.month.bold")}</strong>{t("creative.settingsManualSpend.info.month.post")}</p>
          <p>{t("creative.settingsManualSpend.info.zero")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          {COMPANIES.map((c) => (
            <button
              key={c}
              onClick={() => setCompany(c)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                company === c ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{t("creative.settingsManualSpend.year", { year: y })}</option>
          ))}
        </select>

        <span className="text-sm text-slate-500">
          {t("creative.settingsManualSpend.total.pre", { year, company })}<strong className="text-slate-800">{fmt(yearTotal, loc)}đ</strong>
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-10">
          <Loader2 className="h-4 w-4 animate-spin" />{t("creative.settingsManualSpend.loading")}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("creative.settingsManualSpend.th.month")}</th>
                {channels.map((ch) => (
                  <th key={ch.id} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {ch.label}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("creative.settingsManualSpend.th.total")}</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m) => {
                const month = `${year}-${String(m).padStart(2, "0")}`;
                const rowTotal = channels.reduce(
                  (s, ch) => s + (saved[keyOf(month, company, ch.id)]?.amount ?? 0), 0,
                );
                return (
                  <tr key={month} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                    <td className="px-4 py-2 font-medium text-slate-700 whitespace-nowrap">{t("creative.settingsManualSpend.row.month", { m })}</td>
                    {channels.map((ch) => {
                      const k = keyOf(month, company, ch.id);
                      const current = saved[k];
                      const value = draft[k] ?? (current ? String(current.amount) : "");
                      return (
                        <td key={ch.id} className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              inputMode="numeric"
                              disabled={!canEdit}
                              value={value}
                              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                              placeholder="0"
                              className="w-32 rounded-md border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
                            />
                            {canEdit && (draft[k] !== undefined) && (
                              <button
                                onClick={() => save(month, ch.id)}
                                disabled={saving === k}
                                className="rounded-md bg-amber-500 p-1.5 text-amber-950 hover:bg-amber-600 disabled:opacity-50"
                                title={t("creative.settingsManualSpend.save")}
                              >
                                {saving === k
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Save className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>
                          {current?.updatedBy && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {current.updatedBy.split("@")[0]} · {current.updatedAt.slice(0, 10)}
                            </p>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">
                      {rowTotal > 0 ? `${fmt(rowTotal, loc)}đ` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
