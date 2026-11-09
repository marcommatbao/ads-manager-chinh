"use client";

import { useState, useCallback } from "react";
import {
  ChevronRight, ChevronLeft, Loader2, Sparkles,
  Globe, FileText, Users, Settings, Check, RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BriefPreview } from "./BriefPreview";
import { PRODUCTS_BY_COMPANY } from "@/app/(dashboard)/creative/_constants";
import type { AudienceSegment } from "@/app/(dashboard)/creative/_types";
import type { BriefInput, CreativeBrief, BriefCompany, BriefPlatform, BriefObjective, BriefFunnelStage } from "@/lib/creative-brief/types";
import { companyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

// ── Step config ───────────────────────────────────────────────

const STEPS: { id: number; label: MessageKey; icon: React.ReactNode }[] = [
  { id: 1, label: "creative.brief.builder.stepProduct",  icon: <Globe className="h-4 w-4" /> },
  { id: 2, label: "creative.brief.builder.stepAudience", icon: <Users className="h-4 w-4" /> },
  { id: 3, label: "creative.brief.builder.stepStrategy", icon: <Settings className="h-4 w-4" /> },
  { id: 4, label: "creative.brief.builder.stepBrief",    icon: <FileText className="h-4 w-4" /> },
];

const OBJECTIVE_OPTIONS: { value: BriefObjective; label: MessageKey; desc: MessageKey }[] = [
  { value: "awareness",     label: "creative.brief.builder.objAwarenessLabel",     desc: "creative.brief.builder.objAwarenessDesc" },
  { value: "consideration", label: "creative.brief.builder.objConsiderationLabel", desc: "creative.brief.builder.objConsiderationDesc" },
  { value: "conversion",    label: "creative.brief.builder.objConversionLabel",    desc: "creative.brief.builder.objConversionDesc" },
  { value: "retention",     label: "creative.brief.builder.objRetentionLabel",     desc: "creative.brief.builder.objRetentionDesc" },
];

const FUNNEL_OPTIONS: { value: BriefFunnelStage; label: MessageKey; tag: MessageKey }[] = [
  { value: "top",    label: "creative.brief.builder.funnelTop",    tag: "creative.brief.builder.funnelTopTag" },
  { value: "mid",    label: "creative.brief.builder.funnelMid",    tag: "creative.brief.builder.funnelMidTag" },
  { value: "bottom", label: "creative.brief.builder.funnelBottom", tag: "creative.brief.builder.funnelBottomTag" },
];

const PLATFORM_OPTIONS: { value: BriefPlatform; label: MessageKey | string }[] = [
  { value: "facebook", label: "Facebook / Meta" },
  { value: "google",   label: "Google Ads" },
  { value: "both",     label: "creative.brief.builder.platformBoth" },
];

// ── Sub-components ─────────────────────────────────────────────

function RadioCard<T extends string>({
  value, selected, onClick, label, desc,
}: { value: T; selected: T; onClick: (v: T) => void; label: string; desc?: string }) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "w-full text-left rounded-xl border px-3 py-2.5 transition-all text-xs",
        selected === value
          ? "border-indigo-400 bg-indigo-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn("h-3.5 w-3.5 rounded-full border-2 shrink-0 transition-colors",
          selected === value ? "border-indigo-500 bg-indigo-500" : "border-slate-300"
        )} />
        <span className={cn("font-semibold", selected === value ? "text-indigo-700" : "text-slate-700")}>{label}</span>
      </div>
      {desc && <p className="text-[10px] text-slate-400 ml-5.5 mt-0.5 pl-5">{desc}</p>}
    </button>
  );
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all",
            step > s.id  ? "bg-indigo-500 text-white"
            : step === s.id ? "border-2 border-indigo-500 text-indigo-600 bg-white"
            : "bg-slate-100 text-slate-400"
          )}>
            {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
          </div>
          <span className={cn("text-[10px] hidden sm:block", step === s.id ? "text-indigo-600 font-semibold" : "text-slate-400")}>
            {t(s.label)}
          </span>
          {i < STEPS.length - 1 && <div className={cn("w-6 h-px", step > s.id ? "bg-indigo-300" : "bg-slate-200")} />}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

interface Props {
  initialCompany?: BriefCompany;
  onBriefGenerated?: (brief: CreativeBrief) => void;
}

export function BriefBuilder({ initialCompany = "MBC", onBriefGenerated }: Props) {
  const t = useT();
  const [step, setStep] = useState(1);

  // Step 1
  const [company,   setCompany]   = useState<BriefCompany>(initialCompany);
  const [product,   setProduct]   = useState("");
  const [platform,  setPlatform]  = useState<BriefPlatform>("facebook");

  // Step 2 — audience
  const [segments,     setSegments]     = useState<AudienceSegment[]>([]);
  const [segLoading,   setSegLoading]   = useState(false);
  const [segError,     setSegError]     = useState<string | null>(null);
  const [availableSegs, setAvailableSegs] = useState<AudienceSegment[]>([]);
  const [customNote,   setCustomNote]   = useState("");

  // Step 3
  const [objective,   setObjective]   = useState<BriefObjective>("conversion");
  const [funnelStage, setFunnelStage] = useState<BriefFunnelStage>("bottom");
  const [landingUrl,  setLandingUrl]  = useState("");
  const [overrideCta, setOverrideCta] = useState("");
  const [overrideUsp, setOverrideUsp] = useState("");
  const [promoLabel,  setPromoLabel]  = useState("");
  const [budgetVnd,   setBudgetVnd]   = useState("");
  const [durationDays, setDurationDays] = useState("");

  // Step 4 — result
  const [brief,        setBrief]       = useState<CreativeBrief | null>(null);
  const [generating,   setGenerating]  = useState(false);
  const [genError,     setGenError]    = useState<string | null>(null);

  const products = PRODUCTS_BY_COMPANY[company] ?? [];

  // Load available segments when entering step 2
  const loadSegments = useCallback(async () => {
    if (availableSegs.length > 0) return;
    setSegLoading(true);
    setSegError(null);
    try {
      const res  = await fetch(`/api/audiences?company=${company}&limit=30`);
      const json = await res.json().catch(() => null) as
        { success?: boolean; error?: string; data?: { segments?: AudienceSegment[] } } | null;

      // A failed load used to fall through silently and render an empty
      // picker, which is indistinguishable from "no segments saved yet".
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setAvailableSegs(json.data?.segments ?? []);
    } catch (err) {
      setSegError(
        t("creative.brief.builder.segLoadError", { message: err instanceof Error ? err.message : t("creative.brief.builder.unknownError") }),
      );
    } finally {
      setSegLoading(false);
    }
  }, [company, availableSegs.length, t]);

  const goToStep = (next: number) => {
    if (next === 2) loadSegments();
    setStep(next);
  };

  const toggleSegment = (seg: AudienceSegment) => {
    setSegments(prev =>
      prev.some(s => s.segmentName === seg.segmentName)
        ? prev.filter(s => s.segmentName !== seg.segmentName)
        : [...prev, seg]
    );
  };

  const generate = async () => {
    if (!product) { setGenError(t("creative.brief.builder.pickProduct")); return; }

    setGenerating(true);
    setGenError(null);
    setBrief(null);

    const input: BriefInput = {
      company,
      platform,
      product: product as BriefInput["product"],
      objective,
      funnelStage,
      selectedSegments: segments,
      customAudienceNote: customNote || undefined,
      landingPageUrl: landingUrl || undefined,
      promotionContext: promoLabel ? { label: promoLabel } : undefined,
      launchConstraints: budgetVnd ? {
        dailyBudgetVnd: Number(budgetVnd.replace(/[.,\s]/g, "")) || undefined,
        durationDays: Number(durationDays) || undefined,
      } : undefined,
      overrides: {
        cta: overrideCta || undefined,
        mainUsp: overrideUsp || undefined,
      },
    };

    try {
      const res  = await fetch("/api/creative/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const json = await res.json() as { success?: boolean; data?: { brief: CreativeBrief }; error?: string };
      if (json.success && json.data?.brief) {
        setBrief(json.data.brief);
        setStep(4);
        onBriefGenerated?.(json.data.brief);
      } else {
        setGenError(json.error ?? t("creative.brief.builder.genUnknownError"));
      }
    } catch {
      setGenError(t("creative.brief.builder.connError"));
    } finally {
      setGenerating(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5">
      {/* Step indicator */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
        <StepIndicator step={step} total={STEPS.length} />
      </div>

      {/* ── Step 1: Product ───────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-800">{t("creative.brief.builder.step1Title")}</h2>

          {/* Company toggle */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.company")}</p>
            <div className="flex gap-2">
              {companyIds().map(c => (
                <button
                  key={c}
                  onClick={() => { setCompany(c); setProduct(""); }}
                  className={cn(
                    "flex-1 py-2 rounded-lg border text-xs font-bold transition-all",
                    company === c ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}
                >{c}</button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.product")}</p>
            <div className="grid grid-cols-2 gap-2">
              {products.map(p => (
                <button
                  key={p.id}
                  onClick={() => setProduct(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs text-left transition-all",
                    product === p.id
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold"
                      : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <p.icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{p.label}</span>
                  {p.badge && <span className="ml-auto text-[9px] text-amber-600">{p.badge}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Platform */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.platform")}</p>
            <div className="space-y-2">
              {PLATFORM_OPTIONS.map(opt => (
                <RadioCard key={opt.value} value={opt.value} selected={platform} onClick={setPlatform} label={opt.label.startsWith("creative.") ? t(opt.label as MessageKey) : opt.label} />
              ))}
            </div>
          </div>

          <Button
            className="w-full gap-2"
            onClick={() => goToStep(2)}
            disabled={!product}
          >
            {t("creative.brief.builder.continue")} <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Step 2: Audience ──────────────────────────────── */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-800">{t("creative.brief.builder.audience")}</h2>

          {/* Segment library */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">
              {t("creative.brief.builder.segLibrary")} {segments.length > 0 && <span className="text-indigo-600">{t("creative.brief.builder.segSelected", { n: segments.length })}</span>}
            </p>
            {segLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("creative.brief.builder.segLoading")}
              </div>
            )}
            {segError && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded p-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> {segError}
              </p>
            )}
            {!segLoading && availableSegs.length === 0 && !segError && (
              <p className="text-xs text-slate-400 py-2">{t("creative.brief.builder.segEmpty")}</p>
            )}
            {availableSegs.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {availableSegs.map(seg => {
                  const selected = segments.some(s => s.segmentName === seg.segmentName);
                  return (
                    <button
                      key={seg.segmentName}
                      onClick={() => toggleSegment(seg)}
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-2 text-xs transition-all",
                        selected ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("font-semibold", selected ? "text-indigo-700" : "text-slate-700")}>
                          {seg.segmentName}
                        </span>
                        {selected && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
                      </div>
                      {seg.painPoints?.[0] && (
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{seg.painPoints[0]}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom note */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.audienceDesc")}</p>
            <textarea
              value={customNote}
              onChange={e => setCustomNote(e.target.value)}
              placeholder={t("creative.brief.builder.audiencePlaceholder")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
              rows={3}
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-1 text-xs"><ChevronLeft className="h-3.5 w-3.5" /> {t("creative.brief.builder.back")}</Button>
            <Button className="flex-1 gap-2" onClick={() => goToStep(3)}>
              {t("creative.brief.builder.continue")} <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Strategy ──────────────────────────────── */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-800">{t("creative.brief.builder.step3Title")}</h2>

          {/* Objective */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.objective")}</p>
            <div className="space-y-2">
              {OBJECTIVE_OPTIONS.map(opt => (
                <RadioCard key={opt.value} value={opt.value} selected={objective} onClick={setObjective} label={t(opt.label)} desc={t(opt.desc)} />
              ))}
            </div>
          </div>

          {/* Funnel stage */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">{t("creative.brief.builder.funnelStage")}</p>
            <div className="space-y-2">
              {FUNNEL_OPTIONS.map(opt => (
                <RadioCard key={opt.value} value={opt.value} selected={funnelStage} onClick={setFunnelStage}
                  label={t(opt.label)} desc={t(opt.tag)} />
              ))}
            </div>
          </div>

          {/* Optional fields */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-500">{t("creative.brief.builder.extra")}</p>
            <Input placeholder={t("creative.brief.builder.landingUrl")} value={landingUrl} onChange={e => setLandingUrl(e.target.value)} className="text-xs" />
            <Input placeholder={t("creative.brief.builder.usp")} value={overrideUsp} onChange={e => setOverrideUsp(e.target.value)} className="text-xs" />
            <Input placeholder={t("creative.brief.builder.cta")} value={overrideCta} onChange={e => setOverrideCta(e.target.value)} className="text-xs" />
            <Input placeholder={t("creative.brief.builder.promo")} value={promoLabel} onChange={e => setPromoLabel(e.target.value)} className="text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder={t("creative.brief.builder.dailyBudget")} value={budgetVnd} onChange={e => setBudgetVnd(e.target.value)} className="text-xs" />
              <Input placeholder={t("creative.brief.builder.durationDays")} value={durationDays} onChange={e => setDurationDays(e.target.value)} className="text-xs" />
            </div>
          </div>

          {genError && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg p-3 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {genError}
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-1 text-xs"><ChevronLeft className="h-3.5 w-3.5" /> {t("creative.brief.builder.back")}</Button>
            <Button className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700" onClick={generate} disabled={generating}>
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("creative.brief.builder.generating")}</>
                : <><Sparkles className="h-4 w-4" /> {t("creative.brief.builder.generate")}</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Result ────────────────────────────────── */}
      {step === 4 && brief && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">{t("creative.brief.builder.resultTitle")}</h2>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => { setBrief(null); setStep(1); }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t("creative.brief.builder.regenerate")}
            </Button>
          </div>
          <BriefPreview brief={brief} />
        </div>
      )}
    </div>
  );
}
