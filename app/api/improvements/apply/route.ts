// ============================================================
// POST /api/improvements/apply
// ============================================================
// The Improvements page (app/(dashboard)/improvements/page.tsx) has
// always called this exact URL for apply/undo/dismiss/bulk actions —
// but this route.ts never existed (empty directory), so every button
// on that page silently 404'd. This is the real implementation.
//
// Body shapes (frontend already sends these, matched here):
//   apply:   { improvementId, company, applyPayload: {action, ...} }
//   undo:    { improvementId, company, undo: true }
//   dismiss: { improvementId, company, dismiss: true }
//   bulk:    { company, bulk: true, items: [{id, applyPayload}, ...] }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { GOOGLE_CUSTOMER_IDS, getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { resolveAlert } from "@/lib/alert-engine";
import { dismissImprovement } from "@/lib/improvements-store";
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard";
import { applyDeviceBidModifier, readDeviceCriteria, type BidDevice } from "@/lib/google-device-bid";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { recordApply, findUndoable, markUndone } from "@/lib/apply-undo-log";
import { friendlyError } from "@/lib/not-configured";

export type Company = string;

export interface ApplyPayload {
  action?: string;
  resourceName?: string;
  budgetResourceName?: string;
  newBudgetMicros?: number;
  targetCPAMicros?: number;
  campaignId?: string;
  campaignName?: string;
  campaignResource?: string;
  device?: string;
  bidModifier?: number;
  alertId?: string;
  term?: string;
  matchType?: string;
  newCpcMicros?: number;
}

export interface ApplyResult {
  success: boolean;
  error?: string;
  redirect?: string;
  warning?: string;
  /** Giá trị TRƯỚC khi ghi đè, để chỗ gọi ghi vào nhật ký hoàn tác.
   *  `undefined` = không đọc được → mục này sẽ KHÔNG hoàn tác được, và ta nói
   *  thẳng điều đó thay vì để người dùng tưởng lúc nào cũng gỡ được. */
  undoBefore?: Record<string, unknown>;
  /** Tài nguyên đã bị sửa — khoá để hoàn tác. */
  undoResource?: string;
}

