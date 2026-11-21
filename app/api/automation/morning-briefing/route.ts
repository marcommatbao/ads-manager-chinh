// ============================================================
// GET  /api/automation/morning-briefing — today's briefing (cached)
// POST /api/automation/morning-briefing — force regenerate
//
// The dashboard's Morning Briefing card has always called this route; it
// was never implemented, so the card silently rendered nothing (its
// `!briefing && !loading` branch returns null). lib/morning-briefing.ts
// already did all the work — only this HTTP layer was missing.
//
// Generation pulls live Meta/Google data and calls Gemini, so it is slow
// and rate-limited: GET serves the day's in-memory cache when present and
// only generates on a miss. POST always regenerates (the card's refresh).
// ============================================================
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  MORNING_BRIEFING_ENABLED,
  generateMorningBriefing,
  getCachedBriefing,
  setCachedBriefing,
} from "@/lib/morning-briefing";
import { friendlyError } from "@/lib/not-configured";
import { saveBriefing } from "@/lib/morning-briefing-history";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Trả về khi tính năng đang tắt. 200 chứ không phải lỗi: tắt có chủ đích là
 *  một trạng thái bình thường, không phải sự cố — thẻ ẩn đi lặng lẽ. */
function disabledResponse(t: TFunction) {
  return NextResponse.json({
    success: false,
    disabled: true,
    error: t("libcase.r.mb.1"),
  });
}

function publicGenerationError(error: unknown, t: TFunction): string {
  if (error instanceof Error) {
    const translated = friendlyError(error.message);
    if (translated !== error.message) return translated;
  }
  return t("libcase.r.mb.2");
}

async function build(force: boolean) {
  if (!force) {
    const cached = getCachedBriefing();
    if (cached) return { data: cached, cached: true };
  }
  const fresh = await generateMorningBriefing();
  setCachedBriefing(fresh);
  // Lưu lịch sử là phần gate Giai đoạn 3; lỗi ghi file không được làm hỏng
  // bản tin đang hiển thị, nhưng phải để lại log để phát hiện.
  try {
    await saveBriefing(fresh);
  } catch (err) {
    console.error("[automation/morning-briefing] lưu lịch sử lỗi:", err);
  }
  return { data: fresh, cached: false };
}

export async function GET() {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!MORNING_BRIEFING_ENABLED) return disabledResponse(t);

  try {
    const { data, cached } = await build(false);
    return NextResponse.json({ success: true, data, cached });
  } catch (err) {
    // Only translated configuration errors are public; other diagnostics stay server-side.
    console.error("[automation/morning-briefing GET]", err);
    return NextResponse.json({ success: false, error: publicGenerationError(err, t) }, { status: 502 });
  }
}

// Regenerating pulls Meta + Google Ads and calls Gemini. The refresh button
// sits on the dashboard, so without a throttle a held-down click bills a
// Gemini generation per press.
const REFRESH_RATE_MAX = 3;
const REFRESH_RATE_WINDOW_MS = 5 * 60_000;

export async function POST() {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  // Chặn TRƯỚC rate-limit: đang tắt thì nút refresh cũng không được phép đốt
  // một lượt gọi Meta + một lượt sinh Gemini.
  if (!MORNING_BRIEFING_ENABLED) return disabledResponse(t);

  const { allowed } = await rateLimit(`briefing-refresh:${user.id}`, REFRESH_RATE_MAX, REFRESH_RATE_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: t("libcase.r.mb.3") },
      { status: 429 },
    );
  }

  try {
    const { data } = await build(true);
    return NextResponse.json({ success: true, data, cached: false });
  } catch (err) {
    console.error("[automation/morning-briefing POST]", err);
    return NextResponse.json({ success: false, error: publicGenerationError(err, t) }, { status: 502 });
  }
}
