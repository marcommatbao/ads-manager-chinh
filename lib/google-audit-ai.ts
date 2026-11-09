// ============================================================
// Google Audit — Real Gemini AI Insight
// ============================================================
// The "AI Auto-Fix" button on /google-audit historically had no LLM
// call anywhere behind it — a misleading label the Auto-Fix flow keeps
// (it stays deterministic on purpose; see auto-fix/route.ts). This file
// is the actual, real AI integration: a read-only summary generated
// from the 14 deterministic check results, additive on top of them,
// never replacing their rule-based recommendations.
//
// On any failure (no key, flag off, timeout, API error) this returns
// null — NOT a rule-based fallback string. A fallback that silently
// impersonates AI output would recreate the exact dishonesty problem
// this feature exists to fix.

import { callGemini, callWithTimeout } from "./gemini";
import type { AuditResult } from "./google-audit-engine";

// ─────────────────────────────────────────────
// Cost-guard: 1 Gemini call per company per day
// (same in-memory, single-container-deploy pattern as
// lib/morning-briefing.ts's _cachedBriefing, keyed per company here)
// ─────────────────────────────────────────────

const _cache = new Map<string, { date: string; text: string }>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt(result: AuditResult, company: string, lang: "vi" | "en" = "vi"): string {
  const lines = result.checks
    .map((c) => `- [${c.status}] ${c.name} (${c.score}/10): ${c.recommendation}`)
    .join("\n");

  if (lang === "en") return `You are a Google Ads expert. Below are the audit results for account ${company} (overall score ${result.overallScore}/100, grade ${result.letterGrade}), made up of 14 criteria:

${lines}

Write a summary of about 150-200 words in English, containing:
1. The 3 issues to fix first, ordered by impact on cost/performance — do not just list them again, synthesise and explain why they are prioritised.
2. One sentence giving an overall verdict on the account's health.

Note: this is an account-health summary (Audit), not a detailed prioritised action list (that lives on the separate Improvements page) — there is no need to list every step.`;

  return `Bạn là chuyên gia Google Ads. Dưới đây là kết quả audit tài khoản ${company} (điểm tổng ${result.overallScore}/100, hạng ${result.letterGrade}), gồm 14 tiêu chí:

${lines}

Hãy viết một đoạn tóm tắt khoảng 150-200 từ bằng tiếng Việt, gồm:
1. 3 vấn đề ưu tiên xử lý trước nhất, xếp theo mức độ ảnh hưởng tới chi phí/hiệu suất — không chỉ liệt kê lại, hãy tổng hợp và giải thích vì sao ưu tiên.
2. Một câu nhận định tổng thể về sức khỏe tài khoản.

Lưu ý: đây là tóm tắt sức khỏe tài khoản (Audit), không phải danh sách hành động ưu tiên chi tiết (cái đó nằm ở trang Improvements riêng) — không cần liệt kê từng bước thực hiện.`;
}

export async function generateAuditInsight(
  result: AuditResult,
  company: string,
  lang: "vi" | "en" = "vi"
): Promise<string | null> {
  if (process.env.GOOGLE_AUDIT_AI_ENABLED === "false") return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const today = todayStr();
  const cacheKey = lang === "vi" ? company : `${company}|${lang}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.date === today) return cached.text;

  try {
    const prompt = buildPrompt(result, company, lang);
    // thinkingBudget: 0 is required — extended thinking của Gemini
    // otherwise consumes maxOutputTokens before emitting any visible text,
    // silently truncating the response (known gotcha, hit here in testing:
    // output cut off at ~70 chars mid-sentence with no error).
    const { result: geminiRes, timedOut } = await callWithTimeout(
      () => callGemini(prompt, { temperature: 0.5, maxOutputTokens: 800, thinkingBudget: 0 }, apiKey),
      20000
    );
    if (timedOut || !geminiRes?.text) {
      console.warn("[GoogleAuditAI] Gemini timed out or empty — no insight this run");
      return null;
    }
    _cache.set(cacheKey, { date: today, text: geminiRes.text });
    return geminiRes.text;
  } catch (err) {
    console.warn("[GoogleAuditAI] Gemini call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
