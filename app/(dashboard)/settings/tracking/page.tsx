"use client";

import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Info, Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_CONFIG } from "@/lib/company-config";
import { companyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface StatusData {
  facebook: boolean;
  ga4: boolean;
  google: boolean;
  googleAccounts?: { id: string; name: string; connected: boolean }[];
}

interface GA4Data {
  connected?: boolean;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─────────────────────────────────────────────
// Connection Badge
// ─────────────────────────────────────────────

function ConnectionBadge({ connected }: { connected: boolean }) {
  const t = useT();
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("creative.settingsTracking.badge.connected")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      {t("creative.settingsTracking.badge.disconnected")}
    </span>
  );
}

// ─────────────────────────────────────────────
// Info Row — read-only property display
// ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className="font-mono text-sm text-slate-700 bg-slate-100 rounded px-2 py-0.5 text-right truncate max-w-xs">
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// GA4 Section
// ─────────────────────────────────────────────

function GA4Section({ statusData }: { statusData: StatusData | undefined }) {
  const t = useT();
  const { data: ga4Data, isLoading, mutate } = useSWR<GA4Data>("/api/ga4", fetcher, {
    revalidateOnFocus: false,
  });

  const isConnected = ga4Data?.connected === true || statusData?.ga4 === true;

  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-amber-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">
              Google Analytics 4
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionBadge connected={isConnected} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutate()}
              disabled={isLoading}
              className="gap-1.5 border-slate-200 text-slate-500 hover:text-amber-700"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Test
            </Button>
          </div>
        </div>
        <CardDescription className="text-sm text-slate-500 mt-1">
          {t("creative.settingsTracking.ga4.desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {companyIds().map((company) => {
          const cfg = COMPANY_CONFIG[company];
          if (!cfg) return null;
          return (
            <div key={company} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={cn(
                    "text-xs font-bold px-2.5 py-1 rounded-md",
                    `bg-${cfg.color}-100 text-${cfg.color}-700`
                  )}
                >
                  {cfg.label}
                </span>
                <span className="text-xs text-slate-400">{cfg.domain}</span>
              </div>
              <div>
                <InfoRow
                  label="Property ID"
                  value={cfg.ga4.propertyId.replace("properties/", "")}
                />
                <InfoRow label="Stream ID" value={cfg.ga4.streamId} />
                <InfoRow label="Measurement ID" value={cfg.ga4.measurementId} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Facebook Pixel Section
// ─────────────────────────────────────────────

function FacebookPixelSection({ connected }: { connected: boolean }) {
  const t = useT();
  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-blue-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">
              Facebook Pixel
            </CardTitle>
          </div>
          <ConnectionBadge connected={connected} />
        </div>
        <CardDescription className="text-sm text-slate-500 mt-1">
          {t("creative.settingsTracking.pixel.desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {companyIds().map((company) => {
          const cfg = COMPANY_CONFIG[company];
          if (!cfg) return null;
          return (
            <div key={company} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={cn(
                    "text-xs font-bold px-2.5 py-1 rounded-md",
                    `bg-${cfg.color}-100 text-${cfg.color}-700`
                  )}
                >
                  {cfg.label}
                </span>
                <span className="text-xs text-slate-400">{cfg.domain}</span>
              </div>
              <InfoRow label="Pixel ID" value={cfg.facebook.pixelId} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Google Ads Section
// ─────────────────────────────────────────────

function GoogleAdsSection({ statusData }: { statusData: StatusData | undefined }) {
  const t = useT();
  const accounts = statusData?.googleAccounts ?? [];
  const isConnected = statusData?.google === true;

  // Display customer IDs masked: keep first 3 digits + "****"
  function maskId(id: string): string {
    if (id.length <= 3) return id + "****";
    return id.slice(0, 3) + id.slice(3).replace(/\d/g, "*");
  }

  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-red-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">
              Google Ads
            </CardTitle>
          </div>
          <ConnectionBadge connected={isConnected} />
        </div>
        <CardDescription className="text-sm text-slate-500 mt-1">
          {t("creative.settingsTracking.gads.desc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
            <p className="text-sm text-slate-400">{t("creative.settingsTracking.gads.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acct, i) => (
              <div
                key={acct.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-700">{acct.name}</p>
                  <p className="font-mono text-xs text-slate-400 mt-0.5">
                    {maskId(acct.id)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      i === 0
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-indigo-200 bg-indigo-50 text-indigo-700"
                    )}
                  >
                    {i === 0 ? "MBC" : "MBI"}
                  </Badge>
                  <ConnectionBadge connected={acct.connected} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function TrackingSettingsPage() {
  const t = useT();
  const { data: statusData, isLoading: statusLoading, error: statusError } =
    useSWR<StatusData>("/api/status", fetcher, { revalidateOnFocus: false });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header info */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <Info className="mt-0.5 h-5 w-5 text-slate-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-slate-700">
            {t("creative.settingsTracking.note.title")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("creative.settingsTracking.note.body")}
          </p>
        </div>
      </div>

      {/* Status loading */}
      {statusLoading && (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t("creative.settingsTracking.checking")}</span>
        </div>
      )}

      {statusError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-600">{t("creative.settingsTracking.err.status")}</p>
        </div>
      )}

      {/* GA4 */}
      <GA4Section statusData={statusData} />

      {/* Facebook Pixel */}
      <FacebookPixelSection connected={statusData?.facebook ?? false} />

      {/* Google Ads */}
      <GoogleAdsSection statusData={statusData} />

      {/* Summary status */}
      {!statusLoading && statusData && (
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Activity className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-base font-semibold text-slate-800">
                {t("creative.settingsTracking.summary")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Google Analytics 4", connected: statusData.ga4 },
                { label: "Facebook Ads", connected: statusData.facebook },
                { label: "Google Ads", connected: statusData.google },
              ].map(({ label, connected }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-4 text-center"
                >
                  <ConnectionBadge connected={connected} />
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
