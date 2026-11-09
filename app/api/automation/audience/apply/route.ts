// ============================================================
// Audience Optimizer — Apply Changes to Facebook API
// POST /api/automation/audience/apply
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { mergeIntoFlexibleSpec, BUCKET_LABEL, type TargetingItem } from "@/lib/audience-targeting-merge";
import { saveChangeRecord } from "@/lib/change-tracker";
import type { MetricSnapshot } from "@/lib/change-tracker";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { verifyMetaCampaignAccess } from "@/lib/meta-campaign-company";
import { writableTargeting } from "@/lib/case/meta-placements";
import { buildGenderCloneBody, metaGenderIds } from "@/lib/meta/campaign-params";

/**
 * Mọi targeting gửi lên Meta ở file này đi qua đây: bỏ trường app không ghi được (subscriber_universe → lỗi #3)
 * và vị trí Meta đã khai tử. Trước 26/10/2026 file này gửi nguyên targeting đọc về (các đường khác đã bỏ từ 27/09).
 */
const writable = (t: Record<string, unknown>) => writableTargeting(t).body;
// Route này TỰ VIẾT metaGet/metaPost riêng thay vì đi qua lib/meta-client.ts —
// nên nó bỏ lỡ cả ba thứ client kia đã có: (1) đọc header x-ad-account-usage để
// biết bậc truy cập, (2) tôn trọng thời gian nghỉ nên không nện thêm vào lúc
// Meta đang chặn, (3) dịch lỗi sang câu người dùng hành động được. Kết quả:
// người dùng nhận nguyên văn "(#3) Application does not have the capability to
// make this API call" — đúng chữ Meta trả, nhưng không nói được phải làm gì.
import { graphFetch, describeMetaError, isMetaTransientInsightError, isMetaPermissionError, ensureMetaTokenApp } from "@/lib/meta-client";
import { sumConversionActions } from "@/lib/meta-conversion-goal";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const META_BASE = META_GRAPH_BASE;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ApplyAction {
  type: "exclude_age" | "exclude_placement" | "focus_gender" | "exclude_gender" | "exclude_age_range" | "add_interests";
  label: string;
  params: Record<string, unknown>;
}

interface ApplyRequest {
  campaignId: string;
  campaignName: string;
  actions: ApplyAction[];
  /** true = chỉ dựng targeting rồi trả về, KHÔNG ghi lên Meta. */
  dryRun?: boolean;
}

interface ActionResult {
  type: string;
  label: string;
  success: boolean;
  error?: string;
  detail?: string;
  /** Chỉ có ở chế độ xem trước: targeting SẼ ghi, chưa gọi Meta lần nào. */
  preview?: Array<{
    adsetId: string;
    adsetName: string;
    added: Array<{ bucket: string; bucketLabel: string; items: string[] }>;
    skipped: Array<{ name: string; reason: string }>;
    flexibleSpecAfter: unknown[];
  }>;
}

// ─────────────────────────────────────────────
// Meta API helpers
// ─────────────────────────────────────────────

