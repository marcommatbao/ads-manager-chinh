// ============================================================
// Video YouTube cho Performance Max
// ------------------------------------------------------------
// PMax phân bổ tiền qua sáu bề mặt, trong đó có YouTube. KHÔNG đưa video thì
// Google TỰ DỰNG video cho bạn từ ảnh và chữ trong nhóm tài sản — nó vẫn chạy,
// nhưng video tự dựng thường rất thô và bạn không kiểm soát được nội dung mang
// tên thương hiệu mình. Đưa video thật là một trong những thứ rẻ nhất mà cải
// thiện rõ nhất chất lượng PMax.
//
// Đo thật bằng validate_only trên tài khoản MBC ngày 18/09/2026:
//   ✅ tạo asset từ mã video YouTube 11 ký tự
//   ✅ gắn asset video vào nhóm tài sản PMax (field_type YOUTUBE_VIDEO)
//   ❌ mã sai định dạng → Google trả đúng một chữ "Too long."
//      (câu lỗi này gần như vô nghĩa với người dùng — nên phải tự kiểm trước)
//   ❌ gắn video vào campaign SEARCH → "The given field type is not supported
//      to be added directly through asset links" ⇒ video CHỈ dùng cho PMax.
//
// Tài khoản MBC đã có sẵn 20 video (Tuyệt Đỉnh 22, Hóng Chuyện Doanh Nghiệp,
// SSL Sectigo…) — dùng lại thay vì tải lên mới.
// ============================================================

/** Mã video YouTube: đúng 11 ký tự, chữ-số-gạch ngang-gạch dưới. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Bóc mã video từ bất cứ dạng link nào người dùng dán vào.
 *
 * Nhận mọi dạng thường gặp vì người ta copy từ đủ chỗ: thanh địa chỉ, nút Chia
 * sẻ, link nhúng, link Shorts. Trả `null` khi không bóc được — KHÔNG đoán bừa,
 * vì gửi mã sai lên Google chỉ nhận lại đúng chữ "Too long."
 */
export function parseYoutubeId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // Người dùng dán thẳng mã
  if (YOUTUBE_ID.test(s)) return s;

  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean);

  // youtu.be/<id>
  if (host === "youtu.be") return YOUTUBE_ID.test(seg[0] ?? "") ? seg[0] : null;

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return null;

  // youtube.com/watch?v=<id>
  const v = u.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  // youtube.com/embed/<id> · /shorts/<id> · /live/<id> · /v/<id>
  if (["embed", "shorts", "live", "v"].includes(seg[0] ?? "") && YOUTUBE_ID.test(seg[1] ?? "")) {
    return seg[1];
  }

  return null;
}

export interface VideoPlan {
  /** Video đã có trong tài khoản — gắn thẳng. */
  existing: string[];
  /** Mã video cần tạo asset mới trước khi gắn. */
  newYoutubeIds: string[];
  /** Mục bỏ qua kèm lý do nói được cho người dùng. */
  skipped: Array<{ input: string; reason: string }>;
}

/**
 * Tách danh sách video người dùng chọn thành "đã có" và "cần tạo mới".
 *
 * Khử trùng theo mã video, không theo chuỗi nhập: cùng một video dán bằng link
 * watch và link youtu.be là hai chuỗi khác nhau nhưng một video.
 */
export function planVideos(
  items: Array<{ resourceName?: string; youtubeId?: string; input?: string }>,
): VideoPlan {
  const plan: VideoPlan = { existing: [], newYoutubeIds: [], skipped: [] };
  const seenRn = new Set<string>();
  const seenId = new Set<string>();

  for (const it of items) {
    if (it.resourceName) {
      if (seenRn.has(it.resourceName)) continue;
      seenRn.add(it.resourceName);
      if (it.youtubeId) seenId.add(it.youtubeId);
      plan.existing.push(it.resourceName);
      continue;
    }

    const raw = it.input ?? it.youtubeId ?? "";
    const id = parseYoutubeId(raw);
    if (!id) {
      plan.skipped.push({
        input: raw,
        reason: "Không đọc được mã video từ link này. Dán link dạng youtube.com/watch?v=… hoặc youtu.be/… , hoặc dán thẳng mã 11 ký tự.",
      });
      continue;
    }
    if (seenId.has(id)) continue;
    seenId.add(id);
    plan.newYoutubeIds.push(id);
  }

  return plan;
}
