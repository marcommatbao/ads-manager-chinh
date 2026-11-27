import type { BriefDraft } from "@/lib/creative-brief/types";
export const draft: BriefDraft = {
  id: "fixture-draft", name: "Fixture", revision: 1, contentHash: "fixture-hash", createdAt: "2026-11-27T00:00:00Z", updatedAt: "2026-11-27T00:00:00Z",
  output: {
    id: "generated-fixture", generatedAt: "2026-11-27T00:00:00Z", company: "MBC", platform: "facebook", product: { key: "hosting", displayName: "Hosting", category: "test" }, objective: "conversion", funnelStage: "bottom",
    audienceSummary: { primaryPersona: "test", size: "niche", topPainPoints: [], motivators: [], sophistication: "beginner" }, painPoints: [], usp: "original", valueProposition: "value", proofPoints: [], toneStrategy: { primaryTone: "plain", voiceGuidance: "plain", avoid: [] }, ctaStrategy: { primaryCta: "Read", urgencyFrame: "none", intent: "test" }, complianceNotes: [], sensitiveTerms: [],
  },
  input: { company: "MBC", platform: "facebook", product: "hosting", objective: "conversion", funnelStage: "bottom", selectedSegments: [] },
};