async function metaGet<T>(endpoint: string, token: string): Promise<T> {
  const url = `${META_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}access_token=${token}`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await graphFetch(url);
    const data = await res.json();
    if (data.error) {
      const code = data.error.code;
      const errorMsg = data.error.message || "";
      const isRateLimit = [4, 17, 32].includes(code) ||
        errorMsg.toLowerCase().includes("request limit") ||
        errorMsg.toLowerCase().includes("too many calls");

      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const waitMs = (attempt + 1) * 5000;
        console.warn(`[metaGet] Rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      // Lỗi quyền thì hỏi Meta xem token thuộc app nào TRƯỚC khi dựng câu báo,
      // để câu đó chỉ đúng App Dashboard cần mở.
      if (isMetaPermissionError({ message: data.error.message, code })) await ensureMetaTokenApp(token);
      throw new Error(describeMetaError(data.error.message, code));
    }
    return data as T;
  }
  throw new Error("Max retries reached");
}

async function metaPost(endpoint: string, token: string, body: Record<string, unknown>): Promise<{ success: boolean; id?: string }> {
  const url = `${META_BASE}${endpoint}`;

  // Facebook Marketing API requires form-encoded params for updates
  const formBody = new URLSearchParams();
  formBody.append("access_token", token);
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      formBody.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }

  // Retry with exponential backoff for rate limiting
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await graphFetch(url, {
      method: "POST",
      body: formBody,
    });
    const data = await res.json();

    if (data.error) {
      const code = data.error.code;
      const errorMsg = data.error.error_user_msg || data.error.message;

      // Rate limit errors: code 4, 17, 32, or "User request limit reached"
      const isRateLimit = [4, 17, 32].includes(code) ||
        errorMsg?.toLowerCase().includes("request limit") ||
        errorMsg?.toLowerCase().includes("too many calls");

      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const waitMs = (attempt + 1) * 5000; // 5s, 10s, 15s
        console.warn(`[metaPost] Rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      console.error(`[metaPost] Error:`, data.error);
      if (isMetaPermissionError({ message: errorMsg, code })) await ensureMetaTokenApp(token);
      throw new Error(describeMetaError(errorMsg, code));
    }

    return { success: true, id: data.id };
  }

  throw new Error("Max retries reached");
}

// ─────────────────────────────────────────────
// Get adsets for a campaign
// ─────────────────────────────────────────────

interface AdsetRaw {
  id: string;
  name: string;
  status: string;
  targeting: Record<string, unknown>;
  daily_budget?: string;
  lifetime_budget?: string;
  end_time?: string;
  created_time?: string;
  optimization_goal?: string;
  billing_event?: string;
  promoted_object?: Record<string, unknown>;
  destination_type?: string;
  attribution_spec?: unknown[];
  bid_strategy?: string;
  bid_amount?: string;
}

async function getAdsets(campaignId: string, token: string): Promise<AdsetRaw[]> {
  const data = await metaGet<{ data: AdsetRaw[] }>(
    `/${campaignId}/adsets?fields=id,name,status,targeting,daily_budget,lifetime_budget,end_time,created_time,optimization_goal,billing_event,promoted_object,destination_type,attribution_spec,bid_strategy,bid_amount&limit=50`,
    token
  );
  return data.data ?? [];
}

// ─────────────────────────────────────────────
// Action executors
// ─────────────────────────────────────────────

