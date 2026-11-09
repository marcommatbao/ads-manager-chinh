// Tạo chiến dịch Meta đầy đủ: Campaign → Ad Sets → Ads. Tách NGUYÊN VĂN từ app/api/creative/launch-campaign/route.ts
// ngày 27/10 (task #7142) để route giao diện và MCP cho Claude dùng chung. Lỗi kiểu HTTP → LaunchHttpError(status, body)
// (route trả đúng như trước). opts.actor: nhãn người tạo trong sổ (vd "<email> qua Claude (MCP)").
import {
  mapSegmentToFBTargeting,
  fbApiCall,
  rollbackMetaObject,
  resolveCtaType,
  type LaunchConfig,
  type LaunchResult,
  FB_OBJECTIVES,
  OBJECTIVE_MAP,
} from "@/lib/creative-pipeline";
import { normalizeStandardEvent } from "@/lib/meta-pixel-events";
import { runPreflightMeta, preflightToLog } from "@/lib/launch-preflight";
import { linkCreativeToCampaign } from "@/lib/creative-tracker";
import type { SessionUser } from "@/lib/auth";
import { recordSegmentLaunch, type SegmentLaunchRecord } from "@/lib/segment-launch-registry";
import { dropPlacements } from "@/lib/playbook/suggest";
import { cleanIds, recordPlaybookUsage } from "@/lib/playbook/usage";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";
import { getWinning } from "@/lib/meta/winning-audiences";
import { retiredPositionsNote, writableTargeting } from "@/lib/case/meta-placements";
import { buildCampaignParams } from "@/lib/meta/campaign-params";

const META_BASE = META_GRAPH_BASE;


export class LaunchHttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error ?? "launch error")) }
}

