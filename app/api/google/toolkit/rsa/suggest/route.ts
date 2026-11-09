// POST /api/google/toolkit/rsa/suggest
// AI-suggested rewrite for the SPECIFIC weak component of an existing RSA
// (Ad Relevance or Expected CTR) — never writes to Google, just proposes
// text for the edit modal to preview. See docs/mini-specs/RSA-EDIT-1.md.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { callGemini } from "@/lib/gemini";
import { GOOGLE_RSA_LIMITS, checkRsaCharLimits, formatViolationsForRetry } from "@/lib/creative-limits";
import { friendlyError } from "@/lib/not-configured";

interface SuggestRequest {
  headlines: string[];
  descriptions: string[];
  weakest: "AD_RELEVANCE" | "EXPECTED_CTR";
  keywords: string[];
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  // Mỗi lượt gọi là một lượt Gemini. Trước đây chỉ cần đăng nhập, nên tài khoản
  // `viewer` — vốn không sửa được gì — vẫn bấm được bao nhiêu lần tuỳ ý. Viết lại
  // nội dung quảng cáo là việc của người có quyền sửa, khớp với rsa/[adId] (PATCH)
  // vốn đã đòi can_edit; không có lý do gì bước gợi ý lại dễ hơn bước áp dụng.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa nội dung quảng cáo" }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: friendlyError("GEMINI_API_KEY not configured") }, { status: 401 });
  }

  let body: SuggestRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.headlines) || body.headlines.length === 0) {
    return NextResponse.json({ success: false, error: "Missing headlines" }, { status: 400 });
  }
  if (body.weakest !== "AD_RELEVANCE" && body.weakest !== "EXPECTED_CTR") {
    return NextResponse.json({ success: false, error: "weakest must be AD_RELEVANCE or EXPECTED_CTR" }, { status: 400 });
  }

  // Only the headlines get rewritten — descriptions pass through unchanged.
  // Landing Page and other components aren't something rewriting ad copy
  // can fix (matches the "ngoài phạm vi app" suggestion already shown for
  // LANDING_PAGE elsewhere in the Quality Score toolkit).
  const reasonInstruction = body.weakest === "AD_RELEVANCE"
    ? `Ad Relevance đang thấp — nội dung hiện tại CHƯA chứa đủ từ khóa chính mà campaign đang nhắm tới. Viết lại để mỗi headline chứa rõ ít nhất 1 từ khóa liên quan, và mô tả nhắc lại từ khóa chính một cách tự nhiên. Không nhồi nhét.`
    : `Expected CTR đang thấp — nội dung hiện tại thiếu yếu tố khiến người dùng muốn bấm. Viết lại để có USP mạnh/CTA rõ ràng. CHỈ dùng con số và cam kết ĐÃ CÓ trong bản gốc; nếu bản gốc không có con số nào thì đừng thêm con số nào.`;

  // Mô tả có 90 ký tự — rộng gấp ba headline, nên là chỗ nhét từ khóa tự nhiên nhất
  // và Google chấm Ad Relevance trên TOÀN BỘ quảng cáo, không riêng headline. Nhưng
  // chỗ rộng hơn cũng là chỗ AI dễ bịa hơn: mô tả là nơi chứa giá, bảo hành, khuyến
  // mãi. "Giảm 50%" nghe xuôi tai mà không có thật thì đó là quảng cáo sai sự thật —
  // tệ hơn nhiều so với Quality Score thấp. Nên luật cấm bịa phải nêu riêng ở đây.
  const descBlock = `
Mô tả hiện tại (viết lại đúng ${body.descriptions.length} dòng, giữ đúng thứ tự, mỗi dòng TỐI ĐA ${GOOGLE_RSA_LIMITS.description} ký tự tính cả khoảng trắng):
${body.descriptions.map((d, i) => `${i + 1}. ${d} [${d.normalize("NFC").length} ký tự]`).join("\n")}

LUẬT CẤM BỊA CHO MÔ TẢ (nghiêm ngặt hơn headline):
- CHỈ được diễn đạt lại thông tin đã có trong mô tả gốc bên trên.
- TUYỆT ĐỐI KHÔNG thêm con số mới (giá, %, thời gian bảo hành, số lượng khách hàng).
- TUYỆT ĐỐI KHÔNG thêm cam kết mới (miễn phí, hoàn tiền, bảo hành, tặng kèm) nếu bản gốc không có.
- Không có thông tin để nhấn thì viết lại cho rõ ràng hơn, đừng phát minh thông tin.`;

  const prompt = `Bạn là chuyên gia Google Search Ads. Viết lại headlines VÀ mô tả của 1 Responsive Search Ad (RSA) đang chạy thật — không được đổi số lượng dòng, không bịa thông tin không có căn cứ.

RÀNG BUỘC CỨNG — Google từ chối quảng cáo nếu vi phạm:
- Mỗi headline TỐI ĐA ${GOOGLE_RSA_LIMITS.headline} ký tự, TÍNH CẢ KHOẢNG TRẮNG và dấu câu.
- Mỗi mô tả TỐI ĐA ${GOOGLE_RSA_LIMITS.description} ký tự, TÍNH CẢ KHOẢNG TRẮNG và dấu câu.
- Tiếng Việt có dấu: mỗi chữ cái có dấu vẫn tính là 1 ký tự (ví dụ "ể" = 1).
- Đếm lại từng dòng TRƯỚC KHI trả lời. Dòng nào quá giới hạn thì rút ngắn ngay, đừng trả ra rồi để người khác sửa.
- Thà ngắn hơn giới hạn còn hơn vượt. Headline nhắm 25-30 ký tự, mô tả nhắm 80-90 ký tự.

Headlines hiện tại (viết lại đúng ${body.headlines.length} dòng, giữ đúng thứ tự):
${body.headlines.map((h, i) => `${i + 1}. ${h} [${h.normalize("NFC").length} ký tự]`).join("\n")}
${body.descriptions.length > 0 ? descBlock : ""}

Từ khóa ad group này đang chạy (bám sát, ưu tiên các từ đầu danh sách): ${body.keywords.length ? body.keywords.join(", ") : "(không có)"}

${reasonInstruction}

Trả lời JSON, không thêm text ngoài JSON:
{"headlines": string[] (đúng ${body.headlines.length} phần tử, đúng thứ tự)${body.descriptions.length > 0 ? `, "descriptions": string[] (đúng ${body.descriptions.length} phần tử, đúng thứ tự)` : ""}}`;

  interface Draft { headlines: string[]; descriptions: string[] }

  /** Gọi Gemini một lượt, bóc cả headlines và mô tả. Trả null nếu không đọc được. */
  async function askGemini(p: string): Promise<Draft | null> {
    const geminiRes = await callGemini(
      p,
      // Viết thêm mô tả (4 dòng × 90 ký tự) nên cần thêm chỗ cho đầu ra; 500 token
      // vốn chỉ đủ cho headlines, giữ nguyên sẽ bị cắt giữa JSON và parse hỏng.
      { temperature: 0.6, maxOutputTokens: 1200, responseMimeType: "application/json", thinkingBudget: 0 },
      apiKey!
    );
    const rawText = geminiRes.text?.trim() ?? "";
    let parsed: { headlines?: unknown; descriptions?: unknown };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[rsa/suggest] Parse failed. finishReason:", geminiRes.finishReason, "First 200 chars:", rawText.slice(0, 200));
        return null;
      }
    }
    const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { headlines: strArr(parsed.headlines), descriptions: strArr(parsed.descriptions) };
  }

  /** Số dòng phải khớp bản gốc. Trả câu lỗi, hoặc null nếu khớp. */
  function countMismatch(d: Draft): string | null {
    if (d.headlines.length !== body.headlines.length) {
      return `AI trả về ${d.headlines.length} tiêu đề thay vì ${body.headlines.length}`;
    }
    // Mô tả không có trong bản gốc thì không đòi AI trả về.
    if (body.descriptions.length > 0 && d.descriptions.length !== body.descriptions.length) {
      return `AI trả về ${d.descriptions.length} mô tả thay vì ${body.descriptions.length}`;
    }
    return null;
  }

  try {
    // Lượt 1.
    let draft = await askGemini(prompt);
    if (draft === null) {
      return NextResponse.json({ success: false, error: "AI trả về dữ liệu không hợp lệ" }, { status: 502 });
    }
    const mismatch = countMismatch(draft);
    if (mismatch) {
      // Don't silently pad/truncate to "fix" a count mismatch — that would
      // present AI output as if it matched the request when it didn't.
      return NextResponse.json({ success: false, error: `${mismatch} — thử lại` }, { status: 502 });
    }

    // Prompt đã dặn giới hạn ký tự và AI vẫn vượt — lời dặn không phải cơ chế.
    // Thứ bảo đảm là bước kiểm này. Dùng lại đúng hàm mà đường ghi rsa/[adId] đang
    // dùng, để hai đường không lệch chuẩn. Kiểm CẢ mô tả (giới hạn 90).
    let violations = checkRsaCharLimits(draft.headlines, draft.descriptions);

    if (violations.length > 0) {
      // Thử lại ĐÚNG MỘT lần, kèm danh sách dòng vượt. Không cắt chuỗi cho vừa:
      // cắt cụt câu tiếng Việt ở ký tự thứ 30 ra chữ vô nghĩa mà lại trông như
      // AI viết được. Mỗi lượt là một lượt Gemini nên không thử vô hạn.
      console.warn(`[rsa/suggest] lượt 1 vượt giới hạn ${violations.length} dòng — thử lại`);
      const retry = await askGemini(prompt + formatViolationsForRetry(violations));
      if (retry && !countMismatch(retry)) {
        const retryViolations = checkRsaCharLimits(retry.headlines, retry.descriptions);
        if (retryViolations.length === 0) {
          draft = retry;
          violations = [];
        } else if (retryViolations.length < violations.length) {
          // Bản thử lại vẫn sai — giữ bản nào ít vi phạm hơn để báo lỗi cho cụ thể.
          draft = retry;
          violations = retryViolations;
        }
      }
    }

    if (violations.length > 0) {
      // KHÔNG trả bản nháp sai ra màn hình. Người dùng bấm "AI gợi ý lại" là để
      // nhận thứ dùng được; đưa ra bản vượt giới hạn rồi bắt họ tự sửa là đẩy việc
      // ngược lại, và đường ghi lên Google cũng sẽ chặn nó.
      return NextResponse.json({
        success: false,
        error: "AI vẫn viết quá giới hạn ký tự sau 2 lần thử: "
          + violations.map((v) => `"${v.text}" (${v.length}/${v.limit})`).join("; ")
          + ". Bấm lại để thử lần nữa, hoặc tự rút gọn.",
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      data: {
        headlines: draft.headlines,
        // Bản gốc không có mô tả thì giữ nguyên mảng gốc, đừng trả mảng AI tự thêm.
        descriptions: body.descriptions.length > 0 ? draft.descriptions : body.descriptions,
      },
      // Để người dùng đối chiếu AI có bám đúng từ khoá đang chạy hay không.
      keywordsUsed: body.keywords,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("RATE_LIMITED")) {
      return NextResponse.json({ success: false, error: "Rate limit — thử lại sau 30 giây" }, { status: 429 });
    }
    if (message.includes("GEMINI_TIMEOUT")) {
      return NextResponse.json({ success: false, error: "AI phản hồi quá lâu — vui lòng thử lại" }, { status: 504 });
    }
    return NextResponse.json({ success: false, error: `Suggest failed: ${message}` }, { status: 500 });
  }
}
