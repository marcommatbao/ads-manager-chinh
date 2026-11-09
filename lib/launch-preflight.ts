import { checkPMaxImageCompleteness } from "./google-image-asset";
import { normalizeAdTexts, GOOGLE_PMAX_MAX } from "./creative-limits";
// ============================================================
// Launch Preflight Validation Engine
//
// Runs before any real platform action (Meta campaign create,
// Google Ads mutate) to catch misconfigurations early.
//
// Three-tier output:
//   ready_to_launch   — proceed immediately
//   ready_with_warnings — proceed with user acknowledgement
//   blocked           — hard-stop, cannot launch
// ============================================================

import type { LaunchConfig } from "@/lib/creative-pipeline";
import { checkCreativeLimits, GOOGLE_RSA_LIMITS, GOOGLE_PMAX_LIMITS } from "@/lib/creative-limits";
import { runGeneratedCompliance } from "@/lib/creative-brief/compliance";
import { makeT, type TFunction } from "@/lib/i18n/translate";

// ── Types ─────────────────────────────────────────────────────

export type PreflightSeverity = "error" | "warning" | "info";
export type PreflightStatus   = "ready_to_launch" | "ready_with_warnings" | "blocked";

export interface PreflightCheck {
  field:    string;
  severity: PreflightSeverity;
  code:     string;
  message:  string;
  fix:      string;
  platform: "meta" | "google" | "both";
  company:  string;
}

export interface PreflightResult {
  status:   PreflightStatus;
  checks:   PreflightCheck[];
  errors:   PreflightCheck[];
  warnings: PreflightCheck[];
}

// ── Meta / Facebook preflight ─────────────────────────────────

const MIN_BUDGET_VND      = 100_000;
const WARN_BUDGET_CBO_VND = 200_000;
const WARN_BUDGET_ABO_VND = 150_000;

const GENERIC_NAME_PATTERNS = [
  /^(test|testing|thử|campaign|campaign mới|new campaign|untitled|draft|mới)\s*\d*$/i,
];

