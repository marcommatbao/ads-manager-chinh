"use client";

// ============================================================
// "✅ Việc nên làm" của /meta-xray — nội dung SINH ở server (lib/meta/recommend.ts,
// chỉ import type ở đây). Mỗi action có 3 dạng:
//   open_case — mở phiên xử lý (POST /api/cases), rồi chuyển sang /xu-ly/{id}
//               (mirror ĐÚNG hàm openCase() trong app/(dashboard)/xu-ly/page.tsx).
//               Mở phiên KHÔNG ghi gì lên Meta — chỉ tạo bản ghi trong hệ thống của
//               mình, nên KHÔNG khoá nút theo canEdit; lỗi (vd khoảng ngày <7 ngày)
//               hiện nguyên văn từ server.
//   link       — điều hướng nội bộ (Next Link bọc trong Button, mẫu app/(dashboard)/so-kinh-nghiem/page.tsx).
//   manual     — các bước làm tay, không có gì để bấm (Ads Manager không cho sửa qua API).
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { postJson, ApiError } from "@/components/case/api";
import { vnd } from "@/components/case/format";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { MetaRecommendation } from "@/lib/meta/recommend";

type Company = string;
type Range = { from: string; to: string };

const PRIORITY_META: Record<1 | 2 | 3, { label: MessageKey; symbol: string; cls: string }> = {
  1: { label: "meta.xray.rec.p1", symbol: "P1", cls: "bg-red-50 text-red-700 border-red-200" },
  2: { label: "meta.xray.rec.p2", symbol: "P2", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  3: { label: "meta.xray.rec.p3", symbol: "P3", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function Badge({ cls, symbol, children }: { cls: string; symbol: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {symbol} {children}
    </span>
  );
}

function RecommendationCard({ rec, company, range }: { rec: MetaRecommendation; company: Company; range: Range }) {
  const intl = useIntlLocale();
  const t = useT();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const meta = PRIORITY_META[rec.priority];
  const action = rec.action;

  async function openCase() {
    if (action.type !== "open_case") return;
    setOpening(true);
    setErr(null);
    try {
      const json = await postJson("/api/cases", { company, campaignId: action.campaignId, platform: "facebook", from: range.from, to: range.to });
      router.push(`/xu-ly/${json.case.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("meta.xray.rec.openFail"));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge cls={meta.cls} symbol={meta.symbol}>{t(meta.label)}</Badge>
          <h4 className="text-sm font-bold text-slate-800">{rec.title}</h4>
        </div>
        <p className="text-xs text-slate-500">{rec.why}</p>
        {rec.moneyAtStake !== null && <p className="text-xs font-semibold text-red-600">{t("meta.xray.rec.atStake", { value: vnd(rec.moneyAtStake, intl) })}</p>}
      </div>

      {action.type === "open_case" && (
        <div className="space-y-1.5">
          <Button type="button" size="sm" className="h-9" onClick={openCase} disabled={opening}>
            {opening && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.xray.rec.openCase")}
          </Button>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}

      {action.type === "link" && (
        <Button type="button" size="sm" className="h-9" render={<Link href={action.href} />}>{action.label}</Button>
      )}

      {action.type === "manual" && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-800">{t("meta.xray.rec.how")}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-amber-800">
            {action.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

export function MetaRecommendations({ recommendations, company, range }: { recommendations: MetaRecommendation[]; company: Company; range: Range }) {
  const t = useT();
  if (recommendations.length === 0) {
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{t("meta.xray.rec.none")}</p>;
  }
  return (
    <div className="space-y-3">
      {recommendations.map((rec) => <RecommendationCard key={rec.id} rec={rec} company={company} range={range} />)}
    </div>
  );
}
