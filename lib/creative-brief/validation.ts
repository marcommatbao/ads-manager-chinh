import { z } from "zod";

const text = z.string();
const strings = z.array(text);
const platform = z.enum(["facebook", "google", "both"]);
const objective = z.enum(["awareness", "consideration", "conversion", "retention"]);
const funnel = z.enum(["top", "mid", "bottom"]);
const product = z.enum(["ten-mien", "hosting", "vibe-hosting", "google-workspace", "microsoft-365", "chu-ky-so", "hoa-don-dien-tu", "khoa-hoc-thue", "sale-ai", "hop-dong-dien-tu", "hoa-don-ecom", "email-dn", "ssl", "custom"]);
// Validate without replacing the stored snapshot or changing its key order.
export const briefInputSchema = z.object({
  company: text.min(1), platform, product, objective, funnelStage: funnel,
  selectedSegments: z.array(z.object({ segmentName: text }).passthrough()),
  customAudienceNote: text.optional(), landingPageUrl: text.optional(),
  promotionContext: z.object({ label: text, discountPct: z.number().optional(), endsAt: text.optional() }).optional(),
  launchConstraints: z.object({ dailyBudgetVnd: z.number().optional(), durationDays: z.number().optional(), geoTarget: strings.optional(), deviceTarget: z.enum(["all", "mobile", "desktop"]).optional() }).optional(),
  overrides: z.object({ tone: text.optional(), mainUsp: text.optional(), cta: text.optional() }).optional(),
});
export const briefOutputSchema = z.object({
  id: text, generatedAt: text, company: text.min(1), platform,
  product: z.object({ key: product, displayName: text, category: text }), objective, funnelStage: funnel,
  audienceSummary: z.object({ primaryPersona: text, size: z.enum(["broad", "narrow", "niche"]), topPainPoints: strings, motivators: strings, sophistication: z.enum(["beginner", "intermediate", "expert"]) }),
  painPoints: z.array(z.object({ text, severity: z.enum(["critical", "moderate"]), source: z.enum(["product-kb", "segment", "competitor"]) })),
  usp: text, valueProposition: text, proofPoints: z.array(z.object({ type: z.enum(["stat", "social", "award", "case"]), text })),
  toneStrategy: z.object({ primaryTone: text, secondaryTone: text.optional(), voiceGuidance: text, avoid: strings }),
  ctaStrategy: z.object({ primaryCta: text, softCta: text.optional(), urgencyFrame: z.enum(["none", "soft", "hard"]), intent: text }),
  complianceNotes: z.array(z.object({ severity: z.enum(["block", "warn"]), rule: text, suggestion: text })), sensitiveTerms: strings,
  metaConfig: z.object({ adFormats: strings, hookFrame: text, emotionalAnchor: text, textLengthGuidance: z.object({ headline: text, primary: text, description: text }), visualDirection: text }).optional(),
  googleConfig: z.object({ searchIntents: strings, headlineAngles: strings, descriptionFocus: text, extensionSuggestions: z.array(z.object({ type: text, examples: strings })), keywordDensityNote: text }).optional(),
  playbookReferences: z.array(z.object({ entryId: text, platform: z.enum(["facebook", "google"]), direction: z.enum(["use", "avoid"]), kind: text, text, why: text, confidence: z.enum(["high", "medium"]) })).optional(),
  landingPageContext: z.object({ url: text, inferredPageType: text.optional(), alignment: z.enum(["good", "mismatch", "unknown"]), notes: text.optional() }).optional(),
  promotionContext: z.object({ label: text, discountPct: z.number().optional(), endsAt: text.optional(), ctaUrgencyBoost: z.boolean() }).optional(),
  launchConstraints: z.object({ dailyBudgetVnd: z.number().optional(), durationDays: z.number().optional(), geoTarget: strings.optional(), deviceTarget: text.optional(), budgetGuidance: text.optional() }).optional(),
});