const GENERIC_CREATIVE_PATTERNS = [
  /lorem ipsum/i,
  /sample text/i,
  /your headline here/i,
  /tiêu đề mẫu/i,
  /nội dung mẫu/i,
  /placeholder/i,
];

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function runPreflightMeta(config: LaunchConfig, company: string, t: TFunction = makeT("vi")): PreflightResult {
  const nl = t("libmeta.numLocale");
  const checks: PreflightCheck[] = [];

  const add = (
    severity: PreflightSeverity,
    code:     string,
    field:    string,
    message:  string,
    fix:      string,
  ) => checks.push({ field, severity, code, message, fix, platform: "meta", company });

  // ── 1. Campaign name ─────────────────────────────────────────
  const name = config.campaignName?.trim() ?? "";
  if (!name) {
    add("error", "MISSING_CAMPAIGN_NAME", "campaignName",
      t("libmeta.pf.nameEmpty"),
      t("libmeta.pf.nameEmptyFix"));
  } else if (name.length < 3) {
    add("error", "CAMPAIGN_NAME_TOO_SHORT", "campaignName",
      t("libmeta.pf.nameShort", { n: name.length }),
      t("libmeta.pf.nameShortFix"));
  } else if (GENERIC_NAME_PATTERNS.some(p => p.test(name))) {
    add("warning", "GENERIC_CAMPAIGN_NAME", "campaignName",
      t("libmeta.pf.nameGeneric", { name }),
      t("libmeta.pf.nameGenericFix"));
  }

  // ── 2. Facebook Page ─────────────────────────────────────────
  if (!config.pageId) {
    add("error", "MISSING_PAGE", "pageId",
      t("libmeta.pf.noPage"),
      t("libmeta.pf.noPageFix"));
  }

  // ── 3. Creatives ─────────────────────────────────────────────
  const selected = (config.creatives ?? []).filter(c => c.selected);
  if (selected.length === 0) {
    add("error", "NO_CREATIVES", "creatives",
      t("libmeta.pf.noCreatives"),
      t("libmeta.pf.noCreativesFix"));
  } else {
    const genericCount = selected.filter(c =>
      GENERIC_CREATIVE_PATTERNS.some(p => p.test(c.headline ?? "") || p.test(c.primaryText ?? ""))
    ).length;
    if (genericCount > 0) {
      add("warning", "GENERIC_CREATIVE", "creatives",
        t("libmeta.pf.genericCreative", { n: genericCount }),
        t("libmeta.pf.genericCreativeFix"));
    }

    // Low-score creatives (use detailedScore if available, else raw 1-10 score)
    const lowCount = selected.filter(c => {
      if (c.detailedScore) return c.detailedScore.total < 40;
      if (c.score !== undefined) return c.score < 4;
      return false;
    }).length;
    if (lowCount > 0) {
      add("warning", "LOW_SCORE_CREATIVES", "creatives",
        t("libmeta.pf.lowScore", { n: lowCount }),
        t("libmeta.pf.lowScoreFix"));
    }

    // Missing media — an "existing post" ad reuses the live post's own
    // image/video (object_story_id), but a standard creative only ever
    // sends link_data to Meta; without image_hash that's a bare text
    // link card, which Meta frequently rejects or renders broken.
    // launch-campaign/route.ts only sets image_hash "if present" — it
    // never enforced that it *be* present, so this was launchable before.
    const missingMedia = selected.filter(c => !c.isExistingPost && !c.objectStoryId && !c.imageHash);
    if (missingMedia.length > 0) {
      add("error", "MISSING_CREATIVE_MEDIA", "creatives",
        t("libmeta.pf.noMedia", { n: missingMedia.length }),
        t("libmeta.pf.noMediaFix"));
    }

    // Re-check character limits against the actual current text — the AI
    // is only *asked* to respect these limits at generation time, and text
    // may have been hand-edited since. This is the last gate before the
    // real Facebook Ads API call, which truncates/rejects over-limit text.
    const overLimit = selected
      .map(c => ({ creative: c, violations: checkCreativeLimits(c.platform === "google" ? "google" : "facebook", c) }))
      .filter(r => r.violations.length > 0);
    if (overLimit.length > 0) {
      const detail = overLimit
        .slice(0, 3)
        .map(r => `"${r.creative.headline.slice(0, 24)}${r.creative.headline.length > 24 ? "…" : ""}": ${r.violations.map(v => `${v.field} ${v.length}/${v.limit}`).join(", ")}`)
        .join(" | ");
      // CẢNH BÁO, KHÔNG CHẶN — đo trực tiếp trên Meta 25/08/2026 bằng
      // validate_only (app/api/creative/diagnose-text-limits), 4 biến thể:
      //   A. trong hạn 40/125/30        → Meta CHẤP NHẬN  (đối chứng)
      //   B. primaryText 154/125        → Meta CHẤP NHẬN
      //   C. headline 45/40             → Meta CHẤP NHẬN
      //   D. description 33/30          → Meta CHẤP NHẬN
      //
      // Tức 125/40/30 là mức KHUYẾN NGHỊ HIỂN THỊ của Ads Manager, không phải
      // giới hạn API. Chú thích cũ trong lib/creative-limits.ts ("chỉ lộ ra khi
      // Facebook API từ chối lúc launch") là một khẳng định chưa từng được kiểm,
      // và nó khiến preflight CHẶN launch vì một giới hạn không tồn tại — người
      // dùng bị chặn nhiều lần trong ngày 25/08 vì đúng dòng này.
      //
      // Vẫn giữ cảnh báo: vượt mức khuyến nghị thì Facebook cắt chữ kèm "Xem
      // thêm", người lướt không đọc hết. Đó là lý do đáng để viết ngắn lại —
      // nhưng là lựa chọn của người viết, không phải rào chặn của hệ thống.
      //
      // LƯU Ý: giới hạn Google RSA (30/90) thì CỨNG THẬT — Google API từ chối.
      // Chỗ đó nằm ở runPreflightGoogleSearch, không đụng tới.
      add("warning", "CREATIVE_OVER_CHAR_LIMIT", "creatives",
        t("libmeta.pf.overLimit", { n: overLimit.length, detail, more: overLimit.length > 3 ? " …" : "" }),
        t("libmeta.pf.overLimitFix"));
    }

    // Re-check compliance against the actual current text — text may have
    // been hand-edited since generation. Only the BLOCK-severity rule
    // (uptime overclaim) hard-stops launch here; WARN-severity notes are
    // surfaced to the user at generation time but never blocked launch,
    // matching buildBrief()'s own behavior.
    const blockedCreatives = selected
      .map(c => ({
        creative: c,
        notes: runGeneratedCompliance({
          headline: c.headline, primaryText: c.primaryText, description: c.description, cta: c.cta,
          platform: c.platform === "google" ? "google" : "facebook",
          funnelStage: c.funnelStage,
          productKey: c.productKey,
        }, t).filter(n => n.severity === "block"),
      }))
      .filter(r => r.notes.length > 0);
    if (blockedCreatives.length > 0) {
      const detail = blockedCreatives
        .slice(0, 3)
        .map(r => `"${r.creative.headline.slice(0, 24)}${r.creative.headline.length > 24 ? "…" : ""}": ${r.notes.map(n => n.rule).join(", ")}`)
        .join(" | ");
      add("error", "CREATIVE_COMPLIANCE_BLOCK", "creatives",
        t("libmeta.pf.complianceBlock", { n: blockedCreatives.length, detail, more: blockedCreatives.length > 3 ? " …" : "" }),
        t("libmeta.pf.complianceBlockFix"));
    }
  }

  // ── 4. Destination URL ───────────────────────────────────────
  if (!config.destinationUrl?.trim()) {
    add("error", "MISSING_DESTINATION_URL", "destinationUrl",
      t("libmeta.pf.noUrl"),
      t("libmeta.pf.noUrlFix"));
  } else if (!isValidUrl(config.destinationUrl)) {
    add("error", "INVALID_DESTINATION_URL", "destinationUrl",
      t("libmeta.pf.badUrl", { url: config.destinationUrl.slice(0, 60) }),
      t("libmeta.pf.badUrlFix"));
  } else if (config.destinationUrl.startsWith("http://")) {
    add("warning", "INSECURE_DESTINATION_URL", "destinationUrl",
      t("libmeta.pf.httpUrl"),
      t("libmeta.pf.httpUrlFix"));
  }

  // ── 5. Budget ────────────────────────────────────────────────
  if (config.budgetType === "cbo") {
    const budget = config.dailyBudget ?? 0;
    if (budget < MIN_BUDGET_VND) {
      add("error", "LOW_CBO_BUDGET", "dailyBudget",
        t("libmeta.pf.cboLow", { b: budget.toLocaleString(nl), min: MIN_BUDGET_VND.toLocaleString(nl) }),
        t("libmeta.pf.cboLowFix"));
    } else if (budget < WARN_BUDGET_CBO_VND) {
      add("warning", "LOW_CBO_BUDGET_WARN", "dailyBudget",
        t("libmeta.pf.cboWarn", { b: budget.toLocaleString(nl), rec: WARN_BUDGET_CBO_VND.toLocaleString(nl) }),
        t("libmeta.pf.cboWarnFix"));
    }
  } else {
    const aboVal = config.adSetDailyBudget ?? (config.adsetBudget ?? 0);
    if (aboVal < MIN_BUDGET_VND) {
      add("error", "LOW_ABO_BUDGET", "adSetDailyBudget",
        t("libmeta.pf.aboLow", { b: aboVal.toLocaleString(nl) }),
        t("libmeta.pf.aboLowFix"));
    } else if (aboVal < WARN_BUDGET_ABO_VND) {
      add("warning", "LOW_ABO_BUDGET_WARN", "adSetDailyBudget",
        t("libmeta.pf.aboWarn", { b: aboVal.toLocaleString(nl), rec: WARN_BUDGET_ABO_VND.toLocaleString(nl) }),
        t("libmeta.pf.aboWarnFix"));
    }
  }

  // ── 6. Bid strategy constraints ──────────────────────────────
  if (
    (config.bidStrategy === "COST_CAP" || config.bidStrategy === "BID_CAP") &&
    !config.bidAmount
  ) {
    add("error", "MISSING_BID_AMOUNT", "bidAmount",
      t("libmeta.pf.bidAmount", { strategy: config.bidStrategy }),
      t("libmeta.pf.bidAmountFix"));
  }

  // ── 7. Date logic ────────────────────────────────────────────
  if (config.startDate) {
    const start = new Date(config.startDate);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 0);
    if (start < yesterday) {
      add("warning", "START_DATE_PAST", "startDate",
        t("libmeta.pf.startPast", { date: config.startDate }),
        t("libmeta.pf.startPastFix"));
    }
  }
  if (!config.continuous && config.endDate && config.startDate) {
    const start = new Date(config.startDate);
    const end   = new Date(config.endDate);
    if (end <= start) {
      add("error", "INVALID_DATE_RANGE", "endDate",
        t("libmeta.pf.dateRange"),
        t("libmeta.pf.dateRangeFix"));
    }
  }

  // ── 8. Pixel + objective alignment ──────────────────────────
  // OUTCOME_SALES and OUTCOME_LEADS both map to optimization_goal
  // OFFSITE_CONVERSIONS (see OBJECTIVE_MAP in lib/creative-pipeline.ts),
  // which Meta hard-requires a promoted_object (pixel) for — without it,
  // ad-set creation is rejected with a confusingly generic "select an
  // audience for the ad set" error (confirmed live) that has nothing to do
  // with targeting, but triggers the same fallback chain that ends in
  // broad Advantage+ targeting. Previously this check only ran for
  // OUTCOME_SALES, so OUTCOME_LEADS launches with no pixel got no warning
  // at all before hitting that confusing failure.
  if (config.objectiveKey === "OUTCOME_SALES" || config.objectiveKey === "OUTCOME_LEADS") {
    if (!config.pixelId) {
      add("warning", "MISSING_PIXEL_FOR_CONVERSIONS", "pixelId",
        t("libmeta.pf.noPixel"),
        t("libmeta.pf.noPixelFix"));
    } else if (!config.pixelEvent && config.objectiveKey === "OUTCOME_SALES") {
      add("warning", "MISSING_PIXEL_EVENT", "pixelEvent",
        t("libmeta.pf.noPixelEvent"),
        t("libmeta.pf.noPixelEventFix"));
    }
  }

  // ── 9. Audience segments ────────────────────────────────────
  if (!config.segments || config.segments.length === 0) {
    add("error", "NO_SEGMENTS", "segments",
      t("libmeta.pf.noSegments"),
      t("libmeta.pf.noSegmentsFix"));
  } else {
    const emptyInterestSegs = config.segments.filter(s =>
      !s.winningAudienceId && // Đợt 26c: tệp thắng mang sẵn nhắm chọn đã lưu
      (!s.interests        || s.interests.length === 0) &&
      (!s.behaviors        || s.behaviors.length === 0) &&
      (!s.customAudienceIds || s.customAudienceIds.length === 0) &&
      (!s.resolvedInterestIds || s.resolvedInterestIds.length === 0)
    );
    if (emptyInterestSegs.length > 0 && !config.useAdvantageAudience) {
      add("warning", "EMPTY_INTEREST_SEGMENTS", "segments",
        t("libmeta.pf.emptySegments", { n: emptyInterestSegs.length }),
        t("libmeta.pf.emptySegmentsFix"));
    }
  }

  // ── Derive final status ──────────────────────────────────────
  const errors   = checks.filter(c => c.severity === "error");
  const warnings = checks.filter(c => c.severity === "warning");
  const status: PreflightStatus =
    errors.length   > 0 ? "blocked" :
    warnings.length > 0 ? "ready_with_warnings" : "ready_to_launch";

  return { status, checks, errors, warnings };
}

