// ============================================================
// Gemini REST API Helper
// Replaces @google/generative-ai SDK (broken on v0.24.1)
// ============================================================

import { recordGeminiUsage } from "@/lib/gemini-usage";

// Đổi từ "gemini-2.5-flash" ngày 26/08/2026. Google đã CẤM model 2.5 với mọi
// project tạo mới: `404 — This model is no longer available to new users`. Sau
// khi project Gemini cũ bị khoá và phải dựng project mới, giữ tên 2.5 nghĩa là
// mọi tính năng AI vẫn chết, chỉ đổi từ lỗi "key suspended" sang lỗi "model 404".
//
// Chọn "gemini-3.5-flash" chứ không phải "gemini-flash-latest" — đo thật cả ba:
//   gemini-3.6-flash    → 400, không nhận cấu hình JSON + thinkingBudget của app
//   gemini-flash-latest → chạy, nhưng TÊN TRÔI theo Google (hôm nay ra 3.7-flash)
//                         và VẪN đốt token thinking dù thinkingBudget: 0 — với
//                         maxOutputTokens nhỏ thì finishReason = MAX_TOKENS và
//                         trả về chuỗi RỖNG, đúng cái bẫy từng cắn dự án SEO.
//   gemini-3.5-flash    → STOP, JSON hợp lệ, thoughtsTokenCount = 0.
//
// Cho phép ghi đè bằng env để đổi model không cần deploy lại — Google đã cấm
// model giữa chừng một lần, sẽ còn cấm nữa.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  responseMimeType?: string;
  thinkingBudget?: number; // 0 = disable thinking (faster, cheaper for simple tasks)
  timeoutMs?: number;      // default 25000 — abort the request if Gemini hangs
}

export interface GeminiResponse {
  text: string;
  model: string;
  promptTokens?: number;
  candidateTokens?: number;
  finishReason?: string;
}

/**
 * Che khoá API trong bất kỳ chuỗi nào trước khi nó đi tiếp.
 *
 * Google nhét NGUYÊN VĂN khoá vào thông điệp lỗi của họ:
 *   "Permission denied: Consumer 'api_key:AIzaSy...' has been suspended."
 * Chuỗi đó trước đây được ném thẳng lên route rồi in ra trình duyệt — tức khoá
 * Gemini hiện công khai trên màn hình cho bất cứ ai nhìn được màn hình đó, và
 * nằm lại trong log trình duyệt. Che ở ĐÂY, ngay chỗ chuỗi sinh ra, để không
 * phải nhớ che lại ở từng route.
 */
export function redactApiKeys(text: string): string {
  // Khoá Google có dạng AIza + 35 ký tự [A-Za-z0-9_-].
  return text.replace(/AIza[0-9A-Za-z_-]{35}/g, "AIza…(đã ẩn)");
}

/** Lỗi Gemini đã dịch sang việc người dùng làm được, không phải nguyên văn Google. */
function describeGeminiError(msg: string, code?: number): string {
  const safe = redactApiKeys(msg);
  if (/suspended|CONSUMER_SUSPENDED/i.test(safe)) {
    return "GEMINI_KEY_SUSPENDED: Google đã khoá API key Gemini của dự án này. " +
      "Vào Google Cloud Console → APIs & Services → Credentials để xem lý do " +
      "(thường là vấn đề thanh toán, hoặc khoá bị lộ ra ngoài nên Google tự khoá), " +
      "rồi cấp khoá mới và cập nhật GEMINI_API_KEY.";
  }
  if (code === 403 || /PERMISSION_DENIED|API key not valid/i.test(safe)) {
    return "GEMINI_KEY_INVALID: API key Gemini bị từ chối. Kiểm tra GEMINI_API_KEY " +
      "và xem Generative Language API đã bật cho dự án chưa.";
  }
  return safe;
}

/**
 * Call Gemini API via REST (bypasses broken SDK).
 * Returns the text response from the first candidate.
 */
