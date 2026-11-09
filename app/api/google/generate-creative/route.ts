// ============================================================
// Google Creative Generator
// POST /api/google/generate-creative
// ============================================================
// Input: { segment, productId, company, campaignType }
// productId = known ID (e.g. "DOMAIN") or "custom_<name>" for custom products
// Output: { success, rsa, pmax, keywords, product, id }
// ============================================================

import { brandPromptBlock } from "@/lib/brand/types";
import { brandOverride } from "@/lib/brand/store";
import { NextRequest, NextResponse } from "next/server";
import { planNegativeKeywords } from "@/lib/google-negative-keywords";
import { getCurrentUser } from "@/lib/auth";
import { callGemini } from "@/lib/gemini";
import { ALL_PRODUCTS, getProductUrl } from "@/lib/google-creative-engine";
import { withFileLock } from "@/lib/file-lock";
import { recomputeGoogleAdItems, GOOGLE_RSA_LIMITS, GOOGLE_PMAX_LIMITS } from "@/lib/creative-limits";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { companyLabel, companyUrl } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

const LOCK_KEY = "google-creatives";

// ── Save creative to file store ──
async function saveCreative(data: Record<string, unknown>): Promise<string> {
  return withFileLock(LOCK_KEY, async () => {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, "google-creatives.json");
    let list: Record<string, unknown>[] = [];
    if (fs.existsSync(filePath)) {
      try { list = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { list = []; }
    }
    const id = `gc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    list.push({ ...data, id, createdAt: new Date().toISOString() });
    writeFileAtomicSync(filePath, JSON.stringify(list, null, 2));
    return id;
  });
}

// ── Parse JSON safely from Gemini text ──
function parseJson(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const raw = match ? match[1].trim() : text.trim();
  return JSON.parse(raw);
}

// ── Build Gemini prompt for RSA + PMax + Keywords ──
function buildPrompt(params: {
  productName: string;
  finalUrl: string;
  company: string;
  campaignType: string;
  segment: Record<string, unknown>;
  usp: string[];
  painPoints: string[];
  searchIntents: string[];
}): string {
  const { productName, finalUrl, company, campaignType, segment, usp, painPoints, searchIntents } = params;
  // Đợt 21 A3: hồ sơ doanh nghiệp (null = MBC/MBI chưa lưu hồ sơ → chuỗi cũ y nguyên).
  const bp = brandOverride(company);
  const brandName = bp?.brandName ?? (company === "MBI" ? "Matbao Invoice" : company === "MBC" ? "Mắt Bão" : companyLabel(company));
  const brandBlock = bp ? brandPromptBlock(bp) : "";
  // Chấp nhận cả `name` lẫn `segmentName`: kiểu AudienceSegment dùng
  // `segmentName`, còn chỗ này vốn chỉ đọc `name` — nên trước 26/08/2026 prompt
  // này nhận ĐÚNG SỐ KHÔNG ngữ cảnh đối tượng mà không ai biết (chuỗi rỗng thì
  // không có gì để báo lỗi).
  const segName = (segment?.name ?? segment?.segmentName) as string | undefined;
  const segDesc = segName ? `Segment: ${segName}` : "";
  const list = (v: unknown, n: number) => Array.isArray(v) ? (v as string[]).slice(0, n).join(", ") : "";
  const segKw = list(segment?.keywords, 10);
  const segNeg = list(segment?.negativeKeywords, 10);
  const segPain = list(segment?.painPoints, 4);

  const needRSA  = campaignType === "SEARCH" || campaignType === "BOTH";
  const needPMax = campaignType === "PMAX"   || campaignType === "BOTH";

  return `You are a Google Ads expert for ${brandName} (Vietnam market). Generate creative assets for the product: "${productName}".

Context:
- Brand: ${brandName}${brandBlock ? `\n${brandBlock}` : ""}
- Product: ${productName}
- Landing page: ${finalUrl}
- ${segDesc}
${segKw ? `- Từ khoá phân khúc này thật sự gõ vào Google (ƯU TIÊN dùng chính những cụm này trong headline): ${segKw}` : ""}
${segNeg ? `- KHÔNG viết nội dung thu hút những người tìm: ${segNeg}` : ""}
${segPain ? `- Nỗi đau của phân khúc: ${segPain}` : ""}
${usp.length ? `- USPs: ${usp.slice(0, 4).join(" | ")}` : ""}
${painPoints.length ? `- Pain points (catalog): ${painPoints.slice(0, 3).join(" | ")}` : ""}
${searchIntents.length ? `- Search intents (catalog): ${searchIntents.slice(0, 5).join(", ")}` : ""}

IMPORTANT RULES:
- Write in Vietnamese (vi-VN)
- Headlines: hard limit 30 characters INCLUDING spaces — but AIM FOR 28 to leave margin.
- Descriptions: hard limit 90 characters INCLUDING spaces — but AIM FOR 86 to leave margin.
- Vietnamese diacritics (ế, ườ, ị…) count as ONE character each, not two. Count the visible
  characters. Measured 27/08/2026: 3 of 4 descriptions came back at 91-92 chars — over the limit,
  which means they are SILENTLY DROPPED at launch, not rejected. Losing descriptions below the
  minimum of 2 makes the ad impossible to create. Err on the short side.
- At least 4 out of 15 headlines MUST contain the exact product name or main keyword (e.g. "${productName}") — this is required by Google Ads to avoid "low relevance" warnings.
- At least 2 out of 4 descriptions MUST mention the product name or main keyword.
- Be specific, avoid generic phrases like "chất lượng tốt", "dịch vụ tốt"
- Focus on concrete benefits, numbers, and urgency

Return ONLY valid JSON matching this exact schema:
{
  ${needRSA ? `"rsa": {
    "headlines": [
      { "id": 1, "type": "KW", "text": "...", "charCount": 0, "isValid": true }
    ],
    "descriptions": [
      { "id": 1, "text": "...", "charCount": 0, "isValid": true }
    ]
  },` : '"rsa": null,'}
  ${needPMax ? `"pmax": {
    "headlines": [
      { "id": 1, "text": "...", "charCount": 0, "isValid": true }
    ],
    "longHeadlines": [
      { "id": 1, "text": "...", "charCount": 0, "isValid": true }
    ],
    "descriptions": [
      { "id": 1, "text": "...", "charCount": 0, "isValid": true }
    ],
    "audienceSignals": {
      "customIntent": ["keyword 1", "keyword 2", "keyword 3"],
      "customerList": "Khách hàng đã dùng ${productName}, quan tâm ${productName}"
    }
  },` : '"pmax": null,'}
  "keywords": {
    "keywords": [
      { "keyword": "...", "matchType": "EXACT|PHRASE|BROAD", "intentLevel": "HIGH|MEDIUM|LOW", "note": "..." }
    ]
  }
}

Rules for the output:
${needRSA ? `- RSA headlines: generate exactly 15, types: KW (keyword-focused), USP (unique value), PRICE (pricing), BRAND (brand), TRUST (social proof), CTA (call to action)
- RSA descriptions: generate exactly 4, each ≤90 chars

  KEYWORD COVERAGE (CRITICAL — this is what Google grades):
  Google's "Ad strength" scores an ad POOR when its headlines do not repeat the
  ad group's own keywords. The check is literal: Google looks for the keyword
  text INSIDE a headline.
  • At LEAST 6 of the 15 headlines (all type "KW") must contain one of the
    keywords you generate in the "keywords" block BELOW, written the same way —
    same words, same order. Do not paraphrase them.
  • Use a DIFFERENT keyword in each of those 6 — do not repeat one keyword
    across several headlines. Covering 6 distinct keywords is the goal.
  • Pick the 6 MOST COMMONLY SEARCHED keywords — the short, plain ways people
    actually type the need ("mua tên miền", "mua domain", "tên miền giá rẻ",
    "đăng ký tên miền"). Google grades against POPULAR keywords, so covering
    six rare long-tail phrases scores nothing.
  • Put BOTH wordings of the product in headlines when both are common in
    Vietnamese — e.g. "tên miền" AND "domain" are searched separately and a
    headline covering one does not cover the other.
  • Every keyword AND every headline must be about ${productName} itself. Do
    NOT drift into adjacent services (for a domain product: no "thiết kế
    website", "làm web khách sạn", "tạo web homestay"). Those attract clicks
    from people who will not buy this product.
  • A headline may add words around the keyword to reach 20-30 chars
    ("Mua tên miền .vn giá rẻ"), but the keyword itself must stay intact.
  • The remaining 9 headlines carry USP / PRICE / BRAND / TRUST / CTA and must
    NOT repeat each other's wording — Google also grades headline uniqueness.
  Write the keywords block FIRST in your head, then build these 6 headlines
  from it, so the two actually match.` : ""}
${needPMax ? `- PMax headlines: exactly 15, each ≤30 chars
- PMax longHeadlines: exactly 5, each ≤90 chars
- PMax descriptions: exactly 5, each ≤90 chars` : ""}
- Keywords: generate 15-25 keywords.
  MATCH TYPE RULES (CRITICAL — wrong match type wastes budget):
  • EXACT [keyword]: exact phrase only → use for high-intent product-specific terms (e.g. "mua vibe hosting", "đăng ký vibe hosting", "vibe hosting giá rẻ")
  • PHRASE "keyword": close variants of phrase → use for buying-intent queries
  • BROAD ~keyword: wide reach → use SPARINGLY (max 20% of total), only for brand discovery terms
  Keywords MUST contain the product name "${productName}" or closely related product terms.
  NO generic standalone keywords like "hosting", "dịch vụ", "mua ngay" without the product name — these waste budget on irrelevant searches.

Compute charCount accurately and set isValid = charCount <= 30 for headlines, charCount <= 90 for descriptions.`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json() as {
      productId: string;
      company: string;
      campaignType: "SEARCH" | "PMAX" | "BOTH";
      segment: Record<string, unknown>;
    };

    const { productId, company, campaignType, segment } = body;
    if (!productId || !company || !campaignType) {
      return NextResponse.json({ error: "productId, company, campaignType are required" }, { status: 400 });
    }

    // Resolve product info
    let productName: string;
    let finalUrl: string;
    let usp: string[] = [];
    let painPoints: string[] = [];
    let searchIntents: string[] = [];

    if (productId.startsWith("custom_")) {
      // Custom product — user-supplied name, use generic matbao.net URL
      productName = productId.replace(/^custom_/, "").trim();
      const bp = brandOverride(company);
      // Đợt 21 A3: sản phẩm khai trong hồ sơ → đúng trang đích của nó; không thì trang chủ của công ty.
      const fromProfile = bp?.products.find((p) => p.name.toLowerCase() === productName.toLowerCase())?.url;
      const baseUrl = fromProfile ?? (bp?.domain ? `https://${bp.domain}` : company === "MBI" ? "https://matbao.in" : company === "MBC" ? "https://matbao.net" : companyUrl(company));
      finalUrl = baseUrl;
      if (bp) usp = bp.strengths;
    } else {
      const product = ALL_PRODUCTS[productId];
      if (!product) {
        return NextResponse.json({ error: `Unknown productId: ${productId}` }, { status: 400 });
      }
      productName   = product.name;
      finalUrl      = getProductUrl(productId, company) ?? (company === "MBI" ? "https://matbao.in" : company === "MBC" ? "https://matbao.net" : companyUrl(company));
      usp           = product.usp ?? [];
      painPoints    = product.painPoints ?? [];
      searchIntents = product.searchIntents ?? [];
    }

    // Call Gemini
    const prompt = buildPrompt({ productName, finalUrl, company, campaignType, segment, usp, painPoints, searchIntents });
    const geminiRes = await callGemini(prompt, {
      temperature: 0.6,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingBudget: 0,
    });

    let generated: Record<string, unknown>;
    try {
      generated = parseJson(geminiRes.text) as Record<string, unknown>;
    } catch {
      console.error("[generate-creative] Parse failed. finishReason:", geminiRes.finishReason, "First 200 chars:", geminiRes.text.slice(0, 200));
      return NextResponse.json({ error: "Gemini trả về không phải JSON hợp lệ — thử lại." }, { status: 500 });
    }

    // Gemini self-reports charCount/isValid per item in the prompt schema —
    // never verified. Recompute from the actual string so downstream UI
    // badges and launch-preflight checks reflect reality, not AI self-report.
    const rsa = generated.rsa as { headlines?: unknown; descriptions?: unknown } | null | undefined;
    if (rsa) {
      rsa.headlines    = recomputeGoogleAdItems(rsa.headlines, GOOGLE_RSA_LIMITS.headline);
      rsa.descriptions = recomputeGoogleAdItems(rsa.descriptions, GOOGLE_RSA_LIMITS.description);
    }
    const pmax = generated.pmax as { headlines?: unknown; longHeadlines?: unknown; descriptions?: unknown } | null | undefined;
    if (pmax) {
      pmax.headlines     = recomputeGoogleAdItems(pmax.headlines, GOOGLE_PMAX_LIMITS.headline);
      pmax.longHeadlines = recomputeGoogleAdItems(pmax.longHeadlines, GOOGLE_PMAX_LIMITS.longHeadline);
      pmax.descriptions  = recomputeGoogleAdItems(pmax.descriptions, GOOGLE_PMAX_LIMITS.description);
    }

    // ── Từ khoá phủ định ───────────────────────────────────────────────────
    // ĐÂY LÀ CHỖ TRƯỚC ĐÂY ĐỨT GÃY. Schema yêu cầu Gemini trả về (buildPrompt)
    // không có trường `negativeKeywords`, nên `generated.keywords.negativeKeywords`
    // luôn undefined — trong khi launch/search:507 và giao diện đều đọc nó như
    // thể nó tồn tại. Kết quả: MỌI chiến dịch Search ra đời với ĐÚNG SỐ KHÔNG
    // từ khoá phủ định, và với match type BROAD/PHRASE thì tiền chảy vào
    // "tuyển dụng hosting", "hosting miễn phí", "crack"…
    //
    // `segment.negativeKeywords` do AI sinh ở bước phân tích đối tượng vẫn
    // luôn có — nó chỉ chưa bao giờ được ghép vào đây, mà chỉ được nhét vào
    // câu lệnh viết quảng cáo ở dòng 83.
    const kwBlock = generated.keywords as
      ({ keywords?: Array<{ keyword?: string }> } & Record<string, unknown>) | undefined;
    const positiveKeywords = (kwBlock?.keywords ?? [])
      .map((k) => String(k?.keyword ?? "")).filter(Boolean);

    const negPlan = planNegativeKeywords({
      positiveKeywords,
      aiNegatives: Array.isArray(segment?.negativeKeywords)
        ? (segment.negativeKeywords as unknown[]).map(String)
        : [],
    });

    if (kwBlock) {
      kwBlock.negativeKeywords = negPlan.keywords;
      // Giữ lại phần XUNG ĐỘT để nói ra, không lọc im lặng: những cụm này bị
      // bỏ vì chúng sẽ chặn chính từ khoá của mình — người dùng cần biết.
      kwBlock.negativeConflicts = negPlan.conflicts;
    }

    // Persist and return
    const id = await saveCreative({
      productId,
      productName,
      company,
      campaignType,
      ...generated,
    });

    return NextResponse.json({
      success: true,
      id,
      product: { name: productName, finalUrl },
      rsa: generated.rsa ?? null,
      pmax: generated.pmax ?? null,
      keywords: generated.keywords ?? null,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-creative]", message);
    if (message.includes("RATE_LIMITED")) {
      return NextResponse.json({ success: false, error: "Rate limit — thử lại sau 30 giây" }, { status: 429 });
    }
    if (message.includes("GEMINI_TIMEOUT")) {
      return NextResponse.json({ success: false, error: "AI phản hồi quá lâu — vui lòng thử lại" }, { status: 504 });
    }
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
