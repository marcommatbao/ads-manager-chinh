"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { recentMonths } from "@/lib/ads-content/month-range";
import type { AdsContentFilters } from "@/lib/ads-content/filtering";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";

// Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
const coText = (id: string) => (id === "MBC" || id === "MBI" ? id : companyLabel(id));

interface AdsContentFilterBarProps {
  month: string;
  onMonthChange: (month: string) => void;
  filters: AdsContentFilters;
  onFiltersChange: (filters: AdsContentFilters) => void;
  objectiveOptions: string[];
  productOptions: string[];
}

// Base UI Select hiện GIÁ TRỊ thô ("all", "recent") trên nút nếu không có hàm đổi sang nhãn (crawl 15/10/2026).
const sortLabel = (t: TFunction): Record<string, string> => ({ recent: t("creative.adsContent.filter.sortRecent"), spend_desc: t("creative.adsContent.filter.sortSpend"), clicks_desc: t("creative.adsContent.filter.sortClicks"), name_asc: t("creative.adsContent.filter.sortName") });

function monthLabel(month: string, t: TFunction): string {
  const [y, m] = month.split("-");
  return t("creative.adsContent.filter.month", { m, y });
}

export function AdsContentFilterBar({
  month,
  onMonthChange,
  filters,
  onFiltersChange,
  objectiveOptions,
  productOptions,
}: AdsContentFilterBarProps) {
  const t = useT();
  function set<K extends keyof AdsContentFilters>(key: K, value: AdsContentFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
        >
          {recentMonths(12).map((m) => (
            <option key={m} value={m}>{monthLabel(m, t)}</option>
          ))}
        </select>

        <Select value={filters.platform} onValueChange={(v) => set("platform", v as AdsContentFilters["platform"])}>
          <SelectTrigger className="h-9 w-[160px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.platform")}>{(v: string) => ({ all: t("creative.adsContent.filter.platformAll"), facebook: "Facebook", google: "Google" } as Record<string, string>)[v] ?? v}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("creative.adsContent.filter.platformAll")}</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="google">Google</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.creativeType} onValueChange={(v) => set("creativeType", v as AdsContentFilters["creativeType"])}>
          <SelectTrigger className="h-9 w-[150px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.typePlaceholder")}>{(v: string) => ({ all: t("creative.adsContent.filter.typeAll"), facebook: "Facebook", google_search: "Google Search", google_pmax: "Google PMax" } as Record<string, string>)[v] ?? v}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("creative.adsContent.filter.typeAll")}</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="google_search">Google Search</SelectItem>
            <SelectItem value="google_pmax">Google PMax</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.company} onValueChange={(v) => set("company", v as AdsContentFilters["company"])}>
          <SelectTrigger className="h-9 w-[140px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.company")}>{(v: string) => (v === "all" ? orderedCompanyIds(["MBC", "MBI"]).map(coText).join(" + ") : coText(v))}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{orderedCompanyIds(["MBC", "MBI"]).map(coText).join(" + ")}</SelectItem>
            {orderedCompanyIds(["MBC", "MBI"]).map((c) => (
              <SelectItem key={c} value={c}>{coText(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.status} onValueChange={(v) => set("status", v as AdsContentFilters["status"])}>
          <SelectTrigger className="h-9 w-[150px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.status")}>{(v: string) => ({ all: t("creative.adsContent.filter.statusAll"), ACTIVE: t("creative.adsContent.filter.active"), PAUSED: t("creative.adsContent.filter.paused"), ARCHIVED: t("creative.adsContent.filter.archived") } as Record<string, string>)[v] ?? v}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("creative.adsContent.filter.statusAll")}</SelectItem>
            <SelectItem value="ACTIVE">{t("creative.adsContent.filter.active")}</SelectItem>
            <SelectItem value="PAUSED">{t("creative.adsContent.filter.paused")}</SelectItem>
            <SelectItem value="ARCHIVED">{t("creative.adsContent.filter.archived")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.objective} onValueChange={(v) => set("objective", v ?? "all")}>
          <SelectTrigger className="h-9 w-[160px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.objective")}>{(v: string) => (v === "all" ? t("creative.adsContent.filter.objectiveAll") : v)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("creative.adsContent.filter.objectiveAll")}</SelectItem>
            {objectiveOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.product} onValueChange={(v) => set("product", v ?? "all")}>
          <SelectTrigger className="h-9 w-[200px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.campaignPlaceholder")}>{(v: string) => (v === "all" ? t("creative.adsContent.filter.campaignAll") : v)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("creative.adsContent.filter.campaignAll")}</SelectItem>
            {productOptions.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder={t("creative.adsContent.filter.search")}
            className="h-9 pl-8 text-sm border-slate-200"
          />
        </div>

        <Select value={filters.sort} onValueChange={(v) => set("sort", v as AdsContentFilters["sort"])}>
          <SelectTrigger className="h-9 w-[190px] border-slate-200 text-sm"><SelectValue placeholder={t("creative.adsContent.filter.sort")}>{(v: string) => sortLabel(t)[v] ?? v}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t("creative.adsContent.filter.sortRecent")}</SelectItem>
            <SelectItem value="spend_desc">{t("creative.adsContent.filter.sortSpend")}</SelectItem>
            <SelectItem value="clicks_desc">{t("creative.adsContent.filter.sortClicks")}</SelectItem>
            <SelectItem value="name_asc">{t("creative.adsContent.filter.sortName")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
