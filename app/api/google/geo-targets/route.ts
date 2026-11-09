// ============================================================
// GET /api/google/geo-targets?company=MBC
//
// Danh sách vị trí Việt Nam để chọn khi tạo chiến dịch.
// ------------------------------------------------------------
// CHỈ ĐỌC. Không tạo, không sửa gì trên tài khoản.
//
// Trước bản này vị trí bị ghim cứng "Việt Nam cả nước" trong code — không cách
// nào nhắm riêng TP.HCM hay Hà Nội, dù đó là việc cơ bản nhất của chạy quảng
// cáo. Route này mở ra đúng phần đó.
//
// Xếp tầng bằng QUAN HỆ CHA-CON, không phải bằng tên hay `target_type` — lý do
// giải thích kỹ trong lib/google-targeting.ts: Google giữ song song hai bộ đơn
// vị hành chính sau sáp nhập 2025, "Ha Noi" (cả Hà Nội) và "Hanoi" (chỉ nội
// thành) đều là Municipality, đều ENABLED, đều gắn được, khác nhau ở vùng phủ.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { GEO_PICKER_TARGET_TYPES, geoTier, GEO_NAME_VI, normalizeGeoQuery, type GeoTier } from "@/lib/google-targeting";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";

export interface GeoTargetRow {
  resourceName: string;
  id: string;
  /** Tên Google trả về — KHÔNG DẤU ("Ha Noi", "Da Nang"). */
  name: string;
  /** "Ha Noi,Vietnam" hoặc "Hanoi,Ha Noi,Vietnam" — chuỗi này là thứ duy nhất
   *  phân biệt được hai mục trùng tên, nên phải hiện ra cho người chọn. */
  canonicalName: string;
  targetType: string;
  tier: GeoTier;
  /** Tên đơn vị cha, để hiện "Hanoi (trong Ha Noi)" thay vì hai dòng "Hanoi". */
  parentName: string | null;
  /** Tên tiếng Việt có dấu để hiển thị. Rơi về tên Google nếu chưa có trong bảng. */
  nameVi: string;
  /** Chuỗi đã bỏ dấu + cách gọi quen thuộc, để ô tìm kiếm khớp "TPHCM", "Sài Gòn". */
  searchKey: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GaqlRow = Record<string, any>;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    // Bỏ Ward/Commune: 3.307 trong tổng 3.422 vị trí VN là phường/xã — quá vụn
    // cho quảng cáo hosting/tên miền, và nhét vào danh sách chỉ làm không chọn
    // nổi. Bốn tầng còn lại là 110 mục, vừa đủ để cuộn và tìm.
    const types = GEO_PICKER_TARGET_TYPES.map((t) => `'${t}'`).join(",");
    const rows = (await customer.query(`
      SELECT geo_target_constant.id,
             geo_target_constant.name,
             geo_target_constant.canonical_name,
             geo_target_constant.target_type,
             geo_target_constant.parent_geo_target
      FROM geo_target_constant
      WHERE geo_target_constant.country_code = 'VN'
        AND geo_target_constant.status = 'ENABLED'
        AND geo_target_constant.target_type IN (${types})
    `)) as unknown as GaqlRow[];

    // Tên cha tra từ chính tập vừa lấy — cha của mọi mục đều nằm trong tập này
    // (cha là Việt Nam hoặc một tỉnh/thành), nên không cần gọi Google lần nữa.
    const nameById = new Map<string, string>();
    for (const r of rows) nameById.set(String(r.geo_target_constant.id), r.geo_target_constant.name);

    const locations: GeoTargetRow[] = rows.map((r) => {
      const g = r.geo_target_constant;
      const parentId = g.parent_geo_target ? String(g.parent_geo_target).split("/").pop() ?? null : null;
      const vi = GEO_NAME_VI[g.name];
      return {
        resourceName: `geoTargetConstants/${g.id}`,
        id: String(g.id),
        name: g.name,
        canonicalName: g.canonical_name ?? g.name,
        targetType: g.target_type,
        tier: geoTier(g.id, g.parent_geo_target),
        parentName: parentId ? nameById.get(parentId) ?? null : null,
        nameVi: vi?.vi ?? g.name,
        // Gộp sẵn ở server: tên Google + tên tiếng Việt + các cách gọi quen
        // thuộc, tất cả đã bỏ dấu. Giao diện chỉ việc so chuỗi con, không phải
        // lặp lại logic chuẩn hoá ở hai nơi rồi lệch nhau.
        searchKey: [g.name, g.canonical_name, vi?.vi, ...(vi?.aliases ?? [])]
          .filter(Boolean).map((x) => normalizeGeoQuery(String(x))).join("|"),
      };
    });

    // Cả nước trước, rồi tỉnh/thành, rồi khu vực nhỏ hơn — trong mỗi tầng xếp
    // theo tên. Người chọn thường cần đúng tầng giữa.
    const order: Record<GeoTier, number> = { country: 0, province: 1, city: 2 };
    locations.sort((a, b) =>
      order[a.tier] - order[b.tier] || a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      company,
      locations,
      count: locations.length,
      counts: {
        country: locations.filter((l) => l.tier === "country").length,
        province: locations.filter((l) => l.tier === "province").length,
        city: locations.filter((l) => l.tier === "city").length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không đọc được danh sách vị trí", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
