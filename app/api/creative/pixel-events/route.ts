// ============================================================
// GET /api/creative/pixel-events?pixelId=<id>&days=28
// ============================================================
// Trả về đúng danh sách sự kiện chuyển đổi mà Ads Manager hiển thị khi chọn
// "Sự kiện chuyển đổi" cho một Pixel:
//
//   1. Sự kiện ĐANG HOẠT ĐỘNG  — lấy thật từ /{pixel_id}/stats?aggregation=event,
//      gồm cả sự kiện tiêu chuẩn (Purchase, ViewContent…) lẫn sự kiện tuỳ
//      chỉnh do web tự bắn (thank_page, form_submit, checkout_customer_info…).
//   2. Chuyển đổi tuỳ chỉnh    — lấy thật từ /act_<id>/customconversions
//      (vd "Mua hàng (Hoàn thành)").
//   3. Sự kiện tiêu chuẩn còn lại — danh mục tĩnh, xếp cuối, KHÔNG gắn nhãn
//      hoạt động vì chúng chưa từng bắn về trong cửa sổ thống kê.
//
// Nguyên tắc số liệu: chấm "đang hoạt động" và số lượt chỉ được hiển thị khi
// lệnh /stats THẬT SỰ thành công. Nếu hỏng, `activityKnown = false` và mọi
// `count`/`active` để trống — thà nói "không rõ" còn hơn vẽ chấm xanh cho
// một sự kiện đã chết.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  STANDARD_PIXEL_EVENTS,
  type ConversionEventOption,
  type PixelEventsPayload,
  parsePixelStats,
} from "@/lib/meta-pixel-events";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { getT } from "@/lib/i18n/server";
import { labelForStandardEvent } from "@/lib/meta-pixel-events";

const BASE_URL = META_GRAPH_BASE;

/** Sự kiện Pixel không dùng làm mục tiêu tối ưu chuyển đổi được — Meta không
 *  có enum custom_event_type cho chúng và Ads Manager cũng không liệt kê. */
const NON_CONVERSION_EVENTS = new Set(["pageview", "microdata", "subscribedbutton_click"]);

interface CustomConversionRaw {
  id: string;
  name?: string;
  custom_event_type?: string;
  is_archived?: boolean;
  pixel?: { id?: string };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t = await getT();
  const pixelId = req.nextUrl.searchParams.get("pixelId")?.trim() ?? "";
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 28) || 28, 1), 90);

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  const warnings: string[] = [];
  const eventCounts = new Map<string, number>();
  let activityKnown = false;
  let customConversions: CustomConversionRaw[] = [];
  let anyLiveCall = false;

  if (!token || !adAccountId) {
    warnings.push(t("libmeta.pixel.noConfig"));
  } else {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - days * 86400;

    const statsPromise = pixelId
      ? fetch(`${BASE_URL}/${pixelId}/stats?aggregation=event&start_time=${startTime}&end_time=${endTime}&access_token=${token}`)
          .then(async (r) => {
            const json = await r.json();
            if (json?.error) throw new Error(json.error.message ?? t("libmeta.pixel.unknownError"));
            return json;
          })
      : Promise.reject(new Error(t("libmeta.pixel.noPixel")));

    const ccPromise = fetch(
      `${BASE_URL}/act_${adAccountId}/customconversions?fields=id,name,custom_event_type,is_archived,pixel{id}&limit=200&access_token=${token}`
    ).then(async (r) => {
      const json = await r.json();
      if (json?.error) throw new Error(json.error.message ?? t("libmeta.pixel.unknownError"));
      return json;
    });

    const [statsRes, ccRes] = await Promise.allSettled([statsPromise, ccPromise]);

    if (statsRes.status === "fulfilled") {
      const parsed = parsePixelStats(statsRes.value);
      for (const [k, v] of parsed) eventCounts.set(k, v);
      activityKnown = true;
      anyLiveCall = true;
    } else {
      warnings.push(t("libmeta.pixel.statsFail", { msg: statsRes.reason instanceof Error ? statsRes.reason.message : String(statsRes.reason) }));
    }

    if (ccRes.status === "fulfilled") {
      const rows = (ccRes.value as { data?: CustomConversionRaw[] }).data ?? [];
      // Chuyển đổi tuỳ chỉnh gắn với Pixel khác thì không dùng được cho Pixel
      // đang chọn. Meta trả `pixel` rỗng ở một số bản ghi cũ — khi không biết
      // nó thuộc Pixel nào thì vẫn giữ, còn hơn giấu mất lựa chọn có thật.
      customConversions = rows.filter(
        (c) => !c.is_archived && (!pixelId || !c.pixel?.id || c.pixel.id === pixelId)
      );
      anyLiveCall = true;
    } else {
      warnings.push(t("libmeta.pixel.ccFail", { msg: ccRes.reason instanceof Error ? ccRes.reason.message : String(ccRes.reason) }));
    }
  }

  // ── Ghép danh sách ──
  const options: ConversionEventOption[] = [];
  const seenPixelNames = new Set<string>();

  // 1. Sự kiện tiêu chuẩn — kèm số lượt thật nếu đọc được
  for (const ev of STANDARD_PIXEL_EVENTS) {
    const count = eventCounts.get(ev.pixelName);
    seenPixelNames.add(ev.pixelName.toLowerCase());
    options.push({
      key: `standard:${ev.enumValue}`,
      kind: "standard",
      label: labelForStandardEvent(ev.enumValue, t),
      sublabel: ev.pixelName,
      enumValue: ev.enumValue,
      pixelEventName: ev.pixelName,
      count: activityKnown ? count ?? 0 : undefined,
      active: activityKnown ? (count ?? 0) > 0 : undefined,
    });
  }

  // 2. Sự kiện tuỳ chỉnh web tự bắn (thank_page, form_submit…) — chỉ những cái
  //    THẬT SỰ có trong /stats, không bịa thêm cái nào.
  for (const [name, count] of eventCounts) {
    const lower = name.toLowerCase();
    if (seenPixelNames.has(lower) || NON_CONVERSION_EVENTS.has(lower)) continue;
    options.push({
      key: `custom_event:${name}`,
      kind: "custom_event",
      label: name,
      sublabel: t("libmeta.pixel.customEventSub"),
      pixelEventName: name,
      count,
      active: count > 0,
    });
  }

  // 3. Chuyển đổi tuỳ chỉnh
  for (const cc of customConversions) {
    options.push({
      key: `custom_conversion:${cc.id}`,
      kind: "custom_conversion",
      label: cc.name?.trim() || t("libmeta.pixel.ccName", { id: cc.id }),
      sublabel: t("libmeta.pixel.ccSub"),
      customConversionId: cc.id,
      enumValue: cc.custom_event_type,
    });
  }

  const payload: PixelEventsPayload = {
    pixelId,
    options,
    statsWindowDays: days,
    activityKnown,
    source: anyLiveCall ? "live" : "fallback",
    warnings,
  };
  return NextResponse.json(payload);
}
