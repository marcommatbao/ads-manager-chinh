// POST /api/creative/upload-image
// Upload image to Facebook Ad Account
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Meta's own ad-image ceiling

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  // Uploads land in the shared live Meta ad account — authentication alone
  // let a read-only viewer push assets into it.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền tải ảnh lên tài khoản quảng cáo" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    return NextResponse.json({ success: false, error: friendlyError("META credentials not configured") }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid form data" }, { status: 400 });
  }

  const imageFile = formData.get("image") as File | null;
  if (!imageFile) {
    return NextResponse.json({ success: false, error: "No image file provided" }, { status: 400 });
  }

  // Validate before spending a round trip to Meta — the endpoint accepted
  // any file of any size and forwarded it verbatim.
  if (!ALLOWED_IMAGE_TYPES.has(imageFile.type)) {
    return NextResponse.json(
      { success: false, error: `Định dạng không hỗ trợ (${imageFile.type || "không rõ"}). Chỉ nhận JPEG, PNG, GIF, WebP.` },
      { status: 400 },
    );
  }
  if (imageFile.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Ảnh quá lớn (${(imageFile.size / 1_048_576).toFixed(1)}MB). Tối đa ${MAX_IMAGE_BYTES / 1_048_576}MB.` },
      { status: 413 },
    );
  }

  try {
    const uploadForm = new FormData();
    uploadForm.append("access_token", token);
    uploadForm.append("filename", imageFile, imageFile.name ?? "upload.jpg");

    const res = await fetch(`${META_GRAPH_BASE}/act_${adAccountId}/adimages`, {
      method: "POST",
      body: uploadForm,
    });
    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ success: false, error: data.error.message }, { status: 502 });
    }

    const imagesData = data.images;
    const firstKey = imagesData ? Object.keys(imagesData)[0] : null;
    const uploadedImage = firstKey ? imagesData[firstKey] : null;

    if (!uploadedImage?.hash) {
      return NextResponse.json({ success: false, error: "Upload failed — no hash returned" }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      imageHash: uploadedImage.hash,
      imageUrl: uploadedImage.url ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: `Upload failed: ${message}` }, { status: 500 });
  }
}