async function applyAgeExclusion(
  adsets: AdsetRaw[],
  token: string,
  params: { age_min?: number; age_max?: number }
): Promise<ActionResult> {
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "exclude_age", label: "Thu hẹp age", success: false, error: "Không có adset ACTIVE nào" };
  }

  const errors: string[] = [];
  let successCount = 0;

  for (const adset of activeAdsets) {
    try {
      const currentTargeting = (adset.targeting || {}) as Record<string, unknown>;
      const newTargeting = {
        ...currentTargeting,
        ...(params.age_min !== undefined ? { age_min: params.age_min } : {}),
        ...(params.age_max !== undefined ? { age_max: params.age_max } : {}),
      };

      await metaPost(`/${adset.id}`, token, {
        targeting: writable(newTargeting),
      });
      successCount++;

      // Delay between calls to avoid rate limiting
      if (successCount < activeAdsets.length) {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (err) {
      errors.push(`${adset.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0 && successCount === 0) {
    return {
      type: "exclude_age",
      label: `Thu hẹp age ${params.age_min ?? "?"}-${params.age_max ?? "?"}`,
      success: false,
      error: errors.join("; "),
    };
  }

  return {
    type: "exclude_age",
    label: `Thu hẹp age ${params.age_min ?? "?"}-${params.age_max ?? "?"}`,
    success: true,
    detail: `Đã cập nhật ${successCount}/${activeAdsets.length} adsets${errors.length > 0 ? ` (${errors.length} lỗi)` : ""}`,
  };
}

async function applyPlacementOptimization(
  adsets: AdsetRaw[],
  token: string,
  params: {
    publisher_platforms?: string[];
    facebook_positions?: string[];
    instagram_positions?: string[];
  }
): Promise<ActionResult> {
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "exclude_placement", label: "Tối ưu placement", success: false, error: "Không có adset ACTIVE nào" };
  }

  const errors: string[] = [];
  let successCount = 0;

  for (const adset of activeAdsets) {
    try {
      const newTargeting: Record<string, unknown> = {
        ...(adset.targeting || {}),
      };

      if (params.publisher_platforms) {
        newTargeting.publisher_platforms = params.publisher_platforms;
      }
      if (params.facebook_positions) {
        newTargeting.facebook_positions = params.facebook_positions;
      }
      if (params.instagram_positions) {
        newTargeting.instagram_positions = params.instagram_positions;
      }

      await metaPost(`/${adset.id}`, token, {
        targeting: writable(newTargeting),
      });
      successCount++;

      // Delay between calls to avoid rate limiting
      if (successCount < activeAdsets.length) {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (err) {
      errors.push(`${adset.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0 && successCount === 0) {
    return {
      type: "exclude_placement",
      label: "Tối ưu placement",
      success: false,
      error: errors.join("; "),
    };
  }

  return {
    type: "exclude_placement",
    label: "Tối ưu placement",
    success: true,
    detail: `Đã cập nhật ${successCount}/${activeAdsets.length} adsets${errors.length > 0 ? ` (${errors.length} lỗi)` : ""}`,
  };
}

async function applyGenderFocus(
  adsets: AdsetRaw[],
  campaignId: string,
  token: string,
  params: { gender: "female" | "male"; budget_ratio?: number }
): Promise<ActionResult> {
  // Strategy: Duplicate best-performing adset with gender targeting + higher budget
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "focus_gender", label: "Tập trung giới tính", success: false, error: "Không có adset ACTIVE nào" };
  }

  // Pick first active adset as template
  const templateAdset = activeAdsets[0];
  // Trước 26/10/2026 gửi [{id:1}] cho "Nữ" = sai dạng và đảo giới tính (Meta: 1 = Nam, 2 = Nữ).
  const genderValue = metaGenderIds(params.gender === "female" ? "female" : "male");
  const genderLabel = params.gender === "female" ? "Nữ" : "Nam";
  const budgetRatio = params.budget_ratio ?? 1.5;

  try {
    const newTargeting = {
      ...(templateAdset.targeting || {}),
      genders: genderValue,
    };

    // Chiến dịch CBO (ngân sách ở chiến dịch) thì nhóm mới KHÔNG được có ngân sách — xem buildGenderCloneBody.
    const campaign = await metaGet<{ daily_budget?: string; lifetime_budget?: string }>(
      `/${campaignId}?fields=daily_budget,lifetime_budget`, token
    );
    const campaignHasBudget = Number(campaign.daily_budget) > 0 || Number(campaign.lifetime_budget) > 0;

    // Create new adset in same campaign
    await metaPost(`/act_${process.env.META_AD_ACCOUNT_ID}/adsets`, token, buildGenderCloneBody(templateAdset, {
      campaignId, campaignHasBudget, targeting: writable(newTargeting), genderLabel, budgetRatio,
    }));

    return {
      type: "focus_gender",
      label: `Tạo adset ${genderLabel} ưu tiên`,
      success: true,
      detail: `Đã tạo adset mới (PAUSED) — cần bật thủ công trên Facebook${campaignHasBudget ? " · chiến dịch dùng ngân sách chiến dịch (CBO) nên nhóm mới không có ngân sách riêng" : ""}`,
    };
  } catch (err) {
    return {
      type: "focus_gender",
      label: `Tạo adset ${genderLabel} ưu tiên`,
      success: false,
      error: friendlyError(err instanceof Error ? err.message : "Unknown error"),
    };
  }
}

// ─────────────────────────────────────────────
// EXCLUDE_GENDER — Đổi targeting.genders trực tiếp (DIRECT_APPLY)
// ─────────────────────────────────────────────

async function applyGenderExclusion(
  adsets: AdsetRaw[],
  token: string,
  params: { keepGenders: number[] }
): Promise<ActionResult> {
  const GENDER_LABEL: Record<number, string> = { 1: "Nam", 2: "Nữ" };
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "exclude_gender", label: "Thay đổi giới tính", success: false, error: "Không có adset ACTIVE nào" };
  }

  const keptLabel = params.keepGenders.map((g) => GENDER_LABEL[g] || g).join(", ");
  const removedLabel = [1, 2]
    .filter((g) => !params.keepGenders.includes(g))
    .map((g) => GENDER_LABEL[g] || g)
    .join(", ");
  const changeLabel = `Chỉ giữ ${keptLabel} (bỏ ${removedLabel})`;

  const errors: string[] = [];
  let successCount = 0;

  for (const adset of activeAdsets) {
    try {
      const currentTargeting = (adset.targeting || {}) as Record<string, unknown>;
      const newTargeting = {
        ...currentTargeting,
        genders: params.keepGenders,
      };

      await metaPost(`/${adset.id}`, token, { targeting: writable(newTargeting) });
      successCount++;

      if (successCount < activeAdsets.length) {
        await new Promise((r) => setTimeout(r, 4000));
      }
    } catch (err) {
      errors.push(`${adset.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0 && successCount === 0) {
    return { type: "exclude_gender", label: changeLabel, success: false, error: errors.join("; ") };
  }

  return {
    type: "exclude_gender",
    label: changeLabel,
    success: true,
    detail: `Đã cập nhật ${successCount}/${activeAdsets.length} adsets${errors.length > 0 ? ` (${errors.length} lỗi)` : ""}`,
  };
}

// ─────────────────────────────────────────────
// EXCLUDE_AGE_RANGE — Đổi targeting.age_min/age_max trực tiếp (DIRECT_APPLY)
// ─────────────────────────────────────────────

async function applyAgeRangeChange(
  adsets: AdsetRaw[],
  token: string,
  params: { newAgeMin: number; newAgeMax: number }
): Promise<ActionResult> {
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "exclude_age_range", label: "Thay đổi độ tuổi", success: false, error: "Không có adset ACTIVE nào" };
  }

  // Detect old age range from first adset
  const firstTargeting = (activeAdsets[0].targeting || {}) as Record<string, unknown>;
  const oldMin = (firstTargeting.age_min as number) || 18;
  const oldMax = (firstTargeting.age_max as number) || 65;
  const changeLabel = `Đổi độ tuổi: ${oldMin}-${oldMax} → ${params.newAgeMin}-${params.newAgeMax}`;

  const errors: string[] = [];
  let successCount = 0;

  for (const adset of activeAdsets) {
    try {
      const currentTargeting = (adset.targeting || {}) as Record<string, unknown>;
      const newTargeting = {
        ...currentTargeting,
        age_min: params.newAgeMin,
        age_max: params.newAgeMax,
      };

      await metaPost(`/${adset.id}`, token, { targeting: writable(newTargeting) });
      successCount++;

      if (successCount < activeAdsets.length) {
        await new Promise((r) => setTimeout(r, 4000));
      }
    } catch (err) {
      errors.push(`${adset.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0 && successCount === 0) {
    return { type: "exclude_age_range", label: changeLabel, success: false, error: errors.join("; ") };
  }

  return {
    type: "exclude_age_range",
    label: changeLabel,
    success: true,
    detail: `Đã cập nhật ${successCount}/${activeAdsets.length} adsets${errors.length > 0 ? ` (${errors.length} lỗi)` : ""}`,
  };
}

// ─────────────────────────────────────────────
// ADD_INTERESTS — Thêm interests vào flexible_spec[0].interests
// Merge với interests hiện tại, không duplicate
// ─────────────────────────────────────────────

interface InterestInput {
  id: string;
  name: string;
  /** Ô đích trong flexible_spec. Thiếu = interests (giữ nguyên hành vi cũ). */
  targetingType?: string;
}

/**
 * Thêm mục nhắm vào các adset ACTIVE.
 *
 * ĐỔI 16/09/2026: không còn nhét tất cả vào ô `interests`. Mỗi mục nay đi đúng
 * ô của nó (Sở thích / Hành vi / Chức danh…) nhờ lib/audience-targeting-merge.
 * Phần trộn nằm ở lib để chạy thử được không cần token — đây là đoạn mã đẩy
 * thẳng lên adset đang tiêu tiền, không kiểm được trước là không đẩy.
 *
 * `dryRun` = dựng đúng targeting sẽ gửi rồi TRẢ VỀ, không gọi POST. Dùng để
 * nhìn tận mắt trước khi cho ghi thật.
 */
async function applyAddInterests(
  adsets: AdsetRaw[],
  token: string,
  params: { interests: InterestInput[]; dryRun?: boolean }
): Promise<ActionResult> {
  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE");
  if (activeAdsets.length === 0) {
    return { type: "add_interests", label: "Thêm mục nhắm", success: false, error: "Không có adset ACTIVE nào" };
  }

  if (!params.interests || params.interests.length === 0) {
    return { type: "add_interests", label: "Thêm mục nhắm", success: false, error: "Không có mục nhắm nào được chọn" };
  }

  const items: TargetingItem[] = params.interests.map((i) => ({
    id: i.id, name: i.name, bucket: i.targetingType ?? "interests",
  }));

  const label = `Thêm ${params.interests.length} mục nhắm: ${params.interests.map(i => i.name).join(", ")}`;

  // ── Chế độ xem trước: không gọi POST ──
  if (params.dryRun) {
    const previews = activeAdsets.map((adset) => {
      const merged = mergeIntoFlexibleSpec((adset.targeting || {}) as Record<string, unknown>, items);
      return {
        adsetId: adset.id,
        adsetName: adset.name,
        added: merged.added.map(a => ({
          bucket: a.bucket,
          bucketLabel: BUCKET_LABEL[a.bucket],
          items: a.items.map(i => i.name),
        })),
        skipped: merged.skipped.map(sk => ({ name: sk.item.name, reason: sk.reason })),
        // Chỉ trả phần flexible_spec — đủ để soi, không dội cả targeting ra UI.
        flexibleSpecAfter: (merged.targeting.flexible_spec as unknown[]) ?? [],
      };
    });

    const totalAdded = previews.reduce((n, pv) => n + pv.added.reduce((m, a) => m + a.items.length, 0), 0);
    return {
      type: "add_interests",
      label: `XEM TRƯỚC (chưa ghi gì) — ${label}`,
      success: true,
      detail: `Sẽ thêm ${totalAdded} mục trên ${activeAdsets.length} adset. Chưa gọi Meta, chưa đổi gì.`,
      preview: previews,
    };
  }

  // ── Ghi thật ──
  const errors: string[] = [];
  let successCount = 0;
  const allSkipped: string[] = [];

  for (const adset of activeAdsets) {
    try {
      const merged = mergeIntoFlexibleSpec((adset.targeting || {}) as Record<string, unknown>, items);

      for (const sk of merged.skipped) {
        allSkipped.push(`${sk.item.name} (${sk.reason})`);
      }

      // Không còn gì để thêm thì đừng gọi API — mỗi lần ghi là một lần campaign
      // có thể bị đẩy về learning phase.
      if (merged.added.length === 0) {
        successCount++;
        continue;
      }

      await metaPost(`/${adset.id}`, token, { targeting: writable(merged.targeting) });
      successCount++;

      if (successCount < activeAdsets.length) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      errors.push(`${adset.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0 && successCount === 0) {
    return { type: "add_interests", label, success: false, error: errors.join("; ") };
  }

  const skippedNote = allSkipped.length > 0
    ? ` · bỏ qua: ${Array.from(new Set(allSkipped)).join(", ")}`
    : "";

  return {
    type: "add_interests",
    label,
    success: true,
    detail: `Đã cập nhật ${successCount}/${activeAdsets.length} adsets${errors.length > 0 ? ` (${errors.length} lỗi: ${errors.join("; ")})` : ""}${skippedNote}`,
  };
}

// ─────────────────────────────────────────────
// GET — Preview: fetch adsets for confirmation modal
// ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: friendlyError("META_ACCESS_TOKEN not configured") }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");

  if (!campaignId) {
    return NextResponse.json({ success: false, error: "campaignId is required" }, { status: 400 });
  }

  try {
    const adsets = await getAdsets(campaignId, token);

    // Check campaign age (learning phase warning)
    const now = Date.now();
    const oldestAdset = adsets
      .map((a) => new Date(a.created_time ?? "").getTime())
      .filter((t) => t > 0)
      .sort((a, b) => a - b)[0];

    const campaignAgeDays = oldestAdset ? Math.floor((now - oldestAdset) / 86400000) : 999;
    const isLearningPhase = campaignAgeDays < 7;

    return NextResponse.json({
      success: true,
      data: {
        adsets: adsets.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          daily_budget: a.daily_budget,
          targeting_summary: {
            age_min: (a.targeting as Record<string, unknown>)?.age_min ?? 18,
            age_max: (a.targeting as Record<string, unknown>)?.age_max ?? 65,
            genders: (a.targeting as Record<string, unknown>)?.genders ?? "all",
            publisher_platforms: (a.targeting as Record<string, unknown>)?.publisher_platforms ?? "all",
          },
        })),
        activeCount: adsets.filter((a) => a.status === "ACTIVE").length,
        totalCount: adsets.length,
        campaignAgeDays,
        isLearningPhase,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// POST — Execute actions
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa targeting" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: friendlyError("META_ACCESS_TOKEN not configured") }, { status: 401 });
  }

  let body: ApplyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.campaignId || !body.actions?.length) {
    return NextResponse.json(
      { success: false, error: "campaignId and actions are required" },
      { status: 400 }
    );
  }

  // Real targeting mutation on the shared Meta ad account — gate to the
  // company this campaign belongs to before touching any ad set.
  // Xác minh theo ID (thứ mà hành động thật sự nhắm tới), không theo tên client
  // gửi kèm — hai thứ đó không buộc phải khớp nhau.
  const access = await verifyMetaCampaignAccess(
    body.campaignId ?? "", (c) => canAccessCompany(user, c),
  );
  if (!access.allowed) {
    return NextResponse.json({ success: false, error: access.error ?? "Access denied for this company" }, { status: 403 });
  }

  try {
    // 1. Fetch adsets for this campaign
    const adsets = await getAdsets(body.campaignId, token);

    if (adsets.length === 0) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy adset nào trong campaign này" },
        { status: 404 }
      );
    }

    // 2. Execute each action sequentially
    const results: ActionResult[] = [];

    for (const action of body.actions) {
      let result: ActionResult;

      switch (action.type) {
        case "exclude_age":
          result = await applyAgeExclusion(adsets, token, {
            age_min: action.params.age_min as number | undefined,
            age_max: action.params.age_max as number | undefined,
          });
          result.label = action.label || result.label;
          break;

        case "exclude_placement":
          result = await applyPlacementOptimization(adsets, token, {
            publisher_platforms: action.params.publisher_platforms as string[] | undefined,
            facebook_positions: action.params.facebook_positions as string[] | undefined,
            instagram_positions: action.params.instagram_positions as string[] | undefined,
          });
          result.label = action.label || result.label;
          break;

        case "focus_gender":
          result = await applyGenderFocus(adsets, body.campaignId, token, {
            gender: (action.params.gender as "female" | "male") ?? "female",
            budget_ratio: action.params.budget_ratio as number | undefined,
          });
          result.label = action.label || result.label;
          break;

        case "exclude_gender":
          result = await applyGenderExclusion(adsets, token, {
            keepGenders: (action.params.keepGenders as number[]) ?? [1, 2],
          });
          result.label = action.label || result.label;
          break;

        case "exclude_age_range":
          result = await applyAgeRangeChange(adsets, token, {
            newAgeMin: (action.params.newAgeMin as number) ?? 18,
            newAgeMax: (action.params.newAgeMax as number) ?? 65,
          });
          result.label = action.label || result.label;
          break;

        case "add_interests":
          result = await applyAddInterests(adsets, token, {
            interests: (action.params.interests as InterestInput[]) ?? [],
            dryRun: body.dryRun === true,
          });
          result.label = action.label || result.label;
          break;

        default:
          result = {
            type: action.type,
            label: action.label,
            success: false,
            error: `Unknown action type: ${action.type}`,
          };
      }

      results.push(result);
    }

    const successCount = results.filter((r) => r.success).length;

    // ── Save snapshot for Change Impact Tracker ──
    if (successCount > 0) {
      try {
        // Save previous targeting for rollback
        const activeAdsets = adsets.filter(a => a.status === "ACTIVE");
        const prevTargeting = activeAdsets.map(a => ({
          adsetId: a.id,
          targeting: a.targeting || {},
        }));

        // Fetch metrics for last 3 days (BEFORE the change)
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const since = threeDaysAgo.toISOString().split("T")[0];
        const until = now.toISOString().split("T")[0];

        let metricsBefore: MetricSnapshot = {
          impressions: 0, clicks: 0, spend: 0,
          ctr: 0, cpc: 0, cpl: 0,
          frequency: 0, results: 0,
          period: "3 ngày trước thay đổi",
        };

        try {
          const fields = "impressions,clicks,spend,ctr,cpc,actions,frequency";
          const metricsUrl = `${META_BASE}/${body.campaignId}/insights?fields=${fields}&time_range=${JSON.stringify({ since, until })}&access_token=${token}`;
          // graphFetch + thử lại cho nhóm Meta quá tải; fetch trần trước đây
          // không đọc header hạn mức và bỏ cuộc ngay lần đầu.
          type InsightRow = Record<string, string | undefined> & { actions?: Array<{ action_type: string; value: string }> };
          let mData: { data?: InsightRow[]; error?: { message?: string; code?: number } } | null = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const mRes = await graphFetch(metricsUrl);
            mData = await mRes.json();
            if (!mData?.error) break;
            if (isMetaTransientInsightError(mData.error) && attempt < 3) {
              await new Promise(r => setTimeout(r, 1500 * attempt));
              continue;
            }
            break;
          }
          if (mData?.error) {
            console.warn(`[audience/apply] insights hỏng: ${describeMetaError(mData.error.message ?? "?", mData.error.code)}`);
          }

          if (mData?.data && mData.data.length > 0) {
            const row = mData.data[0];
            // .find() cũ lấy hành động nào Meta xếp TRƯỚC trong mảng — link_click
            // hoàn toàn có thể bị đếm thành "kết quả" thay cho lead. Nay lấy
            // theo đúng thứ tự ưu tiên: mua → khách tiềm năng → lượt bấm.
            const resultActions = sumConversionActions(row.actions, ["offsite_conversion.fb_pixel_purchase", "lead", "link_click"]);
            const spend = parseFloat(row.spend || "0");
            const resultCount = Math.round(resultActions) || 0;

            metricsBefore = {
              impressions: parseInt(row.impressions || "0", 10),
              clicks: parseInt(row.clicks || "0", 10),
              spend,
              ctr: parseFloat(row.ctr || "0"),
              cpc: parseFloat(row.cpc || "0"),
              cpl: resultCount > 0 ? Math.round(spend / resultCount) : 0,
              frequency: parseFloat(row.frequency || "0"),
              results: resultCount,
              period: "3 ngày trước thay đổi",
            };
          }
        } catch (metricsErr) {
          console.warn("[Apply] Failed to fetch metrics before:", metricsErr);
        }

        // Save one record per successful action
        for (const action of body.actions) {
          const actionResult = results.find(r => r.type === action.type);
          if (actionResult?.success) {
            await saveChangeRecord({
              campaignId: body.campaignId,
              campaignName: body.campaignName,
              company: access.company ?? "MBC",
              actionType: action.type,
              actionLabel: actionResult.label,
              appliedAt: new Date().toISOString(),
              previousTargeting: prevTargeting,
              adsetIds: activeAdsets.map(a => a.id),
              metricsBefore,
            });
          }
        }

        console.log(`[Apply] Saved ${successCount} change record(s) for impact tracking`);
      } catch (trackErr) {
        console.warn("[Apply] Change tracking failed (non-blocking):", trackErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: results.length - successCount,
        },
        campaignId: body.campaignId,
        campaignName: body.campaignName,
        appliedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Apply failed: ${msg}` },
      { status: 500 }
    );
  }
}
