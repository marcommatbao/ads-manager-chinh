// Gemini AI connector check — validate API key with a tiny model call
import type { CheckResult } from "../types";
// Thông điệp lỗi của Google có chứa nguyên văn khoá API — che trước khi ghi vào
// bản ghi sức khoẻ connector (bản ghi này hiện trên UI và nằm lại trên đĩa).
import { redactApiKeys } from "@/lib/gemini";

export async function checkGemini(): Promise<CheckResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "GEMINI_API_KEY not set" };
  }

  try {
    // Cheapest possible call — list models (no inference tokens)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`,
      { signal: AbortSignal.timeout(6000) },
    );
    const data = await res.json() as { models?: unknown[]; error?: { code: number; message: string } };

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: redactApiKeys(`Invalid API key: ${msg}`) };
    }
    if (res.status === 429) {
      return { ok: false, status: "service_error", failureCategory: "rate_limit", failureReason: "Gemini rate limit (429)" };
    }
    if (!res.ok || data.error) {
      return { ok: false, status: "service_error", failureCategory: "server_error", failureReason: redactApiKeys(data.error?.message ?? `HTTP ${res.status}`) };
    }

    return { ok: true, status: "healthy", note: `${data.models?.length ?? "?"} models available` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("ENOTFOUND")) {
      return { ok: false, status: "service_error", failureCategory: "network", failureReason: `Network error: ${msg}` };
    }
    return { ok: false, status: "service_error", failureCategory: "unknown", failureReason: redactApiKeys(msg) };
  }
}
