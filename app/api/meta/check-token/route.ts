// GET /api/facebook/check-token
// Verify META_ACCESS_TOKEN validity using /me (works for all token types)
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { graphFetch, getMetaThrottleState, isMetaRateLimitError, readMetaRawUsageHeaders, readMetaLastRateLimitError, readPersistedRateLimitError } from "@/lib/meta-client";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json({ valid: false, expiresIn: 0, warning: false, error: "No token configured" });
  }

  try {
    // Use /me endpoint — works for all token types regardless of issuing app.
    // graphFetch để lượt gọi rẻ tiền này cũng đọc được header hạn mức — đây là
    // chỗ duy nhất trong app hỏi Meta mà không phụ thuộc dữ liệu quảng cáo, nên
    // nó là nơi tốt nhất để biết "còn bao nhiêu hạn mức".
    const res = await graphFetch(
      `${META_GRAPH_BASE}/me?fields=id,name&access_token=${token}`
    );
    const data = await res.json() as { id?: string; name?: string; error?: { message: string; code: number } };

    if (data.error || !data.id) {
      // Bị chặn vì hạn mức KHÔNG phải token hỏng — báo nhầm chỗ này khiến người
      // ta đi cấp lại token trong khi thứ cần làm là chờ/giảm nhịp gọi.
      const rateLimited = isMetaRateLimitError(data.error);
      return NextResponse.json({
        valid: rateLimited ? true : false,
        expiresIn: 0,
        warning: rateLimited,
        rateLimited,
        error: data.error?.message,
        throttle: getMetaThrottleState(),
      });
    }

    // Token is valid. Long-lived system user tokens never expire (expires_at = 0).
    return NextResponse.json({
      valid: true,
      expiresIn: 999 * 86400,
      warning: false,
      neverExpires: true,
      userName: data.name,
      /** Mức hạn mức Meta đo được ở lượt gọi gần nhất + có đang trong thời gian
       *  nghỉ hay không. `usage` = null nghĩa là chưa gọi lượt nào từ lúc khởi
       *  động, không phải "đã dùng 0%". */
      throttle: getMetaThrottleState(),
      /** Header hạn mức thô của lượt gọi gần nhất — Meta có nhiều xô song song,
       *  đây là nơi duy nhất nói được xô nào đang đầy. */
      rawUsageHeaders: readMetaRawUsageHeaders(),
      /** Payload lỗi đầy đủ của lần bị chặn gần nhất — error_subcode mới là thứ
       *  nói được vì sao bị chặn khi mọi xô hạn mức đều còn thấp. */
      lastRateLimitError: readMetaLastRateLimitError(),
      /** Bản ghi trên đĩa — sống sót qua restart container, nên vẫn đọc được
       *  lần bị chặn trước lần deploy gần nhất. */
      lastRateLimitErrorPersisted: await readPersistedRateLimitError(),
    });
  } catch (err) {
    // graphFetch ném ngay khi đang trong thời gian nghỉ — đó là thông tin thật,
    // đừng gộp chung vào "Network error".
    const msg = err instanceof Error ? err.message : "Network error";
    const throttle = getMetaThrottleState();
    return NextResponse.json({
      valid: throttle.throttled,
      expiresIn: 0,
      warning: throttle.throttled,
      rateLimited: throttle.throttled,
      error: friendlyError(msg),
      throttle,
    });
  }
}
