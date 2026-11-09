"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronUp, ShieldAlert, AlertTriangle,
  CheckCircle, Target, Users, Zap, MessageSquare,
  BarChart3, Globe, Mic2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BriefStatusBadge } from "./BriefStatusBadge";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CreativeBrief } from "@/lib/creative-brief/types";

// ── Section wrapper ───────────────────────────────────────────

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-slate-700">
          {icon} {title}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && <div className="p-4 space-y-3 bg-white">{children}</div>}
    </div>
  );
}

function Tag({ text, color = "slate" }: { text: string; color?: "red" | "amber" | "emerald" | "blue" | "slate" }) {
  const cls = {
    red:     "bg-red-100 text-red-700",
    amber:   "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
    blue:    "bg-blue-100 text-blue-700",
    slate:   "bg-slate-100 text-slate-600",
  }[color];
  return <span className={cn("inline-block rounded px-2 py-0.5 text-[10px] font-medium", cls)}>{text}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-slate-400 shrink-0 w-32">{label}</span>
      <span className="text-slate-800 font-medium flex-1">{value}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export function BriefPreview({ brief }: { brief: CreativeBrief }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const hasWarns = brief.complianceNotes.some(n => n.severity === "warn");

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-800">
              {brief.product.displayName} · {brief.company}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {t("creative.brief.preview.generated", { time: new Date(brief.generatedAt).toLocaleString(intlLocale) })}
            </p>
          </div>
          <BriefStatusBadge brief={brief} />
        </div>
        <p className="mt-3 text-sm text-slate-700 leading-relaxed italic">
          &ldquo;{brief.valueProposition}&rdquo;
        </p>
      </div>

      {/* Compliance notes */}
      {brief.complianceNotes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-[10px] font-bold text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {t("creative.brief.preview.compliance")}
          </p>
          {brief.complianceNotes.map((n, i) => (
            <div key={i} className="text-[10px] text-slate-700">
              <span className={cn("font-bold mr-1", n.severity === "block" ? "text-red-600" : "text-amber-600")}>
                [{n.rule}]
              </span>
              {n.suggestion}
            </div>
          ))}
        </div>
      )}

      {/* Audience */}
      <Section title={t("creative.brief.preview.audience")} icon={<Users className="h-3.5 w-3.5 text-indigo-500" />}>
        <Row label={t("creative.brief.preview.primaryPersona")} value={brief.audienceSummary.primaryPersona} />
        <Row label={t("creative.brief.preview.reach")} value={brief.audienceSummary.size} />
        <Row label={t("creative.brief.preview.sophistication")} value={brief.audienceSummary.sophistication} />
        <div>
          <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.painRanked")}</p>
          <div className="space-y-1">
            {brief.audienceSummary.topPainPoints.map((p, i) => (
              <p key={i} className="text-xs text-slate-700 flex gap-1.5">
                <span className="text-rose-400 shrink-0">•</span> {p}
              </p>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.motivators")}</p>
          <div className="flex flex-wrap gap-1">
            {brief.audienceSummary.motivators.map((m, i) => <Tag key={i} text={m} color="emerald" />)}
          </div>
        </div>
      </Section>

      {/* Message Core */}
      <Section title={t("creative.brief.preview.messageCore")} icon={<Target className="h-3.5 w-3.5 text-rose-500" />}>
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2">
          <p className="text-[10px] text-indigo-500 font-bold">{t("creative.brief.preview.usp")}</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{brief.usp}</p>
        </div>

        <div>
          <p className="text-[10px] text-slate-400 mb-1.5">{t("creative.brief.preview.productPain")}</p>
          <div className="space-y-1.5">
            {brief.painPoints.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={cn("shrink-0 rounded px-1 py-0.5 text-[9px] font-bold", p.severity === "critical" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500")}>
                  {p.severity === "critical" ? t("creative.brief.preview.crit") : t("creative.brief.preview.mod")}
                </span>
                <span className="text-slate-700">{p.text}</span>
              </div>
            ))}
          </div>
        </div>

        {brief.proofPoints.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-400 mb-1.5">{t("creative.brief.preview.proof")}</p>
            <div className="space-y-1">
              {brief.proofPoints.map((p, i) => (
                <p key={i} className="text-xs text-slate-700 flex gap-1.5 items-start">
                  <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                  {p.text}
                </p>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Tone Strategy */}
      <Section title={t("creative.brief.preview.tone")} icon={<Mic2 className="h-3.5 w-3.5 text-violet-500" />}>
        <div className="flex flex-wrap gap-1.5">
          <Tag text={brief.toneStrategy.primaryTone} color="blue" />
          {brief.toneStrategy.secondaryTone && <Tag text={brief.toneStrategy.secondaryTone} color="slate" />}
        </div>
        <p className="text-xs text-slate-700 leading-relaxed bg-violet-50 rounded-lg p-3">
          {brief.toneStrategy.voiceGuidance}
        </p>
        {brief.toneStrategy.avoid.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.avoid")}</p>
            <div className="flex flex-wrap gap-1">
              {brief.toneStrategy.avoid.map((a, i) => <Tag key={i} text={a} color="red" />)}
            </div>
          </div>
        )}
      </Section>

      {/* CTA Strategy */}
      <Section title={t("creative.brief.preview.ctaStrategy")} icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-center">
            <p className="text-[10px] text-emerald-500">{t("creative.brief.preview.primaryCta")}</p>
            <p className="text-sm font-bold text-slate-800 mt-0.5">{brief.ctaStrategy.primaryCta}</p>
          </div>
          {brief.ctaStrategy.softCta && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
              <p className="text-[10px] text-slate-400">{t("creative.brief.preview.softCta")}</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">{brief.ctaStrategy.softCta}</p>
            </div>
          )}
        </div>
        <Row label={t("creative.brief.preview.urgencyFrame")} value={
          brief.ctaStrategy.urgencyFrame === "hard" ? t("creative.brief.preview.urgencyHard")
          : brief.ctaStrategy.urgencyFrame === "soft" ? t("creative.brief.preview.urgencySoft")
          : t("creative.brief.preview.urgencyNone")
        } />
        <p className="text-[10px] text-slate-400 italic">{brief.ctaStrategy.intent}</p>
      </Section>

      {/* Meta Config */}
      {brief.metaConfig && (
        <Section title={t("creative.brief.preview.meta")} icon={<MessageSquare className="h-3.5 w-3.5 text-blue-500" />} defaultOpen={false}>
          <Row label={t("creative.brief.preview.adFormats")} value={<div className="flex gap-1 flex-wrap">{brief.metaConfig.adFormats.map(f => <Tag key={f} text={f} />)}</div>} />
          <Row label={t("creative.brief.preview.emotionalAnchor")} value={brief.metaConfig.emotionalAnchor} />
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.hook")}</p>
            <p className="text-xs text-slate-700 leading-relaxed bg-blue-50 rounded p-2">{brief.metaConfig.hookFrame}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.visual")}</p>
            <p className="text-xs text-slate-600">{brief.metaConfig.visualDirection}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.textLength")}</p>
            <Row label={t("creative.brief.preview.headline")} value={brief.metaConfig.textLengthGuidance.headline} />
            <Row label={t("creative.brief.preview.primary")} value={brief.metaConfig.textLengthGuidance.primary} />
            <Row label={t("creative.brief.preview.description")} value={brief.metaConfig.textLengthGuidance.description} />
          </div>
        </Section>
      )}

      {/* Google Config */}
      {brief.googleConfig && (
        <Section title={t("creative.brief.preview.google")} icon={<Globe className="h-3.5 w-3.5 text-red-500" />} defaultOpen={false}>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.searchIntents")}</p>
            <div className="flex flex-wrap gap-1">
              {brief.googleConfig.searchIntents.map((s, i) => <Tag key={i} text={s} color="blue" />)}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.headlineAngles")}</p>
            <div className="space-y-1">
              {brief.googleConfig.headlineAngles.map((h, i) => (
                <p key={i} className="text-xs text-slate-700 flex gap-1.5">
                  <span className="text-slate-400 shrink-0">{i + 1}.</span> {h}
                </p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.descFocus")}</p>
            <p className="text-xs text-slate-600 leading-relaxed">{brief.googleConfig.descriptionFocus}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.extensions")}</p>
            {brief.googleConfig.extensionSuggestions.map((ext, i) => (
              <div key={i} className="text-[10px] text-slate-600">
                <b className="text-slate-700">{ext.type}:</b> {ext.examples.join(" · ")}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 italic">{brief.googleConfig.keywordDensityNote}</p>
        </Section>
      )}

      {/* Playbook references — Đợt 7b */}
      {!!brief.playbookReferences?.length && (() => {
        const used = brief.playbookReferences!.filter(r => r.direction === "use");
        const avoided = brief.playbookReferences!.filter(r => r.direction === "avoid");
        return (
          <Section title={t("creative.brief.preview.playbook")} icon={<span>📒</span>} defaultOpen={false}>
            {used.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.won")}</p>
                <div className="space-y-1.5">
                  {used.map((r, i) => (
                    <div key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] text-slate-400 uppercase">{r.kind}</span>
                        <span className="text-xs text-slate-700 flex-1">{r.text}</span>
                        <Tag text={r.confidence === "high" ? t("creative.brief.preview.confHigh") : t("creative.brief.preview.confMid")} color={r.confidence === "high" ? "emerald" : "slate"} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{r.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {avoided.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-400 mb-1">{t("creative.brief.preview.avoidThese")}</p>
                <div className="space-y-1.5">
                  {avoided.map((r, i) => (
                    <div key={i} className="rounded-lg border border-red-200 bg-red-50/50 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] text-slate-400 uppercase">{r.kind}</span>
                        <span className="text-xs text-slate-700 flex-1">{r.text}</span>
                        <Tag text={r.confidence === "high" ? t("creative.brief.preview.confHigh") : t("creative.brief.preview.confMid")} color={r.confidence === "high" ? "red" : "slate"} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{r.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* Sensitive terms */}
      {brief.sensitiveTerms.length > 0 && (
        <Section title={t("creative.brief.preview.sensitive")} icon={<ShieldAlert className="h-3.5 w-3.5 text-red-500" />} defaultOpen={false}>
          <div className="flex flex-wrap gap-1">
            {brief.sensitiveTerms.map((term, i) => <Tag key={i} text={term} color="red" />)}
          </div>
        </Section>
      )}

      {/* Launch constraints */}
      {brief.launchConstraints && (
        <Section title={t("creative.brief.preview.launch")} icon={<BarChart3 className="h-3.5 w-3.5 text-slate-500" />} defaultOpen={false}>
          {brief.launchConstraints.dailyBudgetVnd && (
            <Row label={t("creative.brief.preview.dailyBudget")} value={`₫${brief.launchConstraints.dailyBudgetVnd.toLocaleString(intlLocale)}`} />
          )}
          {brief.launchConstraints.durationDays && (
            <Row label={t("creative.brief.preview.duration")} value={t("creative.brief.preview.days", { n: brief.launchConstraints.durationDays })} />
          )}
          {brief.launchConstraints.geoTarget && (
            <Row label={t("creative.brief.preview.geo")} value={brief.launchConstraints.geoTarget.join(", ")} />
          )}
          {brief.launchConstraints.budgetGuidance && (
            <p className="text-[10px] text-amber-600 bg-amber-50 rounded p-2">
              ⚠️ {brief.launchConstraints.budgetGuidance}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