// ── Google Search preflight ───────────────────────────────────

export interface GoogleSearchPreflightInput {
  company?:         string;
  googleCreativeId?: string;
  dailyBudgetVnd?:  number;
  campaignName?:    string;
  rsa?: {
    headlines?:    Array<{ text: string; isValid?: boolean }>;
    descriptions?: Array<{ text: string; isValid?: boolean }>;
  };
  keywords?: {
    keywords?: Array<{ keyword: string }>;
  };
}

export function runPreflightGoogleSearch(payload: GoogleSearchPreflightInput, t: TFunction = makeT("vi")): PreflightResult {
  const checks: PreflightCheck[] = [];
  const nl = t("libmeta.numLocale");
  const company = payload.company ?? "MBC";

  const add = (
    severity: PreflightSeverity, code: string, field: string, message: string, fix: string,
  ) => checks.push({ field, severity, code, message, fix, platform: "google", company });

  if (!payload.googleCreativeId) {
    add("error", "MISSING_CREATIVE_ID", "googleCreativeId",
      t("libmeta.pf.gNoCreative"), t("libmeta.pf.gNoCreativeFix"));
  }

  const name = payload.campaignName?.trim() ?? "";
  if (!name) {
    add("error", "MISSING_CAMPAIGN_NAME", "campaignName",
      t("libmeta.pf.gsNameEmpty"), t("libmeta.pf.gsNameEmptyFix"));
  }

  const budget = payload.dailyBudgetVnd ?? 0;
  if (budget < MIN_BUDGET_VND) {
    add("error", "LOW_BUDGET", "dailyBudgetVnd",
      t("libmeta.pf.gsBudgetLow", { b: budget.toLocaleString(nl) }),
      t("libmeta.pf.gsBudgetLowFix"));
  } else if (budget < WARN_BUDGET_CBO_VND) {
    add("warning", "LOW_BUDGET_WARN", "dailyBudgetVnd",
      t("libmeta.pf.gsBudgetWarn", { b: budget.toLocaleString(nl), rec: WARN_BUDGET_CBO_VND.toLocaleString(nl) }),
      t("libmeta.pf.gsBudgetWarnFix"));
  }

  if (payload.rsa) {
    // Recompute from actual text length rather than trusting the caller's
    // self-reported isValid — that flag comes from Gemini's own char count,
    // which is never verified (see lib/creative-limits.ts).
    const validHeadlines    = (payload.rsa.headlines    ?? []).filter(h => (h.text?.length ?? 0) <= GOOGLE_RSA_LIMITS.headline);
    const validDescriptions = (payload.rsa.descriptions ?? []).filter(d => (d.text?.length ?? 0) <= GOOGLE_RSA_LIMITS.description);

    if (validHeadlines.length < 3) {
      add("error", "RSA_INSUFFICIENT_HEADLINES", "rsa.headlines",
        t("libmeta.pf.rsaFewH", { n: validHeadlines.length }),
        t("libmeta.pf.rsaFewHFix"));
    } else if (validHeadlines.length < 10) {
      add("warning", "RSA_FEW_HEADLINES", "rsa.headlines",
        t("libmeta.pf.rsaWarnH", { n: validHeadlines.length }),
        t("libmeta.pf.rsaWarnHFix"));
    }

    if (validDescriptions.length < 2) {
      add("error", "RSA_INSUFFICIENT_DESCRIPTIONS", "rsa.descriptions",
        t("libmeta.pf.rsaFewD", { n: validDescriptions.length }),
        t("libmeta.pf.rsaFewDFix"));
    }
  }

  if (payload.keywords) {
    const kwCount = (payload.keywords.keywords ?? []).length;
    if (kwCount === 0) {
      add("error", "NO_KEYWORDS", "keywords.keywords",
        t("libmeta.pf.noKeywords"), t("libmeta.pf.noKeywordsFix"));
    }
  }

  const errors   = checks.filter(c => c.severity === "error");
  const warnings = checks.filter(c => c.severity === "warning");
  const status: PreflightStatus =
    errors.length   > 0 ? "blocked" :
    warnings.length > 0 ? "ready_with_warnings" : "ready_to_launch";

  return { status, checks, errors, warnings };
}

