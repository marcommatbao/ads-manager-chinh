// ============================================================
// Creative Text Generator — POST /api/creative/generate-text
// Called by Creative AI Studio Step 3 for each segment × tone × platform
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getInsightsForToneSegment } from "@/lib/creative-tracker";
import { callGemini, type GeminiResponse } from "@/lib/gemini";
import { scoreCreative } from "@/lib/creative-scorer";
import { getT } from "@/lib/i18n/server";
import { getRelevantMemories, buildMemoryPromptSection } from "@/lib/ai-memory-engine";
import { creativeBrandPrompt } from "@/lib/brand/creative";
import { isCompany } from "@/lib/companies";
import { canAccessCompany } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth";
import { checkCreativeLimits, formatViolationsForRetry } from "@/lib/creative-limits";
import { runGeneratedCompliance } from "@/lib/creative-brief/compliance";
import { friendlyError } from "@/lib/not-configured";

interface GenerateTextRequest {
  product: string;
  segment: string;
  segmentName: string;
  funnelStage?: string;
  tone: string;
  toneLabel: string;
  usp?: string;
  socialProof?: string;
  offer?: string;
  platform: "facebook" | "google";
  objective?: string;
  company?: string;
  /** Optional: brief ID to echo back in the response for alignment tracking */
  briefId?: string;
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: "Chuyên nghiệp, B2B. Dùng số liệu, logic. Không cảm xúc thái quá.",
  urgent:       "Khẩn cấp, có deadline/giới hạn. CTA mạnh, tạo FOMO thời gian.",
  friendly:     "Thân thiện, gần gũi. Dùng 'bạn', emoji nhẹ nhàng.",
  authority:    "Dùng social proof, số liệu, giải thưởng, thương hiệu uy tín.",
  fomo:         "FOMO — đối thủ đang làm, thị trường đang thay đổi, đừng bị bỏ lại.",
  value:        "Nhấn mạnh giá trị/tiết kiệm. So sánh chi phí vs lợi ích rõ ràng.",
};

// Checklist 4U — áp cho cả 2 platform. Không thay bộ chấm điểm 6 tiêu chí
// (lib/creative-scorer.ts) mà chỉ là hướng dẫn cho Gemini lúc viết; 3/4 chữ
// U đã được scorer phủ (Useful≈clarity, Urgent≈tone/offer, Unique≈socialProof)
// nhưng "Ultra-specific" (số liệu/chi tiết cụ thể thay vì chung chung) thì
// scorer hiện chưa có tiêu chí riêng — thêm ở đây để copy sinh ra cụ thể hơn.
const FOUR_U_CHECKLIST = `
Áp dụng công thức 4U khi viết:
- Useful: nói đúng sản phẩm/lợi ích cho đối tượng này, không chung chung
- Urgent: tạo áp lực thời gian/số lượng nếu hợp với offer (không bịa deadline không có thật)
- Unique: nêu điểm khác biệt thật của sản phẩm, không phải tính năng ai cũng có
- Ultra-specific: ưu tiên số liệu/chi tiết cụ thể (%, thời gian, khu vực...) thay vì mơ hồ — chỉ dùng số liệu có trong USP/offer/social proof ở trên, không tự bịa`;