export async function callGemini(
  prompt: string,
  config: GeminiConfig = {},
  apiKey?: string
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  const generationConfig: Record<string, unknown> = {
    temperature: config.temperature ?? 0.7,
    maxOutputTokens: config.maxOutputTokens ?? 1024,
  };
  if (config.topP !== undefined) generationConfig.topP = config.topP;
  if (config.responseMimeType) generationConfig.responseMimeType = config.responseMimeType;
  // thinkingConfig inside generationConfig — 0 disables thinking for fast/cheap tasks
  if (config.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
  }

  const timeoutMs = config.timeoutMs ?? 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`GEMINI_TIMEOUT: no response after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    error?: { message?: string; code?: number };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    modelVersion?: string;
  };

  if (data.error) {
    const msg = data.error.message || "Gemini API error";
    if (data.error.code === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
      throw new Error("RATE_LIMITED: " + redactApiKeys(msg));
    }
    throw new Error(describeGeminiError(msg, data.error.code));
  }

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    console.error("[callGemini] Abnormal finishReason:", candidate.finishReason, "Candidate data:", JSON.stringify(candidate));
  }
  const text = candidate?.content?.parts?.[0]?.text || "";
  void recordGeminiUsage(data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount);
  return {
    text,
    model: data.modelVersion || GEMINI_MODEL,
    promptTokens: data.usageMetadata?.promptTokenCount,
    candidateTokens: data.usageMetadata?.candidatesTokenCount,
    finishReason: candidate?.finishReason,
  };
}

/**
 * Run an async function with a timeout.
 * Returns { result, timedOut } — never throws on timeout, re-throws other errors.
 */
export async function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = 25000
): Promise<{ result: T | null; timedOut: boolean }> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__TIMEOUT__")), timeoutMs)
      ),
    ]);
    return { result, timedOut: false };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "__TIMEOUT__") {
      console.warn(`⚠️ Gemini timeout after ${timeoutMs}ms`);
      return { result: null, timedOut: true };
    }
    throw err;
  }
}

/**
 * Extract JSON from AI response text with robust cleaning.
 */
export function extractJSON(text: string): object | null {
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/^\s*\n/, "")
    .replace(/\xEF\xBB\xBF/, "")
    .trim();

  try { return JSON.parse(cleaned); } catch { /* continue */ }

  const braceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const candidate = braceMatch[0]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    try { return JSON.parse(candidate); } catch { /* continue */ }
  }

  const bracketMatch = cleaned.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    const candidate = bracketMatch[0]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    try { return JSON.parse(candidate); } catch { /* continue */ }
  }

  return null;
}


// ============================================================
// Streaming variant — used by the AdsBot chat route, which pipes
// tokens straight to the browser as they arrive.
//
// Uses :streamGenerateContent with alt=sse. Each SSE `data:` line carries
// one GenerateContentResponse chunk; we forward only the text delta so the
// client can append raw text without parsing anything.
//
// thinkingBudget defaults to 0 here on purpose: thinking tokens are drawn
// from the same maxOutputTokens pool, and a chat turn that spends the
// budget thinking streams an empty answer.
// ============================================================

export interface ChatTurn {
  role: "user" | "model";
  content: string;
}

/** Một `content` của Gemini — text, hoặc phần functionCall/functionResponse. */
export interface GeminiContent {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
  // gemini-3.5-flash stamps every functionCall part with this, even with
  // thinkingBudget: 0. A follow-up turn that replays the call without
  // echoing it back verbatim gets rejected — HTTP 400 "Function call is
  // missing a thought_signature". gemini-2.5-flash (what this was built
  // and tested against, see the model-choice comment above) never required
  // this, so the round-trip code below never captured it.
  thoughtSignature?: string;
}

type SseUsage = { promptTokenCount?: number; candidatesTokenCount?: number };
/** Đọc một frame SSE của Gemini (đã chuẩn hoá LF) → phần chữ + usage. Frame hỏng thì bỏ qua, không giết stream. */
export function parseSseFrame(frame: string): { text: string; usage: SseUsage | null } {
  let text = "";
  let usage: SseUsage | null = null;
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: SseUsage;
      };
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      text += chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch {
      // A malformed frame must not kill an otherwise healthy stream.
    }
  }
  return { text, usage };
}

export async function streamGeminiChat(
  turns: ChatTurn[],
  opts: { systemInstruction?: string; config?: GeminiConfig; apiKey?: string; contents?: GeminiContent[] } = {},
): Promise<ReadableStream<Uint8Array>> {
  const key = opts.apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const config = opts.config ?? {};
  const generationConfig: Record<string, unknown> = {
    temperature: config.temperature ?? 0.7,
    maxOutputTokens: config.maxOutputTokens ?? 2048,
    thinkingConfig: { thinkingBudget: config.thinkingBudget ?? 0 },
  };

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // `contents` cho phép người gọi đưa vào lịch sử đã có sẵn phần
      // functionCall/functionResponse (vòng gọi hàm ở app/api/ai/chat).
      contents: opts.contents ?? turns.map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
      ...(opts.systemInstruction
        ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
        : {}),
      generationConfig,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED") || detail.includes("quota")) {
      throw new Error("RATE_LIMITED: Gemini đang quá tải hoặc hết quota, thử lại sau.");
    }
    throw new Error(`Gemini stream failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }

  const upstream = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  // Gemini gửi usageMetadata TÍCH LŨY trong (thường là) chunk cuối cùng của
  // stream — ghi đè mỗi lần gặp nên biến này luôn giữ bản mới nhất, và chỉ
  // thật sự lưu xuống đĩa khi stream đóng bình thường (done), không phải
  // mỗi chunk. Bị huỷ giữa chừng (cancel()) thì bỏ qua — không đoán số.
  let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await upstream.read();
      if (done) {
        // Frame cuối có thể không kèm dòng trống kết thúc — vẫn phải phát ra.
        const tail = parseSseFrame(buffer)
        if (tail.usage) usage = tail.usage
        if (tail.text) controller.enqueue(encoder.encode(tail.text))
        buffer = ""
        if (usage) void recordGeminiUsage(usage.promptTokenCount, usage.candidatesTokenCount);
        controller.close();
        return;
      }

      // Gemini (từ ~09/2026) ngắt dòng SSE bằng CRLF — tách theo "\n\n" thuần thì không frame nào khớp và
      // TOÀN BỘ câu trả lời bị bỏ khi stream đóng (AdsBot trả rỗng). Chuẩn hoá về LF trước khi tách.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n?/g, "\n");

      // SSE frames are separated by a blank line; keep any partial tail.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const f = parseSseFrame(frame);
        if (f.usage) usage = f.usage;
        if (f.text) controller.enqueue(encoder.encode(f.text));
      }
    },
    cancel() {
      void upstream.cancel();
    },
  });
}