// ── Google PMax preflight ─────────────────────────────────────

const WARN_PMAX_BUDGET_VND = 300_000;

export interface GooglePMaxPreflightInput {
  company?:         string;
  googleCreativeId?: string;
  dailyBudgetVnd?:  number;
  campaignName?:    string;
  pmax?: {
    headlines?:      string[];
    longHeadlines?:  string[];
    descriptions?:   string[];
    businessName?:   string;
  };
  /** fieldType của các ảnh sẽ gắn vào nhóm tài sản (MARKETING_IMAGE,
   *  SQUARE_MARKETING_IMAGE, LOGO…). Thiếu ảnh bắt buộc thì campaign tạo
   *  xong Google KHÔNG chạy. */
  imageFieldTypes?: string[];
}

export function runPreflightGooglePMax(payload: GooglePMaxPreflightInput, t: TFunction = makeT("vi")): PreflightResult {
  const checks: PreflightCheck[] = [];
  const nl = t("libmeta.numLocale");
  const company = payload.company ?? "MBC";

  const add = (
    severity: PreflightSeverity, code: string, field: string, message: string, fix: string,
  ) => checks.push({ field, severity, code, message, fix, platform: "google", company });

  if (!payload.googleCreativeId) {
    add("error", "MISSING_CREATIVE_ID", "googleCreativeId",
      t("libmeta.pf.gNoCreative"), t("libmeta.pf.gNoCreativeFix"));
  }

  const name = payload.campaignName?.trim() ?? "";
  if (!name) {
    add("error", "MISSING_CAMPAIGN_NAME", "campaignName",
      t("libmeta.pf.pmNameEmpty"), t("libmeta.pf.pmNameEmptyFix"));
  }

  const budget = payload.dailyBudgetVnd ?? 0;
  if (budget < MIN_BUDGET_VND) {
    add("error", "LOW_PMAX_BUDGET", "dailyBudgetVnd",
      t("libmeta.pf.pmBudgetLow", { b: budget.toLocaleString(nl) }),
      t("libmeta.pf.pmBudgetLowFix"));
  } else if (budget < WARN_PMAX_BUDGET_VND) {
    add("warning", "LOW_PMAX_BUDGET_WARN", "dailyBudgetVnd",
      t("libmeta.pf.pmBudgetWarn", { b: budget.toLocaleString(nl), rec: WARN_PMAX_BUDGET_VND.toLocaleString(nl) }),
      t("libmeta.pf.pmBudgetWarnFix"));
  }

  if (payload.pmax) {
    // Qua normalizeAdTexts vì dữ liệu lưu là mảng OBJECT {text,...}, không phải
    // mảng chuỗi. Bản cũ đọc `.length` của từng phần tử nên với object luôn ra
    // undefined → lọc sạch → chặn mọi lần launch với thông báo "hiện có 0".
    const nH  = normalizeAdTexts(payload.pmax.headlines,     GOOGLE_PMAX_LIMITS.headline,     GOOGLE_PMAX_MAX.headline);
    const nLH = normalizeAdTexts(payload.pmax.longHeadlines, GOOGLE_PMAX_LIMITS.longHeadline, GOOGLE_PMAX_MAX.longHeadline);
    const nD  = normalizeAdTexts(payload.pmax.descriptions,  GOOGLE_PMAX_LIMITS.description,  GOOGLE_PMAX_MAX.description);
    const headlines = nH.kept.length, longHeadlines = nLH.kept.length, descriptions = nD.kept.length;

    // Dòng vượt ký tự sẽ bị BỎ khi gửi lên Google. Trước đây chuyện đó xảy ra
    // lặng lẽ — người dùng thấy 5 mô tả trên màn hình, Google nhận 4.
    for (const [field, n] of [["headlines", nH], ["longHeadlines", nLH], ["descriptions", nD]] as const) {
      for (const tl of n.tooLong) {
        add("warning", "PMAX_TEXT_TOO_LONG", `pmax.${field}`,
          t("libmeta.pf.pmTooLong", { over: tl.length - tl.limit, len: tl.length, limit: tl.limit, text: tl.text.slice(0, 60), ellipsis: tl.text.length > 60 ? "…" : "" }),
          t("libmeta.pf.pmTooLongFix"));
      }
    }

    if (headlines < 3) {
      add("error", "PMAX_INSUFFICIENT_HEADLINES", "pmax.headlines",
        t("libmeta.pf.pmFewH", { n: headlines }),
        t("libmeta.pf.pmFewHFix"));
    } else if (headlines < 5) {
      add("warning", "PMAX_FEW_HEADLINES", "pmax.headlines",
        t("libmeta.pf.pmWarnH", { n: headlines }),
        t("libmeta.pf.pmWarnHFix"));
    }
    if (descriptions < 2) {
      add("error", "PMAX_INSUFFICIENT_DESCRIPTIONS", "pmax.descriptions",
        t("libmeta.pf.pmFewD", { n: descriptions }),
        t("libmeta.pf.pmFewDFix"));
    }
    if (longHeadlines < 1) {
      add("warning", "PMAX_NO_LONG_HEADLINE", "pmax.longHeadlines",
        t("libmeta.pf.pmNoLong"),
        t("libmeta.pf.pmNoLongFix"));
    }
    if (!payload.pmax.businessName) {
      add("warning", "PMAX_NO_BUSINESS_NAME", "pmax.businessName",
        t("libmeta.pf.pmNoBiz"),
        t("libmeta.pf.pmNoBizFix"));
    }
  }

  // Ảnh: PMax thiếu logo / ảnh ngang / ảnh vuông thì Google KHÔNG phân phối.
  // Trước đây preflight bỏ qua hoàn toàn phần ảnh, nên người dùng tạo xong một
  // campaign hợp lệ về mặt kỹ thuật mà không bao giờ chạy — và chỉ biết điều
  // đó SAU KHI đã tạo, qua cờ `serviceable` trong phản hồi. Chặn trước rẻ hơn
  // giải thích sau.
  const imgCheck = checkPMaxImageCompleteness(payload.imageFieldTypes ?? []);
  if (!imgCheck.ok) {
    add("error", "PMAX_MISSING_REQUIRED_IMAGES", "imageAssets",
      t("libmeta.pf.pmMissingImg", { n: imgCheck.missing.length, list: imgCheck.missing.map(m => m.label).join(", ") }),
      t("libmeta.pf.pmMissingImgFix", { list: imgCheck.missing.map(m => `${m.label} (${m.recommended})`).join(" · ") }));
  }

  const errors   = checks.filter(c => c.severity === "error");
  const warnings = checks.filter(c => c.severity === "warning");
  const status: PreflightStatus =
    errors.length   > 0 ? "blocked" :
    warnings.length > 0 ? "ready_with_warnings" : "ready_to_launch";

  return { status, checks, errors, warnings };
}

// ── Shared helper: format for API response log ────────────────

export function preflightToLog(result: PreflightResult, t: TFunction = makeT("vi")): string[] {
  const lines: string[] = [];
  if (result.status === "blocked") {
    lines.push(t("libmeta.pf.logBlocked", { n: result.errors.length }));
  } else if (result.status === "ready_with_warnings") {
    lines.push(t("libmeta.pf.logWarn", { n: result.warnings.length }));
  } else {
    lines.push(t("libmeta.pf.logOk"));
  }
  for (const c of result.errors)   lines.push(`❌ [${c.code}] ${c.field}: ${c.message} → ${c.fix}`);
  for (const c of result.warnings) lines.push(`⚠️ [${c.code}] ${c.field}: ${c.message}`);
  return lines;
}