function buildPrompt(body: GenerateTextRequest): string {
  const toneInstruction = TONE_INSTRUCTIONS[body.tone] ?? `Tone: ${body.toneLabel}`;
  const uspLine = body.usp ? `\nUSP: ${body.usp}` : "";
  const proofLine = body.socialProof ? `\nSocial proof: ${body.socialProof}` : "";
  const offerLine = body.offer ? `\nOffer: ${body.offer}` : "";

  // ── KHÉP VÒNG HỌC (nối 16/09/2026) ──
  // Hệ thống VẪN GHI bài học từ hiệu suất creative thật sau mỗi lần review
  // (saveLearningInsight ở app/api/creatives/route.ts), nhưng hai hàm ĐỌC lại
  // — getLearningInsights / getInsightsForToneSegment — không nơi nào gọi.
  // Tức vòng học chỉ có nửa đầu: ghi rồi để đó, lần sinh sau không được nạp
  // lại gì. Nay nạp đúng những bài học của CÙNG tone/segment vào prompt.
  //
  // Đọc file cục bộ nên bọc try/catch: hỏng thì sinh creative như trước, không
  // để một tính năng phụ chặn việc chính.
  let lessonBlock = "";
  try {
    const lessons = getInsightsForToneSegment(body.tone, body.segment)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5);
    if (lessons.length > 0) {
      lessonBlock = `\n\nBÀI HỌC TỪ CREATIVE ĐÃ CHẠY THẬT (cùng tone/đối tượng — bám vào, đừng lặp lại cái đã kém):\n`
        + lessons.map(l => `- ${l.learning} (CTR đo được: ${(l.sample_accurate_ctr * 100).toFixed(2)}%)`).join("\n");
    }
  } catch (err) {
    console.warn("[generate-text] không đọc được bài học creative:", err instanceof Error ? err.message : err);
  }

  if (body.platform === "facebook") {
    return `Chuyên gia viết quảng cáo Facebook Ads B2B Việt Nam.

Sản phẩm: ${body.product}
Đối tượng: ${body.segment}
Mục tiêu: ${body.objective || "Lead generation"}
Funnel: ${body.funnelStage || "TOFU"}
Tone: ${body.toneLabel} — ${toneInstruction}${uspLine}${proofLine}${offerLine}
${FOUR_U_CHECKLIST}${lessonBlock}

Viết 1 bộ Facebook Ad (primaryText + headline + description + cta) và chấm điểm.

JSON (không markdown):
{
  "primaryText": "nội dung chính tối đa 125 ký tự, đúng tone",
  "headline": "tiêu đề tối đa 40 ký tự, gây chú ý",
  "description": "mô tả tối đa 30 ký tự, hỗ trợ headline",
  "cta": "Shop Now|Learn More|Sign Up|Download|Contact Us",
  "score": 7,
  "reason": "lý do ngắn dưới 80 ký tự"
}`;
  }

  return `Chuyên gia viết Google Search Ads B2B Việt Nam.

Sản phẩm: ${body.product}
Từ khóa đối tượng: ${body.segment}
Mục tiêu: ${body.objective || "Lead generation"}
Tone: ${body.toneLabel} — ${toneInstruction}${uspLine}${proofLine}${offerLine}
${FOUR_U_CHECKLIST}${lessonBlock}

Viết 1 bộ Google Search Ad (3 headlines + 2 descriptions) và chấm điểm.

JSON (không markdown):
{
  "headline": "headline1 tối đa 30 ký tự",
  "primaryText": "headline2 | headline3 (mỗi cái tối đa 30 ký tự)",
  "description": "description1. description2 (mỗi cái tối đa 90 ký tự)",
  "cta": "",
  "score": 7,
  "reason": "lý do ngắn dưới 80 ký tự"
}`;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: friendlyError("GEMINI_API_KEY not configured") }, { status: 401 });
  }

  let body: GenerateTextRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.product || !body.platform) {
    return NextResponse.json({ success: false, error: "product and platform are required" }, { status: 400 });
  }
  // Đợt 21 A3b: công ty gửi lên phải là công ty người này được xem (khối thương hiệu đọc theo công ty đó).
  if (body.company !== undefined && (!isCompany(body.company) || !canAccessCompany(user, body.company))) {
    return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 });
  }

  // Pull relevant AI memories (non-blocking — generation continues if this fails)
  let memorySection = "";
  try {
    const memories = getRelevantMemories({
      company:     body.company ?? "MBC",
      funnelStage: body.funnelStage,
      product:     body.product,
    });
    if (memories.length > 0) {
      memorySection = buildMemoryPromptSection(memories) + "\n\n";
    }
  } catch {
    // Memory injection is best-effort — never block generation
  }

  // Đợt 21 A3b: công ty ngoài gói Mắt Bão → thêm khối hồ sơ thương hiệu (MBC/MBI: chuỗi rỗng — lời nhắc cũ y nguyên).
  const prompt = memorySection + buildPrompt(body) + creativeBrandPrompt(body.company);

  interface GeneratedFields {
    headline: string;
    primaryText: string;
    description: string;
    cta: string;
    parsed: Record<string, unknown>;
    geminiRes: GeminiResponse;
  }

  async function generateOnce(p: string): Promise<GeneratedFields> {
    const geminiRes = await callGemini(
      p,
      { temperature: 0.8, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingBudget: 0 },
      apiKey
    );

    const rawText = geminiRes.text?.trim() ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Strip potential markdown fences
      const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[generate-text] Parse failed. finishReason:", geminiRes.finishReason, "First 200 chars:", rawText.slice(0, 200));
        throw new Error("PARSE_FAILED");
      }
    }

    return {
      headline:    String(parsed.headline    ?? ""),
      primaryText: String(parsed.primaryText ?? ""),
      description: String(parsed.description ?? ""),
      cta:         String(parsed.cta         ?? "Learn More"),
      parsed,
      geminiRes,
    };
  }

  try {
    let result = await generateOnce(prompt);
    let violations = checkCreativeLimits(body.platform, result);

    // Thử lại TỐI ĐA 2 LẦN, mỗi lần nạp lại đúng field vượt và độ dài thật.
    //
    // Một lần là không đủ: đo ở prod 25/08 vẫn còn description 33/30 lọt ra
    // giao diện sau khi đã retry. Phần vượt thường rất nhỏ (+3 tới +5 ký tự),
    // nên thêm một lần nữa kèm mục tiêu có dự phòng (xem targetWithHeadroom)
    // gỡ được phần lớn. Giữ bản NGẮN NHẤT trong các lần thử, không phải bản
    // cuối — lần thử sau có thể tệ hơn lần trước.
    const MAX_LIMIT_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_LIMIT_RETRIES && violations.length > 0; attempt++) {
      try {
        const retryResult = await generateOnce(prompt + formatViolationsForRetry(violations));
        const retryViolations = checkCreativeLimits(body.platform, retryResult);
        const totalExcess = (vs: typeof violations) => vs.reduce((n, v) => n + v.excess, 0);
        if (retryViolations.length < violations.length || totalExcess(retryViolations) < totalExcess(violations)) {
          result = retryResult;
          violations = retryViolations;
        }
      } catch {
        break; // Retry hỏng — giữ bản tốt nhất đang có, để chỗ gọi tự quyết.
      }
    }

    const { headline, primaryText, description, cta, parsed } = result;

    if (!headline && !primaryText) {
      return NextResponse.json({ success: false, error: "AI không tạo được nội dung" }, { status: 502 });
    }

    // Run deterministic 6-dimension score immediately after generation.
    // This is the authoritative score (0-100); Gemini's 1-10 is kept as a rough
    // "AI confidence" estimate only.
    const detailedScore = scoreCreative({
      headline,
      primaryText,
      description,
      hasImage: false, // no image at generation time
      usp:         body.usp         ?? "",
      socialProof: body.socialProof ?? "",
      offer:       body.offer       ?? "",
      cta,
    }, await getT());

    // Product display name → key heuristic (main wizard only sends the label,
    // e.g. "Hosting" — see _constants.ts ALL_PRODUCTS_LIST). Only "hosting"
    // currently gates a compliance rule (UPTIME_OVERCLAIM), so this narrow
    // check is enough; extend if more product-specific rules are added.
    const productKey = /hosting/i.test(body.product) ? "hosting" : undefined;

    const complianceNotes = runGeneratedCompliance({
      headline, primaryText, description, cta,
      platform: body.platform,
      funnelStage: body.funnelStage,
      usp: body.usp,
      productKey,
      hasProof: !!body.socialProof,
      hasPromo: !!body.offer,
    }, await getT());

    const data = {
      id: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      segmentName: body.segmentName,
      segmentIndex: 0,
      funnelStage: body.funnelStage ?? "TOFU",
      tone: body.tone,
      toneLabel: body.toneLabel,
      platform: body.platform,
      headline,
      primaryText,
      description,
      cta,
      score: typeof parsed.score === "number" ? parsed.score : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      detailedScore,
      briefId: body.briefId,
      selected: false,
      withinLimits: violations.length === 0,
      limitViolations: violations.length > 0 ? violations : undefined,
      productKey,
      complianceNotes: complianceNotes.length > 0 ? complianceNotes : undefined,
    };

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "PARSE_FAILED") {
      return NextResponse.json({ success: false, error: "AI trả về dữ liệu không hợp lệ" }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("RATE_LIMITED")) {
      return NextResponse.json({ success: false, error: "Rate limit — thử lại sau 30 giây" }, { status: 429 });
    }
    if (message.includes("GEMINI_TIMEOUT")) {
      return NextResponse.json({ success: false, error: "AI phản hồi quá lâu — vui lòng thử lại" }, { status: 504 });
    }
    return NextResponse.json({ success: false, error: `Generate failed: ${message}` }, { status: 500 });
  }
}
