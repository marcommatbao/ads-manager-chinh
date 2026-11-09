import { Improvement, ActionPlan, ActionStep } from "@/types/improvements";
import { makeT, type TFunction } from "@/lib/i18n/translate";

export function generateActionPlan(
  improvement: Improvement,
  t: TFunction = makeT("vi")
): ActionPlan {
  switch (improvement.type) {
    case "PAUSE_FB_AD_LOW_CTR":
      return {
        improvementId: improvement.id,
        totalImpact:   improvement.impactValue || 0,
        autoSteps: 1, manualSteps: 1,
        status: "PENDING",
        steps: [
          {
            id: `${improvement.id}-pause`,
            type: "PAUSE_AD",
            platform: "FACEBOOK",
            title: t("libcase.r.ap.1"),
            description: t("libcase.r.ap.2", { v1: improvement.adName || 'Ad' }),
            entityId:   improvement.adName || improvement.id,
            entityName: improvement.adName || improvement.title,
            payload:    { status: "PAUSED" },
            canAutoApply: true,
            estimatedImpact: (improvement.impactValue || 0) * 0.3,
            before: { [t("libcase.r.ap.3")]: "ACTIVE", [t("libcase.r.ap.4")]: improvement.currentMetric || "" },
            after:  { [t("libcase.r.ap.3")]: "PAUSED", "Resolution": t("libcase.r.ap.5") },
          },
          {
            id: `${improvement.id}-creative`,
            type: "CHANGE_CREATIVE",
            platform: "FACEBOOK",
            title: t("libcase.r.ap.6"),
            description: t("libcase.r.ap.7"),
            entityId:   improvement.adName || improvement.id,
            entityName: improvement.adName || improvement.title,
            payload:    {},
            canAutoApply: false,
            estimatedImpact: (improvement.impactValue || 0) * 0.7,
            before: { "Creative": t("libcase.r.ap.8"), "CTR": t("libcase.r.ap.9") },
            after:  { "Creative": t("libcase.r.ap.10"), [t("libcase.r.ap.11")]: "> 1%" },
          },
        ],
      };

    case "DAYPART_OPPORTUNITY":
      return {
        improvementId: improvement.id,
        totalImpact:   improvement.impactValue || 0,
        autoSteps: 1, manualSteps: 0,
        status: "PENDING",
        steps: [
          {
            id: `${improvement.id}-daypart`,
            type: "SET_DAYPARTING",
            platform: improvement.platform as "FACEBOOK" | "GOOGLE",
            title: t("libcase.r.ap.12"),
            description: t("libcase.r.ap.13"),
            entityId:   improvement.campaignId || improvement.id,
            entityName: improvement.campaignName || improvement.title,
            payload:    improvement.applyPayload || {},
            canAutoApply: true,
            estimatedImpact: improvement.impactValue || 0,
            before: {
              [t("libcase.r.ap.14")]: improvement.currentMetric || "",
            },
            after: {
              [t("libcase.r.ap.15")]: improvement.targetMetric || "",
              [t("libcase.r.ap.16")]: t("libcase.r.ap.17", { v1: String(improvement.impactValue?.toLocaleString()) }),
            },
          },
        ],
      };

    case "PAUSE_FB_AD_FATIGUE":
      return {
        improvementId: improvement.id,
        totalImpact:   improvement.impactValue || 0,
        autoSteps: 1, manualSteps: 1,
        status: "PENDING",
        steps: [
          {
            id: `${improvement.id}-freq-cap`,
            type: "UPDATE_TARGETING",
            platform: "FACEBOOK",
            title: t("libcase.r.ap.18"),
            description: t("libcase.r.ap.19"),
            entityId:   improvement.adGroupName || improvement.id,
            entityName: improvement.adGroupName || improvement.title,
            payload: { status: "PAUSED" },
            canAutoApply: true,
            estimatedImpact: (improvement.impactValue || 0) * 0.5,
            before: { [t("libcase.r.ap.20")]: improvement.currentMetric || "Frequency cao" },
            after: { [t("libcase.r.ap.3")]: "PAUSED", [t("libcase.r.ap.21")]: t("libcase.r.ap.22") },
          },
          {
            id: `${improvement.id}-audience-expand`,
            type: "UPDATE_TARGETING",
            platform: "FACEBOOK",
            title: t("libcase.r.ap.23"),
            description: t("libcase.r.ap.24"),
            entityId:   improvement.adGroupName || improvement.id,
            entityName: improvement.adGroupName || improvement.title,
            payload:    {},
            canAutoApply: false,
            estimatedImpact: (improvement.impactValue || 0) * 0.5,
            before: { "Audience": t("libcase.r.ap.25") },
            after: { [t("libcase.r.ap.26")]: t("libcase.r.ap.27") },
          },
        ],
      };

    case "NEGATIVE_BRAND_LEAK":
    case "PAUSE_SEARCH_TERM":
      return {
        improvementId: improvement.id,
        totalImpact:   improvement.impactValue || 0,
        autoSteps: 1, manualSteps: 0,
        status: "PENDING",
        steps: [
          {
            id: `${improvement.id}-pause-kw`,
            type: "ADD_NEGATIVE",
            platform: "GOOGLE",
            title: t("libcase.r.ap.28"),
            description: t("libcase.r.ap.29"),
            entityId:   improvement.campaignId || improvement.id,
            entityName: improvement.campaignName || improvement.title,
            payload:    { ...improvement.applyPayload },
            canAutoApply: true,
            estimatedImpact: improvement.impactValue || 0,
            before: {
              [t("libcase.r.ap.3")]:  t("libcase.r.ap.30"),
              [t("libcase.r.ap.20")]: improvement.currentMetric || "",
            },
            after: {
              [t("libcase.r.ap.3")]:  "Negative Keyword",
              [t("libcase.r.ap.31")]:   t("libcase.r.ap.32"),
            },
          }
        ]
      };

    default:
      // Generic payload generator
      return {
        improvementId: improvement.id,
        totalImpact:   improvement.impactValue || 0,
        autoSteps: improvement.canAutoApply ? 1 : 0, 
        manualSteps: improvement.canAutoApply ? 0 : 1,
        status: "PENDING",
        steps: [
          {
            id: `${improvement.id}-step`,
            type: "UNKNOWN",
            platform: improvement.platform as "FACEBOOK" | "GOOGLE",
            title: improvement.title,
            description: improvement.description,
            entityId: improvement.id,
            entityName: improvement.title,
            payload: improvement.applyPayload || {},
            canAutoApply: improvement.canAutoApply,
            estimatedImpact: improvement.impactValue || 0,
            before: {
              [t("libcase.r.ap.3")]: improvement.currentMetric || t("libcase.r.ap.33")
            },
            after: {
              [t("libcase.r.ap.34")]: improvement.targetMetric || t("libcase.r.ap.35")
            }
          }
        ]
      };
  }
}
