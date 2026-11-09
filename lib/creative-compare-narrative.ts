// ============================================================
// Diễn giải kết quả so sánh bằng AI — CÓ RÀNG BUỘC
// ============================================================
// AI ở đây KHÔNG được phép kết luận. Toàn bộ kết luận đã do luật cố định
// trong lib/creative-compare.ts rút ra từ số liệu thật; việc duy nhất của
// Gemini là gói mấy ý đó thành một đoạn dễ đọc.
//
// Vì sao phải siết chặt đến vậy: đây là lời khuyên tiêu tiền quảng cáo. Một
// câu văn trôi chảy nhưng kèm con số mô hình tự nghĩ ra thì còn tệ hơn không
// có đoạn văn nào — người đọc không có cách nào biết số đó ở đâu ra.
//
// Hai lớp chặn:
//   1. Lời nhắc nêu rõ chỉ được diễn đạt lại, cấm thêm số/kết luận mới.
//   2. checkNoInventedNumbers(): mọi cụm số trong bản AI viết phải xuất hiện
//      trong dữ liệu đưa vào. Lệch một số là VỨT cả đoạn, quay về bản luật.
//      Lớp 2 mới là lớp thật — lời nhắc chỉ là mong đợi, không phải bảo đảm.

import { callGemini } from "@/lib/gemini";
import { log } from "@/lib/logger";
import type { CompareResult } from "@/lib/creative-compare";
import { makeT, type TFunction } from "@/lib/i18n/translate";

/** Tách mọi cụm số trong một đoạn văn, bỏ dấu phân cách nghìn và ký hiệu đơn
 *  vị để "₫6.200" và "6200" được coi là cùng một số. */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d.,]*/g) ?? [];
  return matches
    .map((m) => m.replace(/[.,](?=\d{3}\b)/g, "").replace(/,/g, "."))
    .map((m) => m.replace(/\.$/, ""))
    .filter((m) => m.length > 0);
}

/** Trả về các con số CÓ trong bản AI viết nhưng KHÔNG có trong dữ liệu gốc. */
export function findInventedNumbers(source: string, generated: string): string[] {
  const allowed = new Set(extractNumbers(source));
  // Số nhỏ (0-31) hay xuất hiện tự nhiên trong câu chữ ("3 giây đầu", "2 video")
  // nên không tính là bịa — chúng không phải số liệu hiệu quả.
  return extractNumbers(generated).filter((n) => {
    if (allowed.has(n)) return false;
    const asNum = Number(n);
    return !(Number.isFinite(asNum) && asNum <= 31 && Number.isInteger(asNum));
  });
}

export interface NarrativeResult {
  text: string | null;
  /** "ai" = Gemini viết và qua được kiểm tra; "rules" = dùng bản luật vì AI
   *  hỏng hoặc bịa số; "off" = chưa cấu hình Gemini. */
  source: "ai" | "rules" | "off";
  note?: string;
}

function factsFrom(result: CompareResult): string {
  const lines: string[] = [];
  lines.push(`Bên A: "${result.a.adName}" — đã tiêu ${Math.round(result.a.metrics.spend)}đ, ${result.a.metrics.impressions} lượt hiển thị, ${result.a.metrics.conversions} kết quả.`);
  lines.push(`Bên B: "${result.b.adName}" — đã tiêu ${Math.round(result.b.metrics.spend)}đ, ${result.b.metrics.impressions} lượt hiển thị, ${result.b.metrics.conversions} kết quả.`);
  lines.push(`Kết luận đã chốt: ${result.summary}`);
  for (const v of result.verdicts) {
    const who = v.winner === "a" ? "A hơn" : v.winner === "b" ? "B hơn" : v.winner === "tie" ? "ngang nhau" : "chưa kết luận được";
    lines.push(`- ${v.label}: A=${v.aValue ?? "—"} B=${v.bValue ?? "—"} → ${who}${v.confidence !== null ? ` (tin cậy ${v.confidence}%)` : ""}`);
  }
  for (const c of result.comparability) lines.push(`- Mức độ so sánh được — ${c.label}: ${c.detail}`);
  for (const r of result.recommendations) lines.push(`- Việc nên làm: ${r.title}. Căn cứ: ${r.evidence} Hành động: ${r.action}`);
  return lines.join("\n");
}

export async function buildNarrative(result: CompareResult, t: TFunction = makeT("vi")): Promise<NarrativeResult> {
  if (!process.env.GEMINI_API_KEY) return { text: null, source: "off" };

  const facts = factsFrom(result);
  const prompt = `Bạn là trợ lý viết lại nội dung. Dưới đây là kết quả so sánh hai quảng cáo, đã được phân tích xong bằng công thức thống kê.

${t("libmeta.cn.langTask")}

CẤM TUYỆT ĐỐI:
- Không thêm bất kỳ con số nào không có trong dữ liệu dưới đây.
- Không đưa ra kết luận mới, không suy đoán nguyên nhân nào chưa được nêu.
- Không tuyên bố bên nào thắng nếu dữ liệu ghi "chưa kết luận được".
- Không thêm lời khuyên nào ngoài phần "Việc nên làm".

Viết theo thứ tự: hiện trạng → điều đáng chú ý nhất → việc nên làm trước tiên. Chỉ trả về đoạn văn, không tiêu đề, không gạch đầu dòng.

DỮ LIỆU:
${facts}`;

  try {
    const res = await callGemini(prompt, { temperature: 0.3, maxOutputTokens: 500, thinkingBudget: 0, timeoutMs: 20000 });
    const text = res.text?.trim();
    if (!text) return { text: null, source: "rules", note: t("libmeta.cn.empty") };

    const invented = findInventedNumbers(facts, text);
    if (invented.length > 0) {
      log.warn("compare_narrative", `Bỏ đoạn AI viết vì có số không có trong dữ liệu: ${invented.join(", ")}`);
      return {
        text: null,
        source: "rules",
        note: t("libmeta.cn.invented", { list: invented.slice(0, 5).join(", ") }),
      };
    }
    return { text, source: "ai" };
  } catch (err) {
    log.warn("compare_narrative", `Gemini hỏng: ${err instanceof Error ? err.message : String(err)}`);
    return { text: null, source: "rules", note: t("libmeta.cn.failed") };
  }
}
