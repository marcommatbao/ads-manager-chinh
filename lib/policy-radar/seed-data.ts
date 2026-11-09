// ─────────────────────────────────────────────
// Policy Radar — Seed data
//
// These 4 items are real, hand-verified current policy changes — not
// placeholders. The 3 Google Ads items were confirmed by directly fetching
// the official support.google.com pages (title/date/scope quoted from the
// page itself). The 1 Meta item could NOT be confirmed by fetching Meta's
// own pages (they return an empty JS shell — see source-registry.ts), so it
// is marked verifiedFromSource: false and sourced from third-party trade
// coverage instead, with the real official Meta URL attached for manual
// verification. No item here is fabricated or estimated.
// ─────────────────────────────────────────────

import { classifyImpact } from "./impact-classifier";
import { mapAffectedModules, mapRecommendedActions } from "./action-mapper";
import type { PolicyRadarItem } from "./types";

function buildItem(
  input: Omit<PolicyRadarItem, "affectedAreas" | "affectedModules" | "recommendedActions" | "severity" | "status" | "reviewedBy" | "reviewedAt" | "internalNote" | "addedBy">
): PolicyRadarItem {
  const { severity, affectedAreas } = classifyImpact({ category: input.category, changeType: input.changeType });
  return {
    ...input,
    severity,
    affectedAreas,
    affectedModules: mapAffectedModules(affectedAreas),
    recommendedActions: mapRecommendedActions(affectedAreas),
    status: "unread",
    reviewedBy: null,
    reviewedAt: null,
    internalNote: null,
    addedBy: "system:curated",
  };
}

export const POLICY_RADAR_SEED: PolicyRadarItem[] = [
  buildItem({
    id: "google-ai-labelling-2026-07",
    platform: "google_ads",
    category: "creative",
    changeType: "policy_update",
    title: "Updates to AI labelling requirements",
    sourceUrl: "https://support.google.com/adspolicy/answer/17257106?hl=en-IE",
    sourceLabel: "Google Ads Advertising Policies Help",
    sourceType: "official_policy",
    official: true,
    verifiedFromSource: true,
    publishedAt: "2026-07-09",
    discoveredAt: "2026-07-16T00:00:00.000Z",
    summaryShort:
      "Google now lets advertisers add text/visual AI-disclosure labels directly inside image and video ad creatives generated or modified with AI, to meet EU/India/New York transparency rules — and may auto-apply labels itself.",
    whyItMatters:
      "If you run AI-generated or AI-edited creative targeting EU, India, or New York, you may soon need a visible AI label on it — and Google's own systems can add that label automatically, which changes your creative without a manual step in between.",
    tags: ["ai-disclosure", "creative", "eu", "india", "new-york"],
  }),
  buildItem({
    id: "google-limited-ad-serving-2026-06",
    platform: "google_ads",
    category: "enforcement",
    changeType: "enforcement_change",
    title: "Updates to Limited ad serving Policy",
    sourceUrl: "https://support.google.com/adspolicy/answer/17122370?hl=en",
    sourceLabel: "Google Ads Advertising Policies Help",
    sourceType: "official_policy",
    official: true,
    verifiedFromSource: true,
    publishedAt: "2026-06-12",
    discoveredAt: "2026-07-16T00:00:00.000Z",
    summaryShort:
      "Google expanded its Limited Ad Serving policy on Search: advertisers with persistent negative user reports, or ads lacking clear advertiser branding, can have impressions throttled — rolling out gradually through 2028.",
    whyItMatters:
      "This throttles reach quietly instead of an outright disapproval — ads that don't clearly show who's advertising are a specific trigger, so it's worth a branding pass on Search creative now rather than after impressions already dropped.",
    tags: ["search", "ad-serving", "branding"],
  }),
  buildItem({
    id: "google-lsa-policy-rename-2026-06",
    platform: "google_ads",
    category: "product_update",
    changeType: "clarification",
    title: "Local Services Ads policy update",
    sourceUrl: "https://support.google.com/adspolicy/answer/17083421?hl=en",
    sourceLabel: "Google Ads Advertising Policies Help",
    sourceType: "official_policy",
    official: true,
    verifiedFromSource: true,
    publishedAt: "2026-06-05",
    discoveredAt: "2026-07-16T00:00:00.000Z",
    summaryShort:
      "Posted June 5, 2026, effective July 31, 2026: Google is renaming Local Services Ads \"platform policies\" to \"Local Services Ads requirements\", updating terminology and removing policies that no longer apply.",
    whyItMatters:
      "Mostly a wording/structure cleanup, not a new restriction — but if you run Local Services Ads, worth a quick skim before July 31 to confirm nothing you currently rely on was quietly removed in the rename.",
    tags: ["local-services-ads", "terminology"],
  }),
  buildItem({
    id: "meta-partnership-ads-mandatory-2026",
    platform: "meta",
    category: "policy",
    changeType: "policy_update",
    title: "Partnership Ads format required for paid/branded creator content (unverified — see note)",
    sourceUrl: "https://help.instagram.com/1372533836927082",
    sourceLabel: "Instagram Help Center — Eligibility requirements for partnership ads and branded content (official page; content could not be auto-verified)",
    sourceType: "official_help",
    official: true,
    verifiedFromSource: false,
    publishedAt: null,
    discoveredAt: "2026-07-16T00:00:00.000Z",
    summaryShort:
      "Multiple independent trade-press sources report Meta now requires all paid/branded creator content on Facebook and Instagram to run through the Partnership Ads format, with plain-ad workarounds risking rejection or an account-health penalty. Meta's own help page on this could not be fetched to confirm wording/date directly — verify at the source link before acting.",
    whyItMatters:
      "If your team runs influencer or UGC campaigns, creative that isn't tagged through Partnership Ads may start getting rejected — but since this couldn't be confirmed against Meta's own page text, treat it as a lead to verify, not a confirmed rule, until someone checks the source link.",
    tags: ["branded-content", "partnership-ads", "influencer", "unverified"],
  }),
];
