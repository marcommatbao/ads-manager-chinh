// ============================================================
// POST /api/ai/chat — AdsBot conversational assistant (streaming)
//
// The chatbot in components/AIChatbot.tsx (mounted globally in AppShell)
// has always POSTed here; the route was never implemented, so every
// message failed. Responses stream as plain text — the client appends
// each chunk verbatim.
//
// ADVISORY ONLY. It reads real account numbers and answers questions; it
// never mutates campaigns. Real mutations stay behind the existing
// permission-checked, audited endpoints (Improvements → Apply, campaign
// budget/status routes). See the removed executeFunction path in
// AIChatbot.tsx for why: it printed "đã được thực thi trên server" without
// calling anything.
//
// Grounding data comes from the same internal endpoints the dashboard uses,
// so the bot cannot state a number the UI would contradict. If a source
// fails, its section says so explicitly rather than being silently omitted —
// an answer built on partial data must look partial.
// ============================================================
import { orgName } from "@/lib/brand/store"
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { streamGeminiChat, generateWithTools, type ChatTurn, type GeminiContent } from "@/lib/gemini";
import { TOOL_DECLARATIONS, runTool } from "@/lib/ai-tools/registry";
import { rateLimit } from "@/lib/rate-limit";
import type { SessionUser } from "@/lib/auth";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TURNS = 20;
const MAX_CHARS = 4000;

// Every message is a billed Gemini call plus two internal data pulls, so
// this is per-user throttled. Keyed by user id, not IP: the office shares
// one egress IP, and one person holding down send should not lock out the
// whole floor.
const CHAT_RATE_MAX = 15;
const CHAT_RATE_WINDOW_MS = 60_000;

interface IncomingMessage {
  role?: string;
  content?: string;
}

const vnd = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

/** Server-side call to our own API, forwarding the caller's session cookie. */
// Ngữ cảnh nạp-sẵn (buildContext + internalGet + các kiểu UnifiedResponse/
// ImprovementsResponse) đã bị gỡ ở đây: AdsBot giờ tự gọi công cụ để lấy đúng
// dữ liệu nó cần (lib/ai-tools/registry.ts), nên không còn phải đoán trước
// người dùng sẽ hỏi gì rồi nhồi sẵn một ảnh chụp 7 ngày cố định.