// ============================================================
// Vòng gọi hàm (function calling) — bản KHÔNG stream
//
// Function calling cần đi hai chiều: model phát `functionCall` → server chạy
// hàm → gửi lại `functionResponse` → model đọc rồi mới trả lời. Một stream một
// chiều không làm được điều đó, nên vòng này chạy trên `:generateContent`, và
// chỉ câu trả lời CUỐI mới được stream (xem app/api/ai/chat). Nhờ vậy client
// vẫn nhận text chảy dần như cũ, không phải đổi giao thức.
//
// thinkingBudget mặc định 0 vì cùng lý do đã ghi ở streamGeminiChat.
// ============================================================

export interface GenerateWithToolsResult {
  text: string;
  functionCalls: GeminiFunctionCall[];
}

export async function generateWithTools(
  contents: GeminiContent[],
  functionDeclarations: Array<Record<string, unknown>>,
  opts: { systemInstruction?: string; config?: GeminiConfig; apiKey?: string } = {},
): Promise<GenerateWithToolsResult> {
  const key = opts.apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const config = opts.config ?? {};
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      tools: [{ functionDeclarations }],
      ...(opts.systemInstruction
        ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
        : {}),
      generationConfig: {
        temperature: config.temperature ?? 0.3,
        maxOutputTokens: config.maxOutputTokens ?? 1500,
        thinkingConfig: { thinkingBudget: config.thinkingBudget ?? 0 },
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 25000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("RATE_LIMITED: Gemini đang quá tải hoặc hết quota, thử lại sau.");
    }
    throw new Error(`Gemini tool call failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
          thoughtSignature?: string;
        }>;
      };
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  void recordGeminiUsage(json.usageMetadata?.promptTokenCount, json.usageMetadata?.candidatesTokenCount);

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const functionCalls: GeminiFunctionCall[] = [];
  let text = "";
  for (const part of parts) {
    if (part.functionCall?.name) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        thoughtSignature: part.thoughtSignature,
      });
    } else if (part.text) {
      text += part.text;
    }
  }
  return { text, functionCalls };
}
