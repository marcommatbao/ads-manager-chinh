// ============================================================
// POST /api/google/image-asset
// { company, name, dataUrl, width, height }
//
// Tải ảnh lên Google Ads thành một "asset" dùng lại được, trả về resource name
// để gắn vào campaign lúc launch.
// ------------------------------------------------------------
// Tách khỏi bước launch có chủ đích: asset ảnh SỐNG ĐỘC LẬP với campaign, dùng
// lại được cho nhiều campaign. Nhét việc tải ảnh vào giữa chuỗi 5 pha của
// launch thì một ảnh hỏng sẽ kéo sập cả lượt tạo campaign, và rollback phải
// dọn thêm một loại tài nguyên nữa.
//
// Ảnh đã tải lên KHÔNG tiêu tiền và KHÔNG hiển thị cho ai cho tới khi được gắn
// vào campaign — nên tải lên là thao tác an toàn.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { checkImage, decodeDataUrl, MAX_IMAGES_PER_CAMPAIGN, type ImagePurpose } from "@/lib/google-image-asset";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền tải ảnh lên tài khoản quảng cáo" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    company?: string; name?: string; dataUrl?: string; width?: number; height?: number;
    campaignType?: "SEARCH" | "PMAX" | "BOTH";
    /** MARKETING hay LOGO. Không suy ra được từ tỉ lệ — logo vuông và ảnh
     *  marketing vuông đều là 1:1. */
    purpose?: ImagePurpose;
    /** Số ảnh đã chọn cho campaign này — để chặn TRƯỚC khi tải lên, thay vì
     *  để Google từ chối lúc gắn (khi đó ảnh đã nằm trong tài khoản). */
    currentCount?: number;
  };
  const company = pickCompany(body.company);
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  if (!body.dataUrl || !body.width || !body.height) {
    return NextResponse.json({ success: false, error: "Thiếu ảnh hoặc kích thước ảnh" }, { status: 400 });
  }

  if ((body.currentCount ?? 0) >= MAX_IMAGES_PER_CAMPAIGN) {
    return NextResponse.json(
      { success: false, error: `Google giới hạn ${MAX_IMAGES_PER_CAMPAIGN} ảnh mỗi campaign. Bỏ bớt một ảnh rồi thêm ảnh mới.` },
      { status: 422 },
    );
  }

  const decoded = decodeDataUrl(body.dataUrl);
  if (!decoded) {
    return NextResponse.json({ success: false, error: "Không đọc được ảnh (cần PNG hoặc JPG)" }, { status: 400 });
  }

  // Kiểm TRƯỚC khi gọi Google: sai tỉ lệ thì nói bằng tiếng Việt kèm kích thước
  // đúng cần dùng, thay vì đẩy người dùng vào một mã lỗi tiếng Anh.
  const check = checkImage(body.width, body.height, decoded.bytes.length, body.campaignType ?? "SEARCH", body.purpose ?? "MARKETING");
  if (!check.ok || !check.fieldType) {
    return NextResponse.json(
      { success: false, error: check.problems.join(" "), problems: check.problems },
      { status: 422 },
    );
  }

  try {
    const customer = getGoogleAdsCustomer(company);
    // Tên phải DUY NHẤT trong tài khoản — trùng tên là Google từ chối.
    const assetName = `${(body.name || "image").slice(0, 60)} — ${check.ratioLabel} — ${Date.now()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await customer.mutateResources([
      {
        entity: "asset",
        operation: "create",
        resource: {
          name: assetName,
          type: "IMAGE",
          image_asset: { data: decoded.bytes },
        },
      },
    ]);

    const resourceName: string =
      res?.mutate_operation_responses?.[0]?.asset_result?.resource_name ??
      res?.[0]?.asset?.resource_name ?? "";

    if (!resourceName) {
      return NextResponse.json(
        { success: false, error: "Google nhận ảnh nhưng không trả về mã tài nguyên — chưa gắn được vào campaign." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      asset: {
        resourceName,
        name: assetName,
        fieldType: check.fieldType,
        ratioLabel: check.ratioLabel,
        sizeKb: Math.round(decoded.bytes.length / 1024),
        /** Ảnh hợp lệ nhưng sẽ không hiển thị ở loại campaign này. */
        warning: check.warning,
      },
      note: "Ảnh đã nằm trong thư viện tài sản của tài khoản. Nó chỉ hiển thị khi được gắn vào campaign lúc Launch.",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Google từ chối ảnh", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
