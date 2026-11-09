// ============================================================
// GET /api/google/assets/library?company=MBC&type=IMAGE|SITELINK
//
// Đọc kho tài sản CÓ SẴN trong tài khoản Google Ads, để lúc tạo chiến dịch
// người dùng chọn lại thay vì phải tải ảnh lên từ đầu.
// ------------------------------------------------------------
// Vì sao cần: ảnh dùng cho quảng cáo phần lớn đã nằm sẵn trong tài khoản — do
// lần chạy trước tải lên, hoặc do đội thiết kế đưa lên thẳng giao diện Google
// Ads. Bắt tải lại từ máy vừa mất công vừa sinh ra bản trùng trong thư viện,
// mỗi bản một cái tên khác nhau, càng về sau càng không ai biết tấm nào là
// tấm nào.
//
// CHỈ ĐỌC. Không tạo, không sửa, không xoá gì trong tài khoản.
//
// Lọc `asset.source = 'ADVERTISER'`: kho còn có tài sản do Google TỰ SINH
// (source = AUTOMATICALLY_CREATED) — các bản cắt tự động từ trang đích. Đo thật
// 18/09/2026 trên tài khoản MBC: trong 3 tấm loại này, 2 tấm bị Google từ chối
// ngay khi gắn ("The dimensions of the image are not allowed"), 1 tấm được
// chấp nhận. Tức KHÔNG phải cứ tự sinh là hỏng — nhưng đó cũng không phải ảnh
// người dùng tự làm, hiện ra chỉ khiến danh sách khó chọn hơn.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { checkImage, SEARCH_LINKABLE_FIELD_TYPES } from "@/lib/google-image-asset";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";

export interface LibraryImage {
  resourceName: string;
  id: string;
  name: string;
  width: number;
  height: number;
  sizeKb: number;
  /** Loại suy ra từ tỉ lệ — cùng cách phân loại với ảnh mới tải lên. */
  fieldType: string;
  ratioLabel: string;
  /** Gắn được vào campaign Search không. `false` thì nói rõ vì sao. */
  usableForSearch: boolean;
  /** Gắn được vào nhóm tài sản Performance Max không. */
  usableForPMax: boolean;
  /** Lý do không dùng được — rỗng khi dùng được. */
  blockedReason: string | null;
}

export interface LibraryVideo {
  resourceName: string;
  id: string;
  /** Mã video YouTube, 11 ký tự. */
  youtubeId: string;
  title: string;
  /** Ảnh thu nhỏ dựng từ mã video — không cần gọi thêm API nào. */
  thumbnailUrl: string;
  watchUrl: string;
}

export interface LibrarySitelink {
  resourceName: string;
  id: string;
  linkText: string;
  description1: string | null;
  description2: string | null;
  finalUrl: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GaqlRow = Record<string, any>;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const company = pickCompany(sp.get("company"));
  const t = sp.get("type");
  const type = t === "SITELINK" ? "SITELINK" : t === "VIDEO" ? "VIDEO" : "IMAGE";
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    if (type === "VIDEO") {
      // Video CHỈ dùng được cho Performance Max — đã đo: gắn vào campaign
      // Search bị Google từ chối ("The given field type is not supported to be
      // added directly through asset links").
      const rows = (await customer.query(`
        SELECT asset.id,
               asset.name,
               asset.youtube_video_asset.youtube_video_id,
               asset.youtube_video_asset.youtube_video_title
        FROM asset
        WHERE asset.type = 'YOUTUBE_VIDEO' AND asset.source = 'ADVERTISER'
        ORDER BY asset.id DESC
        LIMIT 100
      `)) as unknown as GaqlRow[];

      const videos: LibraryVideo[] = rows
        .filter((r) => r.asset?.youtube_video_asset?.youtube_video_id)
        .map((r) => {
          const y = r.asset.youtube_video_asset;
          return {
            resourceName: r.asset.resource_name,
            id: String(r.asset.id),
            youtubeId: y.youtube_video_id,
            title: y.youtube_video_title || r.asset.name || `Video ${r.asset.id}`,
            thumbnailUrl: `https://i.ytimg.com/vi/${y.youtube_video_id}/mqdefault.jpg`,
            watchUrl: `https://www.youtube.com/watch?v=${y.youtube_video_id}`,
          };
        });

      return NextResponse.json({ success: true, type, company, videos, count: videos.length });
    }

