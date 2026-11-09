// ============================================================
// POST /api/google/pmax/asset-group-images
// { company, assetGroupId, imageAssets: [{ resourceName, fieldType }] }
//
// Gắn ảnh/logo vào một nhóm tài sản PMax ĐÃ TỒN TẠI.
// ------------------------------------------------------------
// Vì sao cần: mọi campaign PMax tool tạo ra trước 27/08/2026 chỉ có tài sản
// CHỮ — không logo, không ảnh. Google đòi nhóm tài sản có logo + ảnh ngang +
// ảnh vuông mới đủ điều kiện phục vụ, nên chúng KHÔNG hiển thị được lượt nào.
// Google không báo lỗi; nó chỉ lặng lẽ không phục vụ.
//
// Đường này để vá những campaign đó mà không phải sang Google Ads, và để bổ
// sung ảnh cho nhóm tài sản bất kỳ sau này.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { checkPMaxImageCompleteness } from "@/lib/google-image-asset";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền sửa nhóm tài sản" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    company?: string; assetGroupId?: string;
    imageAssets?: Array<{ resourceName: string; fieldType: string }>;
  };
  const company = pickCompany(body.company);
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  if (!body.assetGroupId || !Array.isArray(body.imageAssets) || body.imageAssets.length === 0) {
    return NextResponse.json({ success: false, error: "Thiếu assetGroupId hoặc danh sách ảnh" }, { status: 400 });
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    // Lấy resource_name THẬT qua GAQL thay vì tự ghép chuỗi — cùng khuôn đã
    // dùng ở campaigns/[id]/status. Tự ghép là đoán định dạng của Google.
    const rows = await customer.query(`
      SELECT asset_group.resource_name, asset_group.name, campaign.name
      FROM asset_group
      WHERE asset_group.id = ${Number(body.assetGroupId)}
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = (rows as any[])[0];
    const assetGroupRN = first?.asset_group?.resource_name as string | undefined;
    if (!assetGroupRN) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy nhóm tài sản này trên Google Ads" },
        { status: 404 },
      );
    }

    // Đọc những loại ảnh nhóm này ĐÃ CÓ, để báo lại tình trạng đủ/thiếu sau khi
    // gắn — chứ không chỉ nói "đã gắn N ảnh" rồi để người dùng tự đoán còn
    // thiếu gì.
    const existingRows = await customer.query(`
      SELECT asset_group_asset.field_type
      FROM asset_group_asset
      WHERE asset_group.id = ${Number(body.assetGroupId)}
    `).then((r) => ({ ok: true as const, rows: r as unknown[] }))
     .catch((e) => ({ ok: false as const, rows: [] as unknown[], err: describeGoogleAdsError(e) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingTypes = (existingRows.rows as any[])
      .map((r) => String(r.asset_group_asset?.field_type ?? ""))
      .filter(Boolean);

    await customer.mutateResources(
      body.imageAssets.map((img) => ({
        entity: "asset_group_asset",
        operation: "create",
        resource: {
          asset_group: assetGroupRN,
          asset: img.resourceName,
          field_type: img.fieldType,
        },
      })),
    );

    const after = checkPMaxImageCompleteness([
      ...existingTypes,
      ...body.imageAssets.map((i) => i.fieldType),
    ]);

    // Không đọc được ảnh sẵn có thì KHÔNG được kết luận "vẫn thiếu X" — có thể
    // nhóm đã có sẵn. Nói thẳng là chưa xác minh được thay vì báo thiếu oan.
    const verified = existingRows.ok;

    return NextResponse.json({
      success: true,
      assetGroupName: first?.asset_group?.name ?? null,
      campaignName: first?.campaign?.name ?? null,
      linked: body.imageAssets.length,
      serviceable: verified ? after.ok : null,
      missing: verified ? after.missing : [],
      verified,
      message: !verified
        ? `Đã gắn ${body.imageAssets.length} ảnh, nhưng KHÔNG đọc được danh sách ảnh sẵn có của nhóm (${existingRows.err}) — chưa xác minh được nhóm đã đủ điều kiện phục vụ hay chưa. Kiểm trong Google Ads.`
        : after.ok
        ? `Đã gắn ${body.imageAssets.length} ảnh. Nhóm tài sản giờ có đủ logo + ảnh ngang + ảnh vuông — đủ điều kiện phục vụ.`
        : `Đã gắn ${body.imageAssets.length} ảnh, nhưng vẫn THIẾU ${after.missing.map((m) => m.label).join(", ")} — Google vẫn chưa hiển thị lượt nào.`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không gắn được ảnh vào nhóm tài sản", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