export async function launchMetaCampaign(user: SessionUser, config: LaunchConfig, opts: { actor?: string } = {}): Promise<Record<string, unknown>> {
  if (!hasPermission(user.role, "can_edit")) {
    throw new LaunchHttpError(403, { success: false, error: "Không có quyền khởi chạy campaign" });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    throw new LaunchHttpError(401, { success: false, error: friendlyError("META credentials not configured") });
  }


  // This route creates a real Campaign/AdSet/Ad on the shared Meta ad
  // account — must be gated to the company the launch is actually for,
  // same as the budget/status mutation routes (lib/company-detect.ts).
  if (!canAccessCompany(user, config.company)) {
    throw new LaunchHttpError(403, { success: false, error: "Access denied for this company" });
  }

  const log: string[] = [];
  const addLog = (msg: string) => {
    log.push(msg);
    console.log(`[launch-campaign] ${msg}`);
  };

  // Tracked across the whole attempt so the outer catch can roll back
  // whatever was already created on Meta if a later step fails partway
  // through — otherwise a failed AdSet/Ad leaves an orphaned PAUSED
  // Campaign (or AdSet) shell sitting in the ad account forever.
  let campaignId: string | undefined;
  const createdAdSetIds: string[] = [];
  const createdAdIds: string[] = [];
  // Populated whenever a segment's targeting had to fall back to
  // Advantage+ Audience (interests/age dropped) after Meta rejected the
  // originally-configured targeting — surfaced in the response so the
  // success screen can warn instead of silently celebrating a launch
  // that doesn't match what the user actually configured.
  const targetingDowngrades: Array<{
    segmentName: string; adSetId: string;
    originalTargeting: Record<string, unknown>; reason: string;
  }> = [];

  try {
    const objConf = OBJECTIVE_MAP[config.objectiveKey] ?? OBJECTIVE_MAP.OUTCOME_LEADS;
    const selectedCreatives = config.creatives.filter(c => c.selected);

    // Validate — basic checks kept for backward compat
    if (!config.pageId) {
      throw new LaunchHttpError(400, { success: false, error: "pageId is required", log });
    }
    if (selectedCreatives.length === 0) {
      throw new LaunchHttpError(400, { success: false, error: "No creatives selected", log });
    }

    // Đợt 26c: tệp thắng phải còn và cùng công ty — kiểm TRƯỚC khi tạo bất cứ thứ gì trên Meta (không để chiến dịch tạo dở).
    const badWinning = config.segments.filter((sg) => sg.winningAudienceId && getWinning(sg.winningAudienceId)?.company !== config.company);
    if (badWinning.length) {
      throw new LaunchHttpError(400, { success: false, error: `Tệp thắng không còn hoặc không thuộc công ty này: ${badWinning.map((sg) => sg.segmentName).join(", ")} — chọn lại tệp`, log });
    }

    // Preflight validation — hard-block on errors
    const preflight = runPreflightMeta(config, config.company ?? "MBC");
    if (preflight.status === "blocked") {
      const pfLog = preflightToLog(preflight);
      addLog("🚫 Preflight validation failed — launch aborted");
      throw new LaunchHttpError(422, { success: false, error: `Preflight failed: ${preflight.errors[0]?.message ?? "validation error"}`, preflight, log: [...log, ...pfLog] });
    }
    if (preflight.status === "ready_with_warnings") {
      preflightToLog(preflight).forEach(l => addLog(l));
    }

    // ── 1. Create Campaign ──
    // launchActive quyết định trạng thái CẢ 3 CẤP (campaign/ad set/ad) —
    // Meta chỉ thật sự chạy khi cả 3 đều ACTIVE; đổi mỗi campaign (như
    // toggle-campaign/route.ts vẫn làm cho campaign đã có sẵn ad set/ad
    // ACTIVE từ trước) là không đủ cho một campaign MỚI TẠO, vì ad set/ad
    // bên dưới mặc định PAUSED.
    const launchStatus = config.launchActive ? "ACTIVE" : "PAUSED";
    addLog(config.launchActive ? "🚀 Tạo campaign — sẽ CHẠY THẬT ngay khi tạo xong..." : "🚀 Tạo campaign (tắt sẵn)...");

    // CBO: ngân sách + bid_strategy ở chiến dịch; ABO: is_adset_budget_sharing_enabled=false (bắt buộc từ v24) — xem lib/meta/campaign-params.ts.
    const campaignParams = buildCampaignParams({
      name: config.campaignName,
      objective: config.objectiveKey,
      status: launchStatus,
      budgetType: config.budgetType,
      dailyBudget: config.dailyBudget,
      bidStrategy: config.bidStrategy,
    });

    const campaignRes = await fbApiCall(
      `/act_${adAccountId}/campaigns`,
      campaignParams,
      "create-campaign",
      token
    );
    campaignId = campaignRes.id as string;
    addLog(`✅ Campaign tạo thành công: ${campaignId}`);

    // ── 2. Create Ad Sets ──
    let adSetCount = 0;
    let adCount = 0;
    const segmentAdSetMap: Record<string, string> = {};
    const launchRecords: SegmentLaunchRecord[] = [];

    for (const segment of config.segments) {
      addLog(`📦 Tạo Ad Set: ${segment.segmentName}...`);

      // Use pre-resolved interest IDs from the UI (user-selected or auto-resolved in Step 4).
      // These come directly from FB's own interest search so are already valid.
      // Only fall back to re-resolving via text search when no pre-resolved IDs exist.
      // Đợt 26c: tệp thắng đã lưu → dùng NGUYÊN cấu hình nhắm chọn đã chạy tốt (không dựng lại từ chữ). Tệp của công ty khác → dừng.
      const saved = segment.winningAudienceId ? getWinning(segment.winningAudienceId) : null;
      if (segment.winningAudienceId && (!saved || saved.company !== config.company)) {
        throw new Error(`Tệp thắng “${segment.segmentName}” không còn hoặc không thuộc công ty này — chọn lại tệp`);
      }
      // Tệp thắng lưu trước 26/10/2026 có thể còn vị trí Meta đã khai tử (vd instagram "explore") → đi qua writableTargeting.
      const savedW = saved ? writableTargeting(structuredClone(saved.targeting) as Record<string, unknown>) : null;
      const { targeting, unresolvedLocations, ignoredExclusions } = savedW
        ? { targeting: savedW.body as unknown as Awaited<ReturnType<typeof mapSegmentToFBTargeting>>["targeting"], unresolvedLocations: [] as string[], ignoredExclusions: [] as string[] }
        : await mapSegmentToFBTargeting(
          segment,
          token,
          config.objectiveKey,
          config.includeInstagram ?? false,
          config.useAdvantageAudience ?? false
        );
      // Loại trừ tệp chọn ở LẦN CHẠY NÀY (vd khách cũ) vẫn phải áp — gộp với loại trừ có sẵn trong tệp đã lưu.
      if (saved && segment.excludeCustomAudienceIds?.length) {
        const t = targeting as unknown as { excluded_custom_audiences?: { id: string }[] };
        const ids = new Set([...(t.excluded_custom_audiences ?? []).map((x) => String(x.id)), ...segment.excludeCustomAudienceIds.map(String)]);
        t.excluded_custom_audiences = [...ids].map((id) => ({ id }));
      }
      const retiredNote = savedW ? retiredPositionsNote(savedW.retired) : null;
      if (retiredNote) addLog(`⚠️ ${retiredNote}`);
      if (ignoredExclusions.length > 0) {
        addLog(`⚠️ Meta không còn cho loại trừ theo sở thích/hành vi — bỏ qua: ${ignoredExclusions.join(", ")}. Muốn loại trừ thì chọn tệp ở ô "Loại trừ tệp đối tượng".`);
      }
      if (saved) addLog(`🏆 Dùng tệp thắng đã lưu “${saved.name}” (${saved.summary}) — lưu ${saved.savedAt.slice(0, 10)}${saved.droppedKeys.length ? `; bỏ trường app không ghi được: ${saved.droppedKeys.join(", ")}` : ""}`);

      // Đợt 7b — bỏ vị trí đã chọn loại (Sổ kinh nghiệm "Nên tránh" hoặc người dùng tick).
      // dropPlacements không bao giờ để nhóm hết chỗ hiển thị.
      if (config.excludePlacements?.length) {
        const t = targeting as unknown as Record<string, unknown>;
        const d = dropPlacements(t, config.excludePlacements.filter((k) => typeof k === "string").slice(0, 30));
        if (d.changed) { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, d.next); addLog(`🚫 Đã bỏ vị trí: ${d.removed.join(", ")}`); }
        else if (d.reason) addLog(`⚠️ ${d.reason}`);
      }

      // Log targeting summary so user can verify what's sent to Meta
      const flexSpec = targeting.flexible_spec as Array<Record<string, unknown>> | undefined;
      const interestNames = (flexSpec?.[0]?.interests as Array<{name: string}> | undefined)?.map(i => i.name) ?? [];
      const advantageMode = (targeting.targeting_automation as {advantage_audience: number} | undefined)?.advantage_audience;
      addLog(`🎯 Targeting: advantage_audience=${advantageMode}, interests=${interestNames.length > 0 ? interestNames.slice(0,3).join(", ") + (interestNames.length > 3 ? "..." : "") : "none"}, resolvedIds=${segment.resolvedInterestIds?.length ?? 0}`);
      if (unresolvedLocations.length > 0) {
        addLog(`⚠️ Không xác định được vị trí trên Facebook, đã BỎ QUA: ${unresolvedLocations.join(", ")} — kiểm tra lại targeting trước khi bật campaign`);
      }

      const adSetParams: Record<string, unknown> = {
        name: segment.segmentName,
        campaign_id: campaignId,
        status: launchStatus,
        optimization_goal: objConf.optimization_goal,
        billing_event: objConf.billing_event ?? "IMPRESSIONS",
        targeting,
        start_time: config.startDate ? new Date(config.startDate).toISOString() : new Date().toISOString(),
      };

      if (!config.continuous && config.endDate) {
        adSetParams.end_time = new Date(config.endDate).toISOString();
      }

      // ABO budget
      if (config.budgetType !== "cbo") {
        adSetParams.daily_budget = String(config.adSetDailyBudget ?? config.adsetBudget ?? 200000);
        adSetParams.bid_strategy = config.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
      }

      if (config.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && config.bidAmount) {
        adSetParams.bid_amount = config.bidAmount;
      }

      // Pixel + event — REQUIRED whenever optimization_goal is
      // OFFSITE_CONVERSIONS (both OUTCOME_SALES and OUTCOME_LEADS per
      // OBJECTIVE_MAP in lib/creative-pipeline.ts). Without a valid
      // promoted_object, Meta rejects the whole ad set — confirmed live via
      // a controlled diagnostic: the exact same targeting (6 real, valid
      // interests) succeeded immediately once promoted_object was attached,
      // after repeatedly failing with a misleading "category no longer
      // exists" error (subcode 1487694) when it was missing. The frontend
      // previously only ever sent pixelEvent for objectiveKey ===
      // "OUTCOME_SALES", so every OUTCOME_LEADS launch was missing
      // promoted_object unconditionally — fixed here at the single call
      // site that actually talks to Meta, independent of what the frontend
      // sends, with a sane per-objective default event.
      //
      // Ba loại mục tiêu chuyển đổi, ba cách gửi KHÁC NHAU lên Meta — trước
      // đây chỉ có loại thứ nhất, nên mọi chuyển đổi tuỳ chỉnh ("Mua hàng
      // (Hoàn thành)") và mọi sự kiện web tự bắn (thank_page, form_submit)
      // đều rơi về PURCHASE mà không báo gì:
      //
      //   1. Sự kiện tiêu chuẩn   → { pixel_id, custom_event_type: <ENUM> }
      //   2. Chuyển đổi tuỳ chỉnh → { custom_conversion_id }  (bản thân nó đã
      //      mang sẵn pixel + luật, không kèm custom_event_type)
      //   3. Sự kiện tuỳ chỉnh    → { pixel_id, custom_event_type: "OTHER",
      //      pixel_rule: {"event":{"eq":"<tên>"}} } — đây là cách duy nhất
      //      Meta nhận một sự kiện không nằm trong bảng enum của họ.
      //
      // EVENT_NORMALIZE cũ đã bị gỡ: nó nhận "VIEW_CONTENT" trong khi giao
      // diện gửi "CONTENT_VIEW" (enum thật của Meta), nên chọn ViewContent là
      // chạy nhầm sang PURCHASE. normalizeStandardEvent() dịch cả hai chiều.
      if (config.pixelId && objConf.optimization_goal === "OFFSITE_CONVERSIONS") {
        const defaultEvent = config.objectiveKey === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE";
        const customConversionId = config.customConversionId?.trim();
        const customEventName = config.pixelCustomEventName?.trim();

        if (customConversionId) {
          adSetParams.promoted_object = { custom_conversion_id: customConversionId };
          addLog(`📌 Pixel: ${config.pixelId} / chuyển đổi tùy chỉnh: ${customConversionId}`);
        } else if (customEventName && !normalizeStandardEvent(customEventName)) {
          adSetParams.promoted_object = {
            pixel_id: config.pixelId,
            custom_event_type: "OTHER",
            pixel_rule: JSON.stringify({ event: { eq: customEventName } }),
          };
          addLog(`📌 Pixel: ${config.pixelId} / sự kiện tùy chỉnh: ${customEventName}`);
        } else {
          const customEventType = normalizeStandardEvent(config.pixelEvent) ?? defaultEvent;
          adSetParams.promoted_object = {
            pixel_id: config.pixelId,
            custom_event_type: customEventType,
          };
          addLog(`📌 Pixel: ${config.pixelId} / event: ${customEventType}`);
        }
      }

      // Definite-assignment: every branch below either assigns adSetRes or
      // throws — the retry-success path assigns it inside a nested try
      // that TS's flow analysis can't correlate with the `retrySucceeded`
      // flag checked afterward.
      let adSetRes!: Record<string, unknown>;
      try {
        adSetRes = await fbApiCall(
          `/act_${adAccountId}/adsets`,
          adSetParams,
          `create-adset-${segment.segmentName}`,
          token
        );
      } catch (adSetErr: unknown) {
        let errMsg = adSetErr instanceof Error ? adSetErr.message : String(adSetErr);
        let retrySucceeded = false;

        if (errMsg.includes("code: 100")) {
          // A code-100 with real, valid interest IDs (already passed
          // adinterestvalid) has been confirmed live to sometimes be
          // transient — Meta occasionally rejects a just-resolved interest
          // ID as "Hạng mục không còn tồn tại" (category no longer exists)
          // immediately after search, then accepts the exact same ID
          // seconds later once its targeting-validation cache catches up.
          // One short retry recovers real detailed targeting in that case
          // instead of discarding it — confirmed via a live diagnostic
          // where the identical interest set failed once then succeeded
          // on retry with no changes.
          addLog(`⚠️ Code 100 lần đầu — thử lại sau 3s (có thể do Meta chưa đồng bộ interest vừa resolve)...`);
          await new Promise(r => setTimeout(r, 3000));
          try {
            adSetRes = await fbApiCall(
              `/act_${adAccountId}/adsets`,
              adSetParams,
              `create-adset-${segment.segmentName}-retry`,
              token
            );
            addLog(`✅ Ad Set tạo thành công sau khi thử lại — giữ nguyên interests/behaviors thật`);
            retrySucceeded = true;
          } catch (retryErr: unknown) {
            errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          }
        }

        if (retrySucceeded) {
          // adSetRes already set by the successful retry above — fall
          // through past the code-100 fallback chain entirely.
        } else if (errMsg.includes("code: 100")) {
          const orig = adSetParams.targeting as Record<string, unknown>;
          const origSpec = orig.flexible_spec as Array<Record<string, unknown>> | undefined;
          const baseDemographic: Record<string, unknown> = {
            geo_locations: orig.geo_locations,
            age_min: orig.age_min ?? 18,
            age_max: orig.age_max ?? 65,
            targeting_automation: { advantage_audience: 0 },
          };
          if (Array.isArray(orig.genders) && (orig.genders as unknown[]).length > 0) {
            baseDemographic.genders = orig.genders;
          }
          for (const key of ["publisher_platforms", "facebook_positions", "instagram_positions", "device_platforms"]) {
            if (orig[key]) baseDemographic[key] = orig[key];
          }
          // When this tier is used with NO flexible_spec at all (no interests,
          // no behaviors), advantage_audience must switch to 1 (Advantage+
          // broad). Leaving it at 0 ("enforced narrow") with zero criteria to
          // enforce silently produces an ad set whose "Nhắm mục tiêu chi tiết"
          // looks empty in Ads Manager while claiming detailed targeting is on.
          // Advantage+ also requires age_max=65 AND age_min back to the
          // account default (18) — confirmed live via Meta's own error:
          // "Thay vào đó, bạn có thể thêm độ tuổi tối thiểu cao hơn làm gợi ý
          // khi tạo hoặc chỉnh sửa nhóm quảng cáo" (code 100) — a restrictive
          // age_min is rejected as a hard constraint under Advantage+; Meta
          // only accepts it via a separate "suggestion" mechanism this app
          // doesn't send. reachestimate does NOT catch this — it's laxer
          // than real ad-set creation for Advantage+ fields, so don't trust
          // it alone to validate Advantage+ targeting.
          // age 18–65 ở đây KHÔNG phải cho đẹp: khi advantage_audience = 1, Meta
          // TỪ CHỐI mọi khoảng tuổi hẹp hơn mặc định — lỗi 1870188 "bạn có thể
          // thêm độ tuổi tối thiểu cao hơn làm GỢI Ý" (đo thật 25/08/2026, biến
          // thể B và F). Nghĩa là hễ rơi xuống nấc này thì độ tuổi người dùng
          // chọn CHẮC CHẮN mất — không phải do tool bỏ qua, mà do Meta không cho
          // vừa bật Advantage+ vừa ép tuổi.
          const pureDemographic = {
            ...baseDemographic,
            age_min: 18,
            age_max: 65,
            targeting_automation: { advantage_audience: 1 },
          };

          // Retry 1: GIỮ interests, BỎ behaviors.
          //
          // Thang này trước đây ngược: bỏ interests để giữ lại behaviors, với ghi
          // chú "BEHAVIOR_MAP IDs are static + verified". Đo thật 25/08/2026 bằng
          // validate_only cho thấy chính các id "verified" đó đã bị Meta khai tử
          // (lỗi 1487694 ở CẢ hai chế độ Advantage+), còn interest lấy sống thì
          // hợp lệ. Nên nấc giữa cũ chắc chắn hỏng, và mọi launch rơi thẳng
          // xuống nấc cuối — mất sạch độ tuổi lẫn sở thích.
          const interestsSpec = origSpec?.filter(s => s.interests) ?? [];
          if (interestsSpec.length > 0) {
            addLog(`⚠️ Targeting bị từ chối (code 100): ${errMsg} — thử lại CHỈ với interests, bỏ behaviors...`);
            try {
              const interestsTargeting = { ...baseDemographic, flexible_spec: interestsSpec };
              adSetRes = await fbApiCall(
                `/act_${adAccountId}/adsets`,
                { ...adSetParams, targeting: interestsTargeting },
                `create-adset-${segment.segmentName}-interests-only`,
                token
              );
              addLog(`✅ Ad Set tạo với interests (đã bỏ behaviors) — GIỮ được độ tuổi và sở thích`);
            } catch (behErr: unknown) {
              const behErrMsg = behErr instanceof Error ? behErr.message : String(behErr);
              // Retry 2: demographic only — no criteria left, use Advantage+ broad
              addLog(`⚠️ Interests cũng lỗi: ${behErrMsg} — tạo Ad Set với nhân khẩu học thuần (Advantage+ broad, MẤT độ tuổi + sở thích)...`);
              adSetRes = await fbApiCall(
                `/act_${adAccountId}/adsets`,
                { ...adSetParams, targeting: pureDemographic },
                `create-adset-${segment.segmentName}-demographic`,
                token
              );
              addLog(`✅ Ad Set tạo với nhân khẩu học (vị trí + độ tuổi + giới tính)`);
              targetingDowngrades.push({
                segmentName: segment.segmentName, adSetId: adSetRes.id as string,
                originalTargeting: orig, reason: `Cả interests lẫn behaviors đều bị Meta từ chối (code 100): ${behErrMsg}`,
              });
            }
          } else {
            // Không có interests nào để giữ → xuống thẳng nhân khẩu học broad
            addLog(`⚠️ Không còn interests hợp lệ (code 100): ${errMsg} — tạo Ad Set với nhân khẩu học (Advantage+ broad, MẤT độ tuổi + sở thích)...`);
            adSetRes = await fbApiCall(
              `/act_${adAccountId}/adsets`,
              { ...adSetParams, targeting: pureDemographic },
              `create-adset-${segment.segmentName}-demographic`,
              token
            );
            addLog(`✅ Ad Set tạo với nhân khẩu học (vị trí + độ tuổi + giới tính)`);
            targetingDowngrades.push({
              segmentName: segment.segmentName, adSetId: adSetRes.id as string,
              originalTargeting: orig, reason: `Interests bị Meta từ chối (code 100): ${errMsg}`,
            });
          }
        } else {
          throw adSetErr;
        }
      }
      const adSetId = adSetRes.id as string;
      segmentAdSetMap[segment.segmentName] = adSetId;
      createdAdSetIds.push(adSetId);
      adSetCount++;
      addLog(`✅ Ad Set: ${adSetId}`);

      // A3.1 — ghi lại liên kết phân khúc ↔ ad set NGAY tại đây.
      //
      // Đây là mắt xích duy nhất không lấy lại được: Meta giữ ad set nhưng
      // không giữ Ý ĐỊNH đằng sau nó (phân khúc nào, sản phẩm gì, ai bấm, có bị
      // hạ cấp targeting không). Trước bản này, `segmentAdSetMap` sống đúng
      // trong một lời gọi hàm rồi biến mất — mỗi lượt launch trôi qua là mất
      // vĩnh viễn dữ liệu mà mọi phân tích hiệu quả sau này cần tới.
      const sentTargeting = (adSetRes.__sentTargeting ?? targeting) as Record<string, unknown>;
      const flexSpecOut = (sentTargeting.flexible_spec as Array<{ interests?: Array<{ id?: string; name?: string }> }> | undefined) ?? [];
      launchRecords.push({
        id: `sl_${Date.now()}_${adSetId}`,
        launchedAt: new Date().toISOString(),
        launchedBy: opts.actor ?? user.email,
        platform: "facebook",
        company: config.company ?? "",
        // Đợt 7b: wizard gửi productKey (mã sản phẩm) — lượt cũ không có thì rỗng, không bịa.
        productId: typeof config.productKey === "string" ? config.productKey.slice(0, 60) : "",
        campaignId,
        campaignName: config.campaignName,
        adSetId,
        segmentName: segment.segmentName,
        funnelStage: segment.funnelStage ?? "",
        interests: flexSpecOut.flatMap(g => (g.interests ?? []).map(i => ({ id: String(i.id ?? ""), name: String(i.name ?? "") }))).filter(i => i.id),
        ageMin: typeof sentTargeting.age_min === "number" ? sentTargeting.age_min : null,
        ageMax: typeof sentTargeting.age_max === "number" ? sentTargeting.age_max : null,
        // Vị trí đã được sanitize thành mã vùng của Meta trong `targeting`;
        // lấy từ đó thay vì từ segment (segment không mang trường này).
        locations: (() => {
          const geo = sentTargeting.geo_locations as { regions?: Array<{ key?: string }>; countries?: string[] } | undefined;
          return [
            ...(geo?.countries ?? []),
            ...(geo?.regions ?? []).map(r => String(r.key ?? "")).filter(Boolean),
          ];
        })(),
        // Đánh dấu ngay: ad set bị Meta hạ cấp targeting KHÔNG so sánh được với
        // ad set giữ nguyên targeting. Không ghi lúc này thì sau không biết.
        targetingDowngraded: targetingDowngrades.some(d => d.adSetId === adSetId),
        utmCampaign: config.autoUTM ? config.campaignName.slice(0, 40) : null,
      });

      // ── 3. Create Ads for this Ad Set ──
      let segCreatives = selectedCreatives.filter(
        c => c.segmentName === segment.segmentName || !c.segmentName
      );
      // Fallback: if no segment-specific creatives, reuse all selected creatives
      if (segCreatives.length === 0 && selectedCreatives.length > 0) {
        segCreatives = selectedCreatives;
        addLog(`ℹ️ Segment "${segment.segmentName}" không có creative riêng — dùng chung creative từ segment khác`);
      }

      for (const creative of segCreatives) {
        addLog(`🎨 Tạo Ad: ${creative.headline?.slice(0, 30)}...`);

        // Build creative object
        let adCreativeParams: Record<string, unknown>;
        const withUtm = (url: string) =>
          config.autoUTM
            ? `${url}${url.includes("?") ? "&" : "?"}utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=${encodeURIComponent(config.campaignName.slice(0, 40))}`
            : url;
        // Đợt 17: nguồn/kênh theo bảng link chuẩn (Đợt 9: facebook_ads / cpc_fb). utm_content = mã quảng cáo (Meta tự thay
        // {{ad.id}} lúc bấm) → GA4 đếm được đơn theo TỪNG quảng cáo. Chỉ gắn được lúc tạo: sửa creative đã chạy = duyệt lại.
        const urlTags = config.autoUTM ? { url_tags: "utm_content={{ad.id}}" } : {};

        if (creative.isExistingPost && creative.objectStoryId) {
          // Existing post ad. object_story_id points at an already-published
          // post, whose own content (text/image/link) Meta does not let us
          // rewrite — but Meta *does* allow overlaying a CTA button + link on
          // top of that post via a sibling `call_to_action` field, without
          // touching the organic post itself. Only attempt it when the
          // campaign has a destination URL to point at; some post types
          // (e.g. plain text posts) may still reject the overlay, so the
          // create call below falls back to the bare object_story_id if Meta
          // errors on the first attempt.
          adCreativeParams = {
            name: `${creative.toneLabel ?? "Creative"} — ${segment.segmentName}`,
            object_story_id: creative.objectStoryId,
            ...urlTags,
          };
          if (config.destinationUrl?.trim()) {
            adCreativeParams.call_to_action = {
              type: resolveCtaType(creative.cta),
              value: { link: withUtm(config.destinationUrl) },
            };
          }
        } else {
          // Standard creative
          const destinationUrl = withUtm(config.destinationUrl);

          const linkData: Record<string, unknown> = {
            link: destinationUrl,
            message: creative.primaryText,
            name: creative.headline,
            description: creative.description ?? "",
            call_to_action: {
              type: resolveCtaType(creative.cta),
              value: { link: destinationUrl },
            },
          };

          if (creative.imageHash) {
            linkData.image_hash = creative.imageHash;
          }

          adCreativeParams = {
            name: `${creative.toneLabel ?? "Creative"} — ${segment.segmentName}`,
            object_story_spec: {
              page_id: config.pageId,
              link_data: linkData,
            },
            ...urlTags,
          };
        }

        let adCreativeRes: Record<string, unknown>;
        try {
          adCreativeRes = await fbApiCall(
            `/act_${adAccountId}/adcreatives`,
            adCreativeParams,
            `create-creative-${creative.id ?? "unknown"}`,
            token
          );
        } catch (err) {
          // Some existing-post types (e.g. plain text/no-link posts) reject
          // the call_to_action overlay outright — retry once with the bare
          // object_story_id so the ad still launches, just without a CTA.
          if (creative.isExistingPost && adCreativeParams.call_to_action) {
            addLog(`⚠️ Bài viết không nhận nút CTA/URL (${err instanceof Error ? err.message : String(err)}) — tạo lại ad không có CTA`);
            const fallbackParams = { ...adCreativeParams };
            delete fallbackParams.call_to_action;
            adCreativeRes = await fbApiCall(
              `/act_${adAccountId}/adcreatives`,
              fallbackParams,
              `create-creative-${creative.id ?? "unknown"}-fallback`,
              token
            );
          } else {
            throw err;
          }
        }
        const adCreativeId = adCreativeRes.id as string;

        // Create Ad
        const adRes = await fbApiCall(
          `/act_${adAccountId}/ads`,
          {
            name: `${creative.toneLabel ?? "Ad"} — ${segment.segmentName}`,
            adset_id: adSetId,
            creative: { creative_id: adCreativeId },
            status: launchStatus,
          },
          `create-ad-${creative.id ?? "unknown"}`,
          token
        );
        createdAdIds.push(adRes.id as string);
        adCount++;
        addLog(`✅ Ad tạo thành công`);

        // Small delay between ads
        await new Promise(r => setTimeout(r, 500));
      }
    }

    addLog(config.launchActive
      ? `🎉 Hoàn thành! ${adSetCount} ad sets, ${adCount} ads — ĐANG CHẠY THẬT, đã bắt đầu tiêu ngân sách.`
      : `🎉 Hoàn thành! ${adSetCount} ad sets, ${adCount} ads — đang TẮT, vào Facebook Ads Manager để bật khi sẵn sàng.`);

    // Ghi sổ SAU khi mọi thứ đã tạo thật. Hàm này không bao giờ ném — campaign
    // đã có trên Meta rồi, một lỗi ghi sổ không được biến lượt launch thành
    // công thành lỗi.
    await recordSegmentLaunch(launchRecords);
    await recordPlaybookUsage({
      by: opts.actor ?? user.email, company: config.company ?? "", platform: "facebook",
      productKey: typeof config.productKey === "string" ? config.productKey.slice(0, 60) : "",
      campaignId, campaignName: config.campaignName,
      entryIds: cleanIds(config.playbookEntryIds), overriddenAvoidIds: cleanIds(config.playbookOverriddenAvoidIds),
    });
    addLog(`📓 Đã ghi ${launchRecords.length} liên kết phân khúc ↔ ad set để đối chiếu hiệu quả sau này`);

    // Link each generated creative to this campaign for feedback loop tracking.
    // Non-blocking (fire-and-forget) — errors here never affect the launch response.
    for (const creative of selectedCreatives) {
      if (creative.id) {
        linkCreativeToCampaign(creative.id, campaignId, config.campaignName).catch(() => {
          // Best-effort tracking — never block launch
        });
      }
    }

    const result: LaunchResult = {
      success: true,
      campaignId,
      campaignName: config.campaignName,
      adSetCount,
      adCount: adCount,
      launchActive: config.launchActive ?? false,
    };

    return { ...result, log, targetingDowngrades };
  } catch (err: unknown) {
    // Lỗi kiểm tra đầu vào (trước khi tạo gì trên Meta) — trả nguyên như route cũ, không dọn, không bọc thành 500.
    if (err instanceof LaunchHttpError) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    addLog(`❌ Lỗi: ${message}`);

    // Roll back whatever was already created on Meta before the failure —
    // otherwise a mid-pipeline error (e.g. an Ad failing after its Campaign
    // and AdSets succeeded) leaves orphaned PAUSED shells in the ad account
    // forever. Ads first, then AdSets, then the Campaign itself — deleting
    // a parent while children still reference it can itself error.
    if (campaignId) {
      addLog(`🧹 Rollback: dọn ${createdAdIds.length} ad, ${createdAdSetIds.length} ad set, 1 campaign đã tạo dở...`);
      for (const adId of createdAdIds.reverse()) {
        const r = await rollbackMetaObject(adId, "ad", token);
        addLog(r.ok ? `  ✅ Đã xóa Ad ${adId}` : `  ⚠️ Không xóa được Ad ${adId}: ${r.error}`);
      }
      for (const adSetId of createdAdSetIds.reverse()) {
        const r = await rollbackMetaObject(adSetId, "adset", token);
        addLog(r.ok ? `  ✅ Đã xóa Ad Set ${adSetId}` : `  ⚠️ Không xóa được Ad Set ${adSetId}: ${r.error}`);
      }
      const campaignRollback = await rollbackMetaObject(campaignId, "campaign", token);
      addLog(campaignRollback.ok
        ? `  ✅ Đã xóa Campaign ${campaignId} — không để lại rác trên tài khoản`
        : `  ⚠️ Không xóa được Campaign ${campaignId}: ${campaignRollback.error} — cần xóa thủ công trên Ads Manager`);
    }

    throw new LaunchHttpError(500, { success: false, error: friendlyError(message), log });
  }
}