    if (type === "SITELINK") {
      const rows = (await customer.query(`
        SELECT asset.id, asset.sitelink_asset.link_text,
               asset.sitelink_asset.description1, asset.sitelink_asset.description2,
               asset.final_urls
        FROM asset
        WHERE asset.type = 'SITELINK' AND asset.source = 'ADVERTISER'
        ORDER BY asset.id DESC
        LIMIT 100
      `)) as unknown as GaqlRow[];

      const sitelinks: LibrarySitelink[] = rows
        .filter((r) => r.asset?.sitelink_asset?.link_text)
        .map((r) => ({
          resourceName: r.asset.resource_name,
          id: String(r.asset.id),
          linkText: r.asset.sitelink_asset.link_text,
          description1: r.asset.sitelink_asset.description1 || null,
          description2: r.asset.sitelink_asset.description2 || null,
          finalUrl: (r.asset.final_urls ?? [])[0] ?? null,
        }));

      return NextResponse.json({ success: true, type, company, sitelinks, count: sitelinks.length });
    }

    const rows = (await customer.query(`
      SELECT asset.id, asset.name,
             asset.image_asset.full_size.width_pixels,
             asset.image_asset.full_size.height_pixels,
             asset.image_asset.file_size
      FROM asset
      WHERE asset.type = 'IMAGE' AND asset.source = 'ADVERTISER'
      ORDER BY asset.id DESC
      LIMIT 100
    `)) as unknown as GaqlRow[];

    const images: LibraryImage[] = [];
    // Ảnh có tỉ lệ không khớp khuôn nào của Google KHÔNG hiện ra được (chọn
    // vào cũng bị từ chối), nhưng cũng KHÔNG được biến mất im lặng: trên tài
    // khoản thật đây là gần 1/4 thư viện. Người dùng nhớ mình có tấm đó mà
    // không thấy đâu sẽ tưởng tool đọc thiếu. Đếm rồi nói ra.
    let oddRatioCount = 0;

    for (const r of rows) {
      const f = r.asset?.image_asset?.full_size;
      if (!f?.width_pixels || !f?.height_pixels) continue;

      const bytes = r.asset.image_asset.file_size ?? 0;
      // Phân loại bằng ĐÚNG hàm dùng cho ảnh tải lên. Dùng hai cách phân loại
      // khác nhau cho hai đường vào là cách chắc chắn nhất để hai đường lệch
      // nhau mà không ai phát hiện.
      const marketing = checkImage(f.width_pixels, f.height_pixels, bytes, "BOTH", "MARKETING");
      const logo = checkImage(f.width_pixels, f.height_pixels, bytes, "BOTH", "LOGO");
      const pick = marketing.fieldType ? marketing : logo;
      if (!pick.fieldType) { oddRatioCount++; continue; }

      const usableForSearch =
        SEARCH_LINKABLE_FIELD_TYPES.includes(pick.fieldType) && pick.problems.length === 0;

      images.push({
        resourceName: r.asset.resource_name,
        id: String(r.asset.id),
        name: r.asset.name || `Ảnh ${r.asset.id}`,
        width: f.width_pixels,
        height: f.height_pixels,
        sizeKb: Math.round(bytes / 1024),
        fieldType: pick.fieldType,
        ratioLabel: pick.ratioLabel,
        usableForSearch,
        usableForPMax: pick.problems.length === 0,
        blockedReason: pick.problems.length > 0
          ? pick.problems.join(" ")
          : usableForSearch
            ? null
            : "Chỉ dùng cho Performance Max — quảng cáo Tìm kiếm không hiển thị loại ảnh này.",
      });
    }

    return NextResponse.json({
      success: true, type, company, images, count: images.length,
      /** Ảnh trong tài khoản nhưng tỉ lệ Google không nhận — không hiện được,
       *  nhưng phải cho biết là có. */
      oddRatioCount,
      scanned: rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không đọc được thư viện tài sản", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