// Exported for reuse by app/api/cron/improvements-auto-apply — the real
// per-action Google/Meta mutations live here once; the cron calls this same
// function in-process instead of duplicating the switch.
export async function applyOne(company: Company, payload: ApplyPayload): Promise<ApplyResult> {
  const customer = getGoogleAdsCustomer(company);
  const action = payload.action;
  /** Giá trị cũ đọc được ngay trước khi ghi. Các nhánh dưới gán vào đây. */
  let undoBefore: Record<string, unknown> | undefined;

  /**
   * Đọc giá trị HIỆN TẠI trước khi ghi đè — thứ duy nhất khiến Undo có nghĩa.
   *
   * KHÔNG ném lỗi: đọc hụt thì mất khả năng hoàn tác cho mục đó, nhưng chặn cả
   * lượt apply vì một truy vấn đọc là đánh đổi sai. Trả `null` và đi tiếp;
   * chỗ gọi sẽ không ghi nhật ký, nên không bao giờ có bản hoàn tác rỗng nghĩa.
   */
  const readBefore = async (gaql: string): Promise<Record<string, unknown> | null> => {
    try {
      const rows = (await customer.query(gaql)) as unknown as Array<Record<string, unknown>>;
      return rows[0] ?? null;
    } catch (err) {
      console.error("[improvements/apply] không đọc được giá trị cũ:", googleAdsErrorMessage(err));
      return null;
    }
  };

  switch (action) {
    case "PAUSE_KEYWORD": {
      if (!payload.resourceName) return { success: false, error: "Thiếu resourceName" };
      const prev = await readBefore(`SELECT ad_group_criterion.resource_name, ad_group_criterion.status
        FROM keyword_view WHERE ad_group_criterion.resource_name = '${String(payload.resourceName).replace(/'/g, "")}'`);
      await customer.adGroupCriteria.update([{
        resource_name: payload.resourceName,
        status: "PAUSED",
      }]);
      // Ghi SAU khi Google xác nhận — ghi trước rồi lệnh hỏng sẽ để lại một
      // bản "hoàn tác" cho thay đổi chưa từng xảy ra.
      const before = (prev?.ad_group_criterion as { status?: unknown } | undefined)?.status;
      if (before !== undefined) undoBefore = { status: before };
      return { success: true, undoBefore, undoResource: payload.resourceName };
    }

    // Keyword-level bid change from the new "Từ khóa" view in Improvements
    // (see /home/coder/.claude/plans/flickering-wandering-robin.md).
    // Deliberately does NOT go through lib/mutation-guard.ts — that module
    // is scoped to campaign-level budget/bid decisions where two systems
    // could collide (see its own file header comment); a single keyword's
    // CPC bid is the same fine-grained class of mutation as PAUSE_KEYWORD
    // above, which also skips it.
    case "UPDATE_KEYWORD_CPC":
      if (!payload.resourceName || payload.newCpcMicros === undefined) {
        return { success: false, error: "Thiếu resourceName/newCpcMicros" };
      }
      if (payload.newCpcMicros <= 0) {
        return { success: false, error: "CPC mới phải lớn hơn 0" };
      }
      {
        const prev = await readBefore(`SELECT ad_group_criterion.resource_name, ad_group_criterion.cpc_bid_micros
          FROM keyword_view WHERE ad_group_criterion.resource_name = '${String(payload.resourceName).replace(/'/g, "")}'`);
        await customer.adGroupCriteria.update([{
          resource_name: payload.resourceName,
          cpc_bid_micros: payload.newCpcMicros,
        }]);
        const before = (prev?.ad_group_criterion as { cpc_bid_micros?: unknown } | undefined)?.cpc_bid_micros;
        if (before !== undefined) undoBefore = { cpc_bid_micros: before };
      }
      return { success: true, undoBefore, undoResource: payload.resourceName };

    case "UPDATE_BUDGET": {
      if (!payload.budgetResourceName || payload.newBudgetMicros === undefined) {
        return { success: false, error: "Thiếu budgetResourceName/newBudgetMicros" };
      }
      const warning = payload.campaignId
        ? checkRecentCampaignMutation(payload.campaignId, company, "human_manual").note ?? undefined
        : undefined;
      const prevBudget = await readBefore(`SELECT campaign_budget.resource_name, campaign_budget.amount_micros
        FROM campaign_budget WHERE campaign_budget.resource_name = '${String(payload.budgetResourceName).replace(/'/g, "")}'`);
      await customer.campaignBudgets.update([{
        resource_name: payload.budgetResourceName,
        amount_micros: payload.newBudgetMicros,
      }]);
      const beforeBudget = (prevBudget?.campaign_budget as { amount_micros?: unknown } | undefined)?.amount_micros;
      if (beforeBudget !== undefined) undoBefore = { amount_micros: beforeBudget };
      if (payload.campaignId) {
        recordCampaignMutation({
          source: { type: "human_manual", actor: "improvements-apply" },
          event: payload.newBudgetMicros > 0 ? "budget.increase" : "budget.decrease",
          company,
          campaignId: payload.campaignId,
          campaignName: payload.campaignName ?? "",
          rationale: "Applied via Improvements UI — INCREASE_BUDGET_CAPPED",
        });
      }
      return { success: true, warning, undoBefore, undoResource: payload.budgetResourceName };
    }

    case "UPDATE_TARGET_CPA": {
      const resourceName = payload.resourceName || payload.campaignResource;
      if (!resourceName || payload.targetCPAMicros === undefined) {
        return { success: false, error: "Thiếu resourceName/targetCPAMicros" };
      }
      const warning = payload.campaignId
        ? checkRecentCampaignMutation(payload.campaignId, company, "human_manual").note ?? undefined
        : undefined;
      // P4a — ảnh chụp trước khi ghi.
      // Chiến dịch CHƯA từng đặt target CPA thì `target_cpa_micros` về undefined.
      // Khi đó KHÔNG ghi nhật ký: "khôi phục về trạng thái chưa đặt" không phải
      // là đặt lại một con số, và đoán bừa một giá trị còn tệ hơn nói thẳng là
      // không hoàn tác được.
      const prevCpa = await readBefore(`SELECT campaign.resource_name, campaign.target_cpa.target_cpa_micros
        FROM campaign WHERE campaign.resource_name = '${String(resourceName).replace(/'/g, "")}'`);
      const beforeCpa = (prevCpa?.campaign as { target_cpa?: { target_cpa_micros?: number } } | undefined)
        ?.target_cpa?.target_cpa_micros;
      if (beforeCpa !== undefined && beforeCpa !== null) {
        undoBefore = { target_cpa_micros: Number(beforeCpa) };
      }
      await customer.campaigns.update([{
        resource_name: resourceName,
        target_cpa: { target_cpa_micros: payload.targetCPAMicros },
      }]);
      if (payload.campaignId) {
        recordCampaignMutation({
          source: { type: "human_manual", actor: "improvements-apply" },
          event: "budget.decrease",
          company,
          campaignId: payload.campaignId,
          campaignName: payload.campaignName ?? "",
          rationale: "Applied via Improvements UI — LOWER_TARGET_CPA",
        });
      }
      return { success: true, warning, undoBefore, undoResource: resourceName };
    }

    case "ADD_NEGATIVE":
      if (!payload.campaignResource || !payload.term) {
        return { success: false, error: "Thiếu campaignResource/term" };
      }
      {
        // P4a — hoàn tác cho ADD_NEGATIVE khác hẳn ba ca kia: ở đây không có
        // "giá trị cũ" để đặt lại, vì thứ vừa tạo TRƯỚC ĐÓ KHÔNG TỒN TẠI.
        // Hoàn tác = XOÁ đúng tiêu chí vừa tạo, nên thứ phải lưu là
        // resource_name Google trả về. Không lấy được tên đó thì không ghi
        // nhật ký — thà nói không hoàn tác được còn hơn để lại một bản ghi
        // không dùng được.
        const created = await customer.campaignCriteria.create([{
          campaign: payload.campaignResource,
          negative: true,
          keyword: {
            text: payload.term,
            match_type: payload.matchType === "EXACT" ? "EXACT" : "PHRASE",
          },
        }]) as unknown as { results?: Array<{ resource_name?: string }> };
        const createdName = created?.results?.[0]?.resource_name;
        if (createdName) {
          return {
            success: true,
            undoBefore: { negative_keyword_created: payload.term },
            undoResource: createdName,
          };
        }
        return { success: true };
      }

    case "UPDATE_DEVICE_BID": {
      if (!payload.campaignId || !payload.device || payload.bidModifier === undefined) {
        return { success: false, error: "Thiếu campaignId/device/bidModifier" };
      }
      const warning = checkRecentCampaignMutation(payload.campaignId, company, "human_manual").note ?? undefined;
      // Hệ số giá thầu theo thiết bị nằm ở `campaign_criterion`, KHÔNG phải ở
      // một trường `device_bid_modifiers` trên Campaign — trường đó không tồn
      // tại. Vì chỗ này ép kiểu `as unknown as ...` nên TypeScript im lặng,
      // còn protobuf thì lặng lẽ bỏ trường lạ đi: lệnh gửi lên chỉ còn
      // resource_name, update_mask rỗng, Google từ chối. Nhánh này chưa bao
      // giờ chạy được — kể cả khi cron improvements-auto-apply tự bấm, vì
      // UPDATE_DEVICE_BID nằm trong danh sách được tự động áp dụng.
      // Theo công ty của bản cài + chế độ cổng (trước 26/10/2026 đọc cứng MBC/MBI — bản cài khách không có).
      const customerId = GOOGLE_CUSTOMER_IDS[company] ?? "";
      if (!customerId) return { success: false, error: "Chưa cấu hình Google Ads customer ID" };

      const deviceRes = await applyDeviceBidModifier(customer, {
        customerId,
        campaignId: payload.campaignId,
        device: payload.device as BidDevice,
        bidModifier: payload.bidModifier,
      });
      if (!deviceRes.applied) {
        return { success: false, error: deviceRes.error ?? "Không đặt được hệ số giá thầu thiết bị" };
      }
      // P4a — `applyDeviceBidModifier` đã trả sẵn `mode` và `previousModifier`,
      // nên không cần đọc thêm một lượt nữa.
      //   mode "update" → trước đó ĐÃ có hệ số: hoàn tác = đặt lại số cũ.
      //   mode "create" → trước đó CHƯA có tiêu chí thiết bị này: hoàn tác =
      //                   XOÁ tiêu chí vừa tạo, không phải đặt về 1.0 (1.0 là
      //                   "có tiêu chí, không điều chỉnh" — khác "không có").
      // resource_name của tiêu chí không được trả về, nhưng tra lại lúc hoàn
      // tác qua readDeviceCriteria là đủ và tránh lưu thừa.
      // BA trạng thái, không phải hai — đo trên tài khoản MBC ngày 24/09:
      // cả ba tiêu chí thiết bị của campaign đang chạy đều TỒN TẠI nhưng
      // `bidModifier = null`. Bản đầu coi `previousModifier === null` là
      // "tiêu chí chưa từng có" nên hoàn tác sẽ XOÁ một tiêu chí đang tồn
      // tại — đổi cả cách nhắm mục tiêu của chiến dịch.
      //
      //   mode "create"                     → chưa có tiêu chí → hoàn tác = XOÁ
      //   mode "update" + previous là số    → hoàn tác = đặt lại số cũ
      //   mode "update" + previous là null  → tiêu chí CÓ nhưng chưa đặt hệ số.
      //        Đưa về đúng trạng thái "có tiêu chí, chưa đặt hệ số" cần gỡ
      //        hẳn trường bid_modifier, mà thư viện này lặng lẽ bỏ trường khi
      //        truyền null (đúng cái bẫy protobuf đã ghi ở đầu case này).
      //        KHÔNG ghi nhật ký cho ca đó — thà nói thẳng là không hoàn tác
      //        được còn hơn để lại một nút bấm vào thì xoá nhầm.
      if (deviceRes.mode === "create") {
        undoBefore = {
          device_bid_modifier: null,
          device_criterion_existed: false,
          device: payload.device,
          campaign_id: payload.campaignId,
        };
      } else if (deviceRes.previousModifier !== null && deviceRes.previousModifier !== undefined) {
        undoBefore = {
          device_bid_modifier: deviceRes.previousModifier,
          device_criterion_existed: true,
          device: payload.device,
          campaign_id: payload.campaignId,
        };
      }
      recordCampaignMutation({
        source: { type: "human_manual", actor: "improvements-apply" },
        event: "adset.bid_strategy_change",
        company,
        campaignId: payload.campaignId,
        campaignName: payload.campaignName ?? "",
        rationale: "Applied via Improvements UI — DEVICE_BID_ADJUSTMENT",
      });
      return { success: true, warning, undoBefore, undoResource: payload.campaignId };
    }

    case "RESOLVE_ALERT":
      if (!payload.alertId) return { success: false, error: "Thiếu alertId" };
      await resolveAlert(payload.alertId, "Applied via Improvements UI");
      return { success: true };

    case "IMPROVE_PMAX_ASSETS":
    case "FIX_AD_STRENGTH":
      // Bug fix: the previous (unreachable, dead-code) implementation
      // redirected to /creative-ai, which is not a page route (only
      // app/api/creative-ai exists) — the real Creative AI Studio page
      // is /creative.
      return { success: true, redirect: `/creative?adResource=${payload.resourceName ?? ""}` };

    default:
      return { success: false, error: `Chưa hỗ trợ tự động áp dụng cho hành động "${action}". Vui lòng thực hiện thủ công trên Google/Meta Ads Manager.` };
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    improvementId?: string;
    company?: Company;
    applyPayload?: ApplyPayload;
    undo?: boolean;
    dismiss?: boolean;
    bulk?: boolean;
    items?: { id: string; applyPayload: ApplyPayload }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  if (body.dismiss) {
    if (!body.improvementId || !body.company) {
      return NextResponse.json({ success: false, error: "Thiếu improvementId/company" }, { status: 400 });
    }
    if (!canAccessCompany(user, body.company)) {
      return NextResponse.json({ success: false, error: "Không có quyền truy cập công ty này" }, { status: 403 });
    }
    await dismissImprovement(body.improvementId, body.company);
    return NextResponse.json({ success: true });
  }

  // Everything below performs a real Google/Meta Ads mutation.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền áp dụng thay đổi" }, { status: 403 });
  }

  if (body.undo) {
    // Undo nay CHẠY THẬT với những thay đổi có ghi lại giá trị cũ
    // (lib/apply-undo-log). Mục không có bản ghi thì vẫn nói thẳng là không
    // hoàn tác được — thà từ chối rõ ràng còn hơn báo thành công giả rồi để
    // người dùng tưởng chiến dịch đã về như cũ.
    if (!body.improvementId || !body.company) {
      return NextResponse.json({ success: false, error: "Thiếu improvementId/company" }, { status: 400 });
    }
    const entry = findUndoable(String(body.improvementId));
    // Audit 30/09: hoàn tác phải qua đúng phép kiểm công ty như áp dụng — trước đây nhánh này dùng body.company
    // cho khách hàng Google và không đối chiếu với công ty của bản ghi → admin_mbc hoàn tác được thay đổi của MBI.
    if (entry && (entry.company !== body.company || !canAccessCompany(user, entry.company as string))) {
      return NextResponse.json({ success: false, error: "Không có quyền truy cập công ty này" }, { status: 403 });
    }
    if (!entry) {
      return NextResponse.json({
        success: false,
        error: "Không hoàn tác được: tool không lưu giá trị cũ của thay đổi này "
             + "(áp dụng trước khi có nhật ký hoàn tác, hoặc lúc đó không đọc được giá trị cũ). "
             + "Phải sửa tay trên Google/Meta Ads.",
      }, { status: 501 });
    }

    try {
      const customer = getGoogleAdsCustomer(entry.company as typeof body.company);
      const b = entry.before;
      // Nhật ký lưu JSON thuần nên giá trị về dạng `unknown`. Ép kiểu ở ĐÂY,
      // sau khi đã kiểm trường tồn tại — giá trị này do chính tool ghi ra từ
      // phản hồi của Google, không phải dữ liệu người dùng nhập.
      if ("status" in b) {
        await customer.adGroupCriteria.update([{
          resource_name: entry.resourceName,
          status: b.status as "ENABLED" | "PAUSED" | "REMOVED",
        }]);
      } else if ("cpc_bid_micros" in b) {
        await customer.adGroupCriteria.update([{
          resource_name: entry.resourceName,
          cpc_bid_micros: Number(b.cpc_bid_micros),
        }]);
      } else if ("amount_micros" in b) {
        await customer.campaignBudgets.update([{
          resource_name: entry.resourceName,
          amount_micros: Number(b.amount_micros),
        }]);
      } else if ("target_cpa_micros" in b) {
        await customer.campaigns.update([{
          resource_name: entry.resourceName,
          target_cpa: { target_cpa_micros: Number(b.target_cpa_micros) },
        }]);
      } else if ("negative_keyword_created" in b) {
        // Thứ vừa tạo trước đó không tồn tại → hoàn tác là XOÁ nó đi.
        await customer.campaignCriteria.remove([entry.resourceName]);
      } else if ("device_bid_modifier" in b) {
        const customerId = GOOGLE_CUSTOMER_IDS[body.company] ?? "";
        if (!customerId) {
          return NextResponse.json({ success: false, error: "Chưa cấu hình Google Ads customer ID" }, { status: 500 });
        }
        const prev = b.device_bid_modifier;
        // Phân biệt bằng `device_criterion_existed`, KHÔNG bằng `prev === null`.
        // `prev === null` xảy ra ở cả hai trạng thái rất khác nhau; xem ghi chú
        // ở chỗ ghi ảnh chụp.
        if (b.device_criterion_existed === false) {
          // Trước đó CHƯA có tiêu chí thiết bị — hoàn tác là xoá cái vừa tạo.
          const existing = await readDeviceCriteria(customer, String(b.campaign_id));
          const row = existing.get(b.device as BidDevice);
          if (!row) {
            return NextResponse.json({
              success: false,
              error: "Không tìm thấy tiêu chí thiết bị để xoá — có thể đã bị gỡ tay trước đó.",
            }, { status: 409 });
          }
          await customer.campaignCriteria.remove([row.resourceName]);
        } else if (prev === null || prev === undefined) {
          // Không nên tới được đây (ca này không ghi nhật ký), nhưng nếu có
          // bản ghi cũ từ trước khi sửa thì TỪ CHỐI, không đoán.
          return NextResponse.json({
            success: false,
            error: "Bản ghi cũ không phân biệt được 'chưa có tiêu chí' với 'có tiêu chí nhưng chưa đặt hệ số' — từ chối hoàn tác để khỏi xoá nhầm. Sửa tay trên Google Ads.",
          }, { status: 409 });
        } else {
          const res = await applyDeviceBidModifier(customer, {
            customerId,
            campaignId: String(b.campaign_id),
            device: b.device as BidDevice,
            bidModifier: Number(prev),
          });
          if (!res.applied) {
            return NextResponse.json({
              success: false,
              error: res.error ?? "Không khôi phục được hệ số giá thầu thiết bị",
            }, { status: 502 });
          }
        }
      } else {
        return NextResponse.json({
          success: false,
          error: `Không hoàn tác được loại thay đổi "${entry.action}" — chưa có đường khôi phục cho nó.`,
        }, { status: 501 });
      }
      markUndone(entry.id);
      return NextResponse.json({
        success: true,
        message: `Đã khôi phục về giá trị trước khi áp dụng (${new Date(entry.appliedAt).toLocaleString("vi-VN")}).`,
      });
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: `Google từ chối lệnh khôi phục: ${googleAdsErrorMessage(err)}`,
      }, { status: 502 });
    }
  }

  if (body.bulk) {
    if (!body.company || !Array.isArray(body.items)) {
      return NextResponse.json({ success: false, error: "Thiếu company/items" }, { status: 400 });
    }
    if (!canAccessCompany(user, body.company)) {
      return NextResponse.json({ success: false, error: "Không có quyền truy cập công ty này" }, { status: 403 });
    }
    const results = await Promise.all(
      body.items.map(async (item) => {
        const r = await applyOne(body.company as Company, item.applyPayload);
        // Ghi nhật ký SAU khi Google xác nhận, và chỉ khi đọc được giá trị cũ.
        // Không có giá trị cũ thì không ghi — thà không có bản hoàn tác còn
        // hơn có một bản rỗng nghĩa mà bấm vào lại phá thêm.
        if (r.success && r.undoBefore && r.undoResource) {
          recordApply({
            improvementId: item.id,
            company: String(body.company),
            action: String(item.applyPayload?.action ?? ""),
            resourceName: r.undoResource,
            label: String((item.applyPayload as Record<string, unknown>)?.campaignName ?? ""),
            before: r.undoBefore,
            after: (item.applyPayload ?? {}) as Record<string, unknown>,
          });
        }
        return { id: item.id, ...r };
      })
    );
    const applied = results.filter((r) => r.success).length;
    return NextResponse.json({
      success: applied > 0,
      applied,
      failed: results.length - applied,
      results,
    });
  }

  if (!body.company || !body.applyPayload) {
    return NextResponse.json({ success: false, error: "Thiếu company/applyPayload" }, { status: 400 });
  }
  if (!canAccessCompany(user, body.company)) {
    return NextResponse.json({ success: false, error: "Không có quyền truy cập công ty này" }, { status: 403 });
  }

  try {
    const result = await applyOne(body.company, body.applyPayload);
    if (result.success && result.undoBefore && result.undoResource && body.improvementId) {
      recordApply({
        improvementId: String(body.improvementId),
        company: String(body.company),
        action: String(body.applyPayload?.action ?? ""),
        resourceName: result.undoResource,
        label: String((body.applyPayload as Record<string, unknown>)?.campaignName ?? ""),
        before: result.undoBefore,
        after: (body.applyPayload ?? {}) as Record<string, unknown>,
      });
    }
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[improvements/apply] error:", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
