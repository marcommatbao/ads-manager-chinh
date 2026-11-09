// ============================================================
// Đặt hệ số giá thầu theo thiết bị (device bid modifier)
// ============================================================
// VÌ SAO CÓ FILE NÀY: hai nơi trong repo cùng ghi
//     campaigns.update([{ resource_name, device_bid_modifiers: [...] }])
// — Google Audit Auto-Fix và Improvements Apply. Trường
// `device_bid_modifiers` KHÔNG TỒN TẠI trên resource Campaign của Google
// Ads API. Vì cả hai chỗ đều ép kiểu `as unknown as ...`, TypeScript im
// lặng; còn protobuf thì LẲNG LẶNG BỎ trường lạ khi tuần tự hoá:
//
//     resources.Campaign.fromObject({ resource_name, device_bid_modifiers })
//     → toObject() = { resource_name }          // trường kia biến mất
//
// Thư viện dựng update_mask TỪ object đã tuần tự hoá và bỏ qua
// `resourceName`, nên field mask rỗng → Google từ chối lệnh. Nói cách
// khác: điều chỉnh giá thầu theo thiết bị CHƯA BAO GIỜ chạy được ở cả hai
// nơi, kể cả khi cron auto-apply tự bấm.
//
// Đường đi đúng của Google Ads là `campaign_criterion` mang tiêu chí
// DEVICE kèm `bid_modifier`. Đặt chung một chỗ để hai nhánh không thể
// lệch nhau lần nữa.

import type { Customer } from "google-ads-api";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
export type BidDevice = "MOBILE" | "DESKTOP" | "TABLET";

export interface DeviceBidResult {
  /** Đã gửi lệnh đi thật hay chưa. */
  applied: boolean;
  /** "create" = campaign chưa có tiêu chí thiết bị này, "update" = đã có. */
  mode: "create" | "update" | null;
  /** Hệ số cũ (null nếu trước đó chưa đặt) — để báo cho người dùng biết đổi từ đâu sang đâu. */
  previousModifier: number | null;
  error: string | null;
}

/** Resource name của campaign từ customer id + campaign id. */
export function campaignResourceName(customerId: string, campaignId: string): string {
  return `customers/${customerId.replace(/-/g, "")}/campaigns/${campaignId}`;
}

/**
 * Đọc hệ số giá thầu thiết bị hiện tại của một campaign.
 * Trả về map theo tên thiết bị → { resourceName, bidModifier }.
 * Ném lỗi nếu không đọc được — người gọi PHẢI xử lý, vì "không đọc được"
 * khác hẳn "chưa đặt hệ số nào".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DeviceRow = Record<string, any>;

export async function readDeviceCriteria(
  customer: Customer,
  campaignId: string
): Promise<Map<BidDevice, { resourceName: string; bidModifier: number | null }>> {
  const rows = (await customer.query(`
    SELECT
      campaign_criterion.resource_name,
      campaign_criterion.bid_modifier,
      campaign_criterion.device.type
    FROM campaign_criterion
    WHERE campaign_criterion.type = 'DEVICE'
      AND campaign.id = ${Number(campaignId)}
  `)) as unknown as DeviceRow[];

  const out = new Map<BidDevice, { resourceName: string; bidModifier: number | null }>();
  for (const row of rows) {
    const c = row.campaign_criterion;
    if (!c?.resource_name) continue;
    // device.type về dạng SỐ (2=MOBILE, 3=TABLET, 4=DESKTOP) — cùng loại bẫy
    // enum-là-số đã cắn nhiều lần ở repo này, nên so cả số lẫn chuỗi.
    const raw = c.device?.type;
    const name: BidDevice | null =
      raw === 2 || raw === "MOBILE" ? "MOBILE"
      : raw === 3 || raw === "TABLET" ? "TABLET"
      : raw === 4 || raw === "DESKTOP" ? "DESKTOP"
      : null;
    if (!name) continue;
    out.set(name, {
      resourceName: c.resource_name as string,
      bidModifier: typeof c.bid_modifier === "number" ? c.bid_modifier : null,
    });
  }
  return out;
}

/**
 * Đặt hệ số giá thầu cho một thiết bị trên một campaign.
 * Tự chọn create hay update tuỳ campaign đã có tiêu chí thiết bị đó chưa.
 * KHÔNG nuốt lỗi: hỏng thì trả `applied: false` kèm lý do.
 */
export async function applyDeviceBidModifier(
  customer: Customer,
  opts: {
    customerId: string;
    campaignId: string;
    device: BidDevice;
    /** 1.0 = không điều chỉnh; 0.8 = giảm 20%. Google chấp nhận 0.1–10. */
    bidModifier: number;
  }
): Promise<DeviceBidResult> {
  const modifier = Math.round(Math.max(0.1, Math.min(10, opts.bidModifier)) * 100) / 100;

  let existing: Map<BidDevice, { resourceName: string; bidModifier: number | null }>;
  try {
    existing = await readDeviceCriteria(customer, opts.campaignId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { applied: false, mode: null, previousModifier: null, error: `Không đọc được tiêu chí thiết bị hiện tại: ${msg}` };
  }

  const current = existing.get(opts.device);

  try {
    if (current) {
      await customer.campaignCriteria.update([
        { resource_name: current.resourceName, bid_modifier: modifier },
      ]);
      return { applied: true, mode: "update", previousModifier: current.bidModifier, error: null };
    }
    await customer.campaignCriteria.create([
      {
        campaign: campaignResourceName(opts.customerId, opts.campaignId),
        device: { type: opts.device },
        bid_modifier: modifier,
      },
    ]);
    return { applied: true, mode: "create", previousModifier: null, error: null };
  } catch (e) {
    const msg = googleAdsErrorMessage(e);
    return { applied: false, mode: null, previousModifier: current?.bidModifier ?? null, error: msg };
  }
}
