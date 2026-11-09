// ============================================================
// AI Creative Engine — Gemini API Handler
// POST /api/ai
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";
import { getCurrentUser } from "@/lib/auth";
import type { AdCreative, Platform } from "@/types/ads.types";
import { friendlyError } from "@/lib/not-configured";

// ─────────────────────────────────────────────
// Request body shape
// ─────────────────────────────────────────────

interface CreativeRequest {
  platform: "facebook" | "google";
  objective: string;
  product: string;
  targetAudience: string;
  tone: string;
  budget?: string;
  count?: number;
}

// ─────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────

function buildPrompt(body: CreativeRequest): string {
  const count = body.count ?? 5;
  const platformName =
    body.platform === "facebook" ? "Facebook / Meta Ads" : "Google Search Ads";

  const facebookFormat = `
For Facebook Ads format each variant as:
- primaryText (125 chars max): the main ad body copy
- headline (40 chars max): bold headline
- description (30 chars max): link description
- cta: one of [Shop Now, Learn More, Sign Up, Get Offer, Download, Contact Us]`;

  const googleFormat = `
For Google Search Ads format each variant as:
- headline1 (30 chars max): first headline
- headline2 (30 chars max): second headline
- headline3 (30 chars max): third headline
- description1 (90 chars max): first description line
- description2 (90 chars max): second description line`;

  const formatBlock =
    body.platform === "facebook" ? facebookFormat : googleFormat;

  return `You are an expert performance marketing copywriter specializing in paid advertising.
Generate exactly ${count} ad creative variants for ${platformName}.

Product/Service: ${body.product}
Campaign Objective: ${body.objective}
Target Audience: ${body.targetAudience}
Tone: ${body.tone}
${body.budget ? `Budget Level: ${body.budget}` : ""}

${formatBlock}

For EVERY variant, also include:
- "score": a number from 1-10 rating the variant's expected performance (10 = exceptional)
- "reason": a short sentence (under 100 chars) explaining why you gave that score

Return ONLY a valid JSON array of exactly ${count} objects. No markdown, no code fences, no explanation outside the JSON.
${body.platform === "facebook" ? 'Each object keys: primaryText, headline, description, cta, score, reason' : 'Each object keys: headline1, headline2, headline3, description1, description2, score, reason'}`;
}

// ─────────────────────────────────────────────
// Map raw Gemini output → AdCreative[]
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapToAdCreatives(raw: any[], platform: Platform): AdCreative[] {
  return raw.map((v, i) => {
    const isFb = platform === "facebook";

    return {
      id:          `gen_${Date.now()}_${i}`,
      platform,
      format:      isFb ? "feed" : "search",
      headline:    isFb
        ? String(v.headline ?? "")
        : String(v.headline1 ?? ""),
      primaryText: isFb
        ? String(v.primaryText ?? "")
        : [v.headline2, v.headline3].filter(Boolean).join(" | "),
      description: isFb
        ? String(v.description ?? "")
        : [v.description1, v.description2].filter(Boolean).join(" "),
      cta:         isFb ? String(v.cta ?? "Learn More") : "",
      score:       typeof v.score === "number" ? v.score : undefined,
      reason:      typeof v.reason === "string" ? v.reason : undefined,
    } satisfies AdCreative;
  });
}

// ─────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  // ── Env guard ──
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: friendlyError("GEMINI_API_KEY not configured. Add it to .env.local and restart."),
      },
      { status: 401 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  // ── Handle freeform AI prompts (alert suggestions, etc.) ──
  if (body.type === "alert_suggestion" && body.prompt) {
    try {
      const geminiRes = await callGemini(body.prompt, { temperature: 0.7, maxOutputTokens: 512, thinkingBudget: 0 }, apiKey);
      return NextResponse.json({ success: true, data: { response: geminiRes.text } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[AI alert_suggestion] Error:", msg);
      return NextResponse.json(
        { success: false, error: `AI suggestion failed: ${msg}` },
        { status: 500 }
      );
    }
  }

  const missing: string[] = [];
  if (!body.product)        missing.push("product");
  if (!body.targetAudience) missing.push("targetAudience");
  if (!body.objective)      missing.push("objective");
  if (!body.tone)           missing.push("tone");
  if (!body.platform)       missing.push("platform");

  if (missing.length) {
    return NextResponse.json(
      { success: false, error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  if (!["facebook", "google"].includes(body.platform)) {
    return NextResponse.json(
      { success: false, error: `Invalid platform "${body.platform}". Use "facebook" or "google".` },
      { status: 400 }
    );
  }

  const count = body.count ?? 5;
  if (count < 1 || count > 10) {
    return NextResponse.json(
      { success: false, error: "count must be between 1 and 10." },
      { status: 400 }
    );
  }

  try {
    const prompt = buildPrompt(body);
    const geminiRes = await callGemini(prompt, { temperature: 0.85, topP: 0.95, maxOutputTokens: 900, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey);

    // ── Parse JSON array ──
    const cleaned = geminiRes.text.replace(/```json\n?|```\n?/g, "").trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any[];
    try {
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Gemini returned invalid JSON. Please try again.",
          rawResponse: cleaned.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // ── Map to typed AdCreative[] ──
    const creatives = mapToAdCreatives(parsed, body.platform);

    return NextResponse.json({
      success:     true,
      data:        creatives,
      platform:    body.platform,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.toLowerCase().includes("api key") || message.toLowerCase().includes("permission")) {
      return NextResponse.json(
        { success: false, error: `Gemini authentication error: ${message}` },
        { status: 401 }
      );
    }
    if (message.toLowerCase().includes("quota") || message.toLowerCase().includes("rate")) {
      return NextResponse.json(
        { success: false, error: "Gemini API rate limit reached. Please wait and retry." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: `Creative generation failed: ${message}` },
      { status: 500 }
    );
  }
}