const SYSTEM_INSTRUCTION = `Bạn là AdsBot — trợ lý phân tích quảng cáo nội bộ của __ORG__, hỗ trợ đội chạy Facebook Ads và Google Ads.

QUY TẮC BẮT BUỘC:
1. CHỈ dùng số liệu do CÔNG CỤ trả về. TUYỆT ĐỐI không bịa số liệu, tên campaign, CPL, ngân sách hay bất kỳ con số nào công cụ không đưa ra.
2. Nếu công cụ báo lỗi hoặc thiếu thông tin để trả lời, hãy nói thẳng là chưa có dữ liệu và gợi ý người dùng xem ở đâu trong hệ thống. Không đoán.
3. Bạn KHÔNG thay đổi được bất cứ thứ gì — không tài khoản quảng cáo, không nội dung quảng cáo. Không được nói rằng bạn đã pause campaign, đổi ngân sách, ĐĂNG một mẩu quảng cáo, LƯU một creative hay ÁP một bản viết lại RSA. Mọi thứ bạn sinh ra đều là BẢN NHÁP để người dùng tự xem lại và tự áp: creative áp trong Creative Studio, RSA áp trong ô sửa RSA, phân khúc đối tượng dùng ở bước Đối tượng. Khi người dùng muốn hành động, chỉ họ tới đúng trang (Cải tiến, Chiến dịch, Auto-Apply, Creative Studio).
4. Trả lời bằng tiếng Việt, ngắn gọn, ưu tiên gạch đầu dòng. Nêu rõ con số kèm đơn vị.
5. Khi đề xuất tối ưu, phải dựa trên dữ liệu có thật và nói rõ căn cứ.
6. Bạn CÓ công cụ truy vấn dữ liệu. Cần số liệu gì thì GỌI CÔNG CỤ để lấy, đừng đoán và đừng nói "tôi không có dữ liệu" khi chưa thử gọi.
7. Người dùng nói khoảng thời gian bằng lời ("từ đầu tháng", "tuần trước") thì bạn tự quy ra ngày cụ thể YYYY-MM-DD rồi truyền vào công cụ. Hôm nay là ngày được ghi trong phần bối cảnh bên dưới.
8. Luôn NÊU RÕ khoảng ngày và phạm vi công ty mà số liệu đang phản ánh — công cụ trả về trường \`window\` cho việc đó.
9. Công cụ trả về \`error\` hoặc ghi chú bị cắt bớt thì phải nói ra, không được lờ đi.
10. Bạn còn công cụ cho các mảng ngoài số liệu chi tiêu: viết nháp và cải thiện nội dung quảng cáo, so sánh hai chiến dịch, phân tích phân khúc đối tượng, đề xuất và chẩn đoán Google Performance Max, bảng CPL theo tháng, đo lượng tìm kiếm từ khoá trên Google, viết lại RSA, và số liệu GA4. Cần thứ gì thì gọi đúng công cụ đó.
11. LUẬT KHÔNG BỊA áp cho cả NỘI DUNG, không riêng con số. Với generate_ad_creative, improve_ad_creative, suggest_rsa_rewrite và analyze_audience_segments: thiếu đầu vào bắt buộc (sản phẩm, đối tượng, tone, nội dung quảng cáo hiện tại) thì HỎI người dùng rồi mới gọi công cụ. Tuyệt đối không tự nghĩ ra USP, ưu đãi, khuyến mãi, con số cam kết hay social proof — bịa một ưu đãi không có thật là quảng cáo sai sự thật, nặng hơn một câu trả lời sai.
12. Cần id chiến dịch (compare_ad_creatives, get_pmax_diagnosis) thì lấy từ trường \`id\` của query_campaigns hoặc get_pmax_recommendations. KHÔNG tự đặt ra id.
13. Các công cụ sinh nội dung bằng AI có trần 3 lượt cho mỗi tin nhắn. Gặp báo hết hạn mức thì nói cho người dùng biết và đề nghị họ hỏi từng việc một, đừng thử lại vòng vo.`;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`ai-chat:${user.id}`, CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: "Bạn đang gửi quá nhanh. Đợi một chút rồi thử lại." },
      { status: 429 },
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Chưa cấu hình GEMINI_API_KEY — vào Cài đặt → API Keys để thêm." },
      { status: 503 },
    );
  }

  let body: { messages?: IncomingMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const turns: ChatTurn[] = (body.messages ?? [])
    .filter((m): m is { role: string; content: string } =>
      typeof m?.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === "model" ? ("model" as const) : ("user" as const),
      content: m.content.slice(0, MAX_CHARS),
    }))
    .slice(-MAX_TURNS);

  if (turns.length === 0) {
    return NextResponse.json({ error: "Chưa có nội dung câu hỏi" }, { status: 400 });
  }

  const cookie = request.headers.get("cookie") ?? "";
  const baseUrl = process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  // Ngữ cảnh giờ CHỈ còn phần tối thiểu để model biết đường mà gọi công cụ.
  // Trước đây chỗ này nạp sẵn chi tiêu 7 ngày + 12 improvement — hẹp cứng, không
  // trả lời nổi câu hỏi ngoài dự kiến, mà nhồi thêm thì tốn token vô ích.
  const companies = getCompaniesForRole(user);
  const systemInstruction =
    `${SYSTEM_INSTRUCTION.replace("__ORG__", orgName())}\n\n=== BỐI CẢNH ===\n` +
    `- Hôm nay: ${new Date().toISOString().slice(0, 10)}\n` +
    `- Người dùng được xem công ty: ${companies.join(", ") || "không công ty nào"}\n` +
    `- Nền tảng đang nối: Facebook Ads, Google Ads\n=== HẾT BỐI CẢNH ===`;

  const contents: GeminiContent[] = turns.map((t) => ({ role: t.role, parts: [{ text: t.content }] }));

  // MỘT ctx duy nhất cho cả tin nhắn — dùng lại qua mọi vòng và mọi lời gọi
  // song song trong cùng vòng. Trước đây ctx được dựng mới ngay trong
  // Promise.all, nên bất kỳ hạn mức nào đặt trong đó cũng bị reset mỗi lời gọi
  // và thành vô nghĩa. `expensiveLeft` là trần số lượt công cụ kích thêm một
  // lượt gọi Gemini ở phía server (sinh/sửa creative, phân tích đối tượng,
  // viết lại RSA, chẩn đoán PMax) — xem spendBudget trong registry.
  const ctx = { user, cookie, baseUrl, budget: { expensiveLeft: 3 } };

  try {
    // Vòng gọi công cụ. Trần 3 lượt: đủ cho câu hỏi ghép (vd chi phí + danh sách)
    // mà không để model lặp vô hạn và đốt token.
    const MAX_TOOL_ROUNDS = 3;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await generateWithTools(contents, TOOL_DECLARATIONS, {
        systemInstruction,
        config: { temperature: 0.3, maxOutputTokens: 1500, thinkingBudget: 0 },
      });
      if (res.functionCalls.length === 0) break;

      contents.push({
        role: "model",
        // thoughtSignature phải đi kèm nguyên văn — gemini-3.5-flash 400 nếu
        // functionCall phát lại mà thiếu chữ ký nó đã cấp cho đúng part đó.
        parts: res.functionCalls.map((fc) => ({
          functionCall: { name: fc.name, args: fc.args },
          ...(fc.thoughtSignature ? { thoughtSignature: fc.thoughtSignature } : {}),
        })),
      });

      const results = await Promise.all(
        res.functionCalls.map(async (fc) => {
          const out = await runTool(fc.name, fc.args, ctx);
          console.log(`[ai/chat] tool ${fc.name}`, JSON.stringify(fc.args).slice(0, 200));
          return { name: fc.name, response: out };
        }),
      );

      contents.push({
        role: "user",
        parts: results.map((r) => ({ functionResponse: { name: r.name, response: r.response } })),
      });
    }

    // Câu trả lời cuối vẫn stream, nên client không phải đổi gì.
    const stream = await streamGeminiChat(turns, {
      contents,
      systemInstruction,
      config: { temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0 },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    console.error("[ai/chat]", err);
    return NextResponse.json({ error: friendlyError(message) }, { status: 502 });
  }
}
