// ============================================================
// Creative Brief — Orchestrator
// buildBrief(input) → CreativeBrief  (pure; no I/O except KB reads)
// ============================================================

import { randomUUID } from "crypto";
import type { BriefInput, CreativeBrief } from "./types";
import { resolveProduct } from "./product-resolver";
import { resolveAudience } from "./audience-resolver";
import { deriveTone } from "./tone-engine";
import { deriveCta } from "./cta-engine";
import { adaptForMeta, adaptForGoogle } from "./platform-adapter";
import { runCompliance, getSensitiveTerms } from "./compliance";
import { makeT, type TFunction } from "@/lib/i18n/translate";

function inferLandingPageType(url: string): string {
  if (/pricing|gia|bang-gia/i.test(url))  return "pricing";
  if (/blog|news|bai-viet/i.test(url))    return "blog";
  if (/promo|khuyen-mai|deal/i.test(url)) return "promo";
  return "product";
}

function inferLandingAlignment(
  url: string,
  productKey: string,
): "good" | "mismatch" | "unknown" {
  const knownDomains = ["matbao.net", "matbao.in", "sale.ai.vn"];
  try {
    const { hostname } = new URL(url);
    if (!knownDomains.some(d => hostname.endsWith(d))) return "mismatch";
    // Product in URL path? rough check
    if (url.toLowerCase().includes(productKey.replace(/-/g, ""))) return "good";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function buildValueProposition(
  usp: string,
  persona: string,
  funnelStage: "top" | "mid" | "bottom",
): string {
  const frames: Record<typeof funnelStage, string> = {
    top:    `Dành cho ${persona} đang cần giải pháp — ${usp}.`,
    mid:    `${usp}: lý do ${persona} chọn Mat Bao thay vì đối thủ.`,
    bottom: `${persona} đang hành động hôm nay — ${usp} là lý do cuối cùng.`,
  };
  return frames[funnelStage];
}

export function buildBrief(input: BriefInput, t: TFunction = makeT("vi")): CreativeBrief {
  const {
    company, platform, product, objective, funnelStage,
    selectedSegments, customAudienceNote,
    landingPageUrl, promotionContext, launchConstraints,
    overrides,
  } = input;

  // ── [1] Validate ──────────────────────────────────────────
  if (!company || !product || !objective || !funnelStage) {
    throw new Error("Missing required fields: company, product, objective, funnelStage");
  }
  if (objective === "retention" && funnelStage === "top") {
    throw new Error("Retention objective is incompatible with top-of-funnel. Use mid or bottom.");
  }

  // ── [2] Resolve product ───────────────────────────────────
  const resolvedProduct = resolveProduct(company, product, funnelStage);

  // ── [3] Resolve audience ──────────────────────────────────
  const audienceSummary = resolveAudience(company, selectedSegments, customAudienceNote);

  // ── [4] Tone ──────────────────────────────────────────────
  const toneStrategy = deriveTone(company, objective, funnelStage, overrides?.tone);

  // ── [5] CTA ───────────────────────────────────────────────
  const ctaStrategy = deriveCta(funnelStage, objective, platform, promotionContext, overrides?.cta);

  // ── [6] USP + proof ───────────────────────────────────────
  const usp = overrides?.mainUsp ?? resolvedProduct.usps[0] ?? resolvedProduct.displayName;

  // ── [7] Platform config ───────────────────────────────────
  const metaConfig = (platform === "facebook" || platform === "both")
    ? adaptForMeta(resolvedProduct, audienceSummary, toneStrategy, funnelStage, objective)
    : undefined;

  const googleConfig = (platform === "google" || platform === "both")
    ? adaptForGoogle(resolvedProduct, audienceSummary, toneStrategy, funnelStage, objective)
    : undefined;

  // ── [8] Landing page context ──────────────────────────────
  const landingPageContext = landingPageUrl ? {
    url:              landingPageUrl,
    inferredPageType: inferLandingPageType(landingPageUrl),
    alignment:        inferLandingAlignment(landingPageUrl, product),
    notes: inferLandingAlignment(landingPageUrl, product) === "mismatch"
      ? t("libmeta.cb.landingMismatch")
      : undefined,
  } : undefined;

  // ── Assemble draft brief (before compliance) ──────────────
  const draft: Omit<CreativeBrief, "complianceNotes" | "sensitiveTerms"> = {
    id:          randomUUID(),
    generatedAt: new Date().toISOString(),
    company,
    platform,
    product:     { key: product, displayName: resolvedProduct.displayName, category: resolvedProduct.category },
    objective,
    funnelStage,
    audienceSummary,
    painPoints:      resolvedProduct.painPoints.slice(0, 5),
    usp,
    valueProposition: buildValueProposition(usp, audienceSummary.primaryPersona, funnelStage),
    proofPoints:     resolvedProduct.proofPoints,
    toneStrategy,
    ctaStrategy,
    metaConfig,
    googleConfig,
    landingPageContext,
    promotionContext: promotionContext
      ? { ...promotionContext, ctaUrgencyBoost: ctaStrategy.urgencyFrame !== "none" }
      : undefined,
    launchConstraints: launchConstraints ? {
      ...launchConstraints,
      budgetGuidance: (launchConstraints.dailyBudgetVnd ?? 0) > 0 && (launchConstraints.dailyBudgetVnd ?? 0) < 200_000
        ? t("libmeta.cb.budgetGuidance")
        : undefined,
    } : undefined,
  };

  // ── [8] Compliance ────────────────────────────────────────
  const complianceNotes = runCompliance(draft, t);
  const blockers = complianceNotes.filter(n => n.severity === "block");
  if (blockers.length > 0) {
    throw new Error(`Brief blocked by compliance: ${blockers.map(b => b.rule).join(", ")}`);
  }

  return {
    ...draft,
    complianceNotes,
    sensitiveTerms: getSensitiveTerms(platform, funnelStage),
  };
}
