"use client";

import Link from "next/link";
import { isHiddenPage } from "@/lib/hidden-pages";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { Wrench, Search, Clock, TrendingUp, Star, ArrowRight, Users2, Layers, Gauge, Link2Off } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const tools = [
  {
    href: "/toolkit/ngram",
    icon: Search,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "google.toolkit.ngram.title" as MessageKey,
    description: "google.toolkit.ngram.desc" as MessageKey,
    badge: "google.toolkit.ngram.badge" as MessageKey,
    badgeColor: "bg-blue-50 text-blue-600",
  },
  {
    href: "/toolkit/budget-pacing",
    icon: TrendingUp,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    title: "google.toolkit.budgetPacing.title" as MessageKey,
    description: "google.toolkit.budgetPacing.desc" as MessageKey,
    badge: "google.toolkit.budgetPacing.badge" as MessageKey,
    badgeColor: "bg-emerald-50 text-emerald-600",
  },
  {
    href: "/toolkit/ad-group-structure",
    icon: Layers,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "google.toolkit.adGroup.title" as MessageKey,
    description: "google.toolkit.adGroup.desc" as MessageKey,
    badge: "google.toolkit.adGroup.badge" as MessageKey,
    badgeColor: "bg-blue-50 text-blue-600",
  },
  {
    href: "/toolkit/dayparting",
    icon: Clock,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    title: "google.toolkit.dayparting.title" as MessageKey,
    description: "google.toolkit.dayparting.desc" as MessageKey,
    badge: "google.toolkit.dayparting.badge" as MessageKey,
    badgeColor: "bg-violet-50 text-violet-600",
  },
  {
    href: "/toolkit/manual-bid",
    icon: Gauge,
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
    title: "google.toolkit.manualBid.title" as MessageKey,
    description: "google.toolkit.manualBid.desc" as MessageKey,
    badge: "google.toolkit.manualBid.badge" as MessageKey,
    badgeColor: "bg-indigo-50 text-indigo-600",
  },
  {
    href: "/toolkit/landing-page-sweep",
    icon: Link2Off,
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    title: "google.toolkit.lpSweep.title" as MessageKey,
    description: "google.toolkit.lpSweep.desc" as MessageKey,
    badge: "google.toolkit.lpSweep.badge" as MessageKey,
    badgeColor: "bg-red-50 text-red-600",
  },
  {
    href: "/toolkit/quality-score",
    icon: Star,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    title: "google.toolkit.qs.title" as MessageKey,
    description: "google.toolkit.qs.desc" as MessageKey,
    badge: "google.toolkit.qs.badge" as MessageKey,
    badgeColor: "bg-amber-50 text-amber-600",
  },
  {
    href: "/toolkit/audience-overlap",
    icon: Users2,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    title: "google.toolkit.audience.title" as MessageKey,
    description: "google.toolkit.audience.desc" as MessageKey,
    badge: "google.toolkit.audience.badge" as MessageKey,
    badgeColor: "bg-violet-50 text-violet-600",
  },
];

export default function ToolkitPage() {
  const t = useT();
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
          <Wrench className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Google Ads Toolkit</h1>
          <p className="text-sm text-slate-500">{t("google.toolkit.subtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tools.filter(tl => !isHiddenPage(tl.href)).map((tool) => {
          const Icon = tool.icon;
          return (
            <Link key={tool.href} href={tool.href} className="group block">
              <Card className="h-full border border-slate-200 bg-white shadow-sm rounded-xl transition-shadow duration-200 hover:shadow-md hover:border-slate-300">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tool.iconBg}`}>
                      <Icon className={`h-5 w-5 ${tool.iconColor}`} />
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tool.badgeColor}`}>
                      {t(tool.badge)}
                    </span>
                  </div>
                  <CardTitle className="mt-3 text-base font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {t(tool.title)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-4">
                  <CardDescription className="text-sm text-slate-500 leading-relaxed">
                    {t(tool.description)}
                  </CardDescription>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
