// ============================================================
// Gemini token usage — ghi lại THẬT mỗi lần gọi thành công, gộp theo ngày.
//
// Không đoán, không ước lượng: chỉ ghi đúng con số `usageMetadata` mà chính
// Gemini trả về trong response. Dựng ra vì trước đây KHÔNG có gì trong app
// đo lại đã dùng bao nhiêu token — hỏi "1 tháng tốn bao nhiêu" chỉ có thể
// trả lời bằng số bịa hoặc "không biết", cả hai đều không chấp nhận được
// cho một câu hỏi liên quan tới tiền.
//
// Cả 3 hàm gọi Gemini trong lib/gemini.ts (callGemini, generateWithTools,
// streamGeminiChat) đều gọi vào ĐÂY sau mỗi lần thành công — nên KHÔNG cần
// sửa 20 file đang gọi Gemini rải khắp app, chỉ cần đúng 1 chỗ trung tâm.
// ============================================================

import fs from "fs";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomic } from "@/lib/fs-atomic";

const USAGE_PATH = path.join(process.cwd(), "data", "gemini-usage.json");
// Hơn 1 năm — đủ để sau này so "tháng này" với "cùng kỳ năm trước".
const RETENTION_DAYS = 400;

export interface DayUsage {
  promptTokens: number;
  candidateTokens: number;
  calls: number;
}

interface UsageFile {
  updatedAt: string;
  /** Ngày đầu tiên cơ chế này bắt đầu ghi — UI dùng để nói rõ "trước ngày
   *  này không có số liệu", tránh hiểu nhầm "tháng trước dùng 0 token". */
  firstRecordedAt: string | null;
  days: Record<string, DayUsage>; // "2026-09-18" -> {...}
}

function readFile(): UsageFile {
  try {
    if (fs.existsSync(USAGE_PATH)) {
      return JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as UsageFile;
    }
  } catch { /* ignore — coi như chưa có gì */ }
  return { updatedAt: new Date().toISOString(), firstRecordedAt: null, days: {} };
}

function pruneDays(days: Record<string, DayUsage>): Record<string, DayUsage> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  const out: Record<string, DayUsage> = {};
  for (const [d, v] of Object.entries(days)) if (d >= cutoff) out[d] = v;
  return out;
}

/**
 * Gọi ngay sau mỗi lần Gemini trả lời thành công. Cố tình fire-and-forget
 * (không await ở nơi gọi) — đo chi phí là việc PHỤ, không được phép làm
 * chậm câu trả lời thật cho người dùng.
 *
 * Ghi đĩa lỗi (vd hết dung lượng) thì CHỈ mất đúng lượt đó — số hiển thị sẽ
 * THIẾU chứ không sai theo hướng nguy hiểm (không tự cộng khống). Không
 * dựng thêm lớp dự phòng bộ nhớ như lib/leads-notify.ts vì đây là số ước
 * tính chi phí, không phải cảnh báo lead/đơn hàng — mất một mẫu không gây
 * hậu quả vận hành.
 */
export async function recordGeminiUsage(
  promptTokens: number | undefined,
  candidateTokens: number | undefined,
): Promise<void> {
  if (!promptTokens && !candidateTokens) return; // không đo được gì thật — đừng ghi

  const today = new Date().toISOString().slice(0, 10);
  await withFileLock(USAGE_PATH, async () => {
    const file = readFile();
    const cur = file.days[today] ?? { promptTokens: 0, candidateTokens: 0, calls: 0 };
    file.days[today] = {
      promptTokens: cur.promptTokens + (promptTokens ?? 0),
      candidateTokens: cur.candidateTokens + (candidateTokens ?? 0),
      calls: cur.calls + 1,
    };
    file.days = pruneDays(file.days);
    if (!file.firstRecordedAt) file.firstRecordedAt = new Date().toISOString();
    file.updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true });
      await writeFileAtomic(USAGE_PATH, JSON.stringify(file, null, 2));
    } catch (err) {
      console.error(`[gemini-usage] Không ghi được ${USAGE_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

export interface UsageSummary {
  firstRecordedAt: string | null;
  /** YYYY-MM hiện tại. */
  month: string;
  monthPromptTokens: number;
  monthCandidateTokens: number;
  monthCalls: number;
  /** 30 ngày gần nhất — để vẽ xu hướng nếu cần, không bắt buộc dùng. */
  last30Days: Array<{ date: string } & DayUsage>;
}

export function getUsageSummary(): UsageSummary {
  const file = readFile();
  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7); // "2026-09"

  let monthPromptTokens = 0, monthCandidateTokens = 0, monthCalls = 0;
  for (const [date, d] of Object.entries(file.days)) {
    if (date.startsWith(monthPrefix)) {
      monthPromptTokens += d.promptTokens;
      monthCandidateTokens += d.candidateTokens;
      monthCalls += d.calls;
    }
  }

  const last30Days = Object.entries(file.days)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, d]) => ({ date, ...d }));

  return {
    firstRecordedAt: file.firstRecordedAt,
    month: monthPrefix,
    monthPromptTokens,
    monthCandidateTokens,
    monthCalls,
    last30Days,
  };
}
