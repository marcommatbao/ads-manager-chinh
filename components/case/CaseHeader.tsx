"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { CampaignCase } from "@/lib/case/store";
import { useT } from "@/lib/i18n/client";
import { CaseStatusPill } from "./StatusPill";

export function CaseHeader({ c }: { c: CampaignCase }) {
  const t = useT();
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Link href="/xu-ly" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t("overview.casehead.back")}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{c.platform === "facebook" ? "Meta" : "Google"}</span>
          <span aria-hidden="true">·</span>
          <span>{c.company}</span>
          <span aria-hidden="true">·</span>
          <span>{t("overview.casehead.session", { id: c.id.slice(5, 11) })}</span>
        </div>
        <h1 className="mt-0.5 truncate text-lg font-bold text-slate-900">{c.campaignName}</h1>
      </div>
      <CaseStatusPill status={c.status} />
    </div>
  );
}
