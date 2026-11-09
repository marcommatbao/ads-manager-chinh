// POST /api/creative/improve-text
// AI-powered creative improvement based on score dimensions
import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";
import { getCurrentUser } from "@/lib/auth";
import { creativeBrandPrompt } from "@/lib/brand/creative";
import { isCompany } from "@/lib/companies";
import { canAccessCompany } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";

interface ImproveRequest {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  platform: "facebook" | "google";
  scores: Record<string, number>;
  suggestions: string[];
  product: string;
  segmentName: string;
  funnelStage?: string;
  tone?: string;
  toneLabel?: string;
  usp?: string;
  socialProof?: string;
  offer?: string;
  /** Đợt 21 A3b: công ty đang làm creative (khối hồ sơ thương hiệu). Thiếu = cách cũ. */
  company?: string;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: friendlyError("GEMINI_API_KEY not configured") }, { status: 401 });
  }

  let body: ImproveRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  // Đợt 21 A3b: công ty gửi lên phải là công ty người này được xem (khối thương hiệu đọc theo công ty đó).
  if (body.company !== undefined && (!isCompany(body.company) || !canAccessCompany(user, body.company))) {
    return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 });
  }

  const weakDimensions = Object.entries(body.scores)
    .filter(([, v]) => v < 7)
    .map(([k]) => k)
    .join(", ");

  const suggestionText = body.suggestions.length > 0
    ? `\nCần cải thiện: ${body.suggestions.join("; ")}`
    : "";

  const isFacebook = body.platform === "facebook";

  const prompt = `Bạn là chuyên gia tối ưu quảng cáo Facebook/Google B2B Việt Nam.

Sản phẩm: ${body.product}
Đối tượng: ${body.segmentName}
Tone: ${body.toneLabel ?? body.tone ?? "professional"}
${body.usp ? `USP: ${body.usp}` : ""}${body.offer ? `\nOffer: ${body.offer}` : ""}

Creative hiện tại (${body.platform}):
- Headline: ${body.headline}
- PrimaryText: ${body.primaryText}
- Description: ${body.description}
- CTA: ${body.cta}

Điểm yếu: ${weakDimensions || "Cải thiện tổng thể"}${suggestionText}

Cải thiện creative. ${isFacebook
  ? "primaryText tối đa 125 ký tự, headline tối đa 40 ký tự, description tối đa 30 ký tự."
  : "headline tối đa 30 ký tự, primaryText là headline2|headline3 mỗi cái 30 ký tự, description tối đa 90 ký tự."
}

JSON (không markdown):
{"headline":"...","primaryText":"...","description":"...","cta":"...","score":8,"reason":"lý do ngắn"}`;
  const promptWithBrand = prompt + creativeBrandPrompt(body.company); // Đợt 21 A3b

  try {
    const geminiRes = await callGemini(
      promptWithBrand,
      { temperature: 0.7, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingBudget: 0 },
      apiKey
    );
    const rawText = geminiRes.text?.trim() ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[improve-text] Parse failed. finishReason:", geminiRes.finishReason, "First 200 chars:", rawText.slice(0, 200));
        return NextResponse.json({ success: false, error: "AI trả về dữ liệu không hợp lệ" }, { status: 502 });
      }
    }
    return NextResponse.json({
      success: true,
      data: {
        headline: String(parsed.headline ?? body.headline),
        primaryText: String(parsed.primaryText ?? body.primaryText),
        description: String(parsed.description ?? body.description),
        cta: String(parsed.cta ?? body.cta),
        score: typeof parsed.score === "number" ? parsed.score : undefined,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("RATE_LIMITED")) {
      return NextResponse.json({ success: false, error: "Rate limit — thử lại sau 30 giây" }, { status: 429 });
    }
    if (message.includes("GEMINI_TIMEOUT")) {
      return NextResponse.json({ success: false, error: "AI phản hồi quá lâu — vui lòng thử lại" }, { status: 504 });
    }
    return NextResponse.json({ success: false, error: `Improve failed: ${message}` }, { status: 500 });
  }
}
