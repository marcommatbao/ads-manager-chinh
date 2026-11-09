// ============================================================
// Prompt + bộ đọc kết quả cho "Phân tích AI" của tab KPI Tổng Quan.
// ------------------------------------------------------------
// Tách khỏi route có chủ đích: prompt là thứ dễ sai nhất và cũng là thứ duy
// nhất ở đây không có kiểu dữ liệu nào bắt lỗi giúp. Nằm trong lib thì chạy
// thử được bằng một script thường (không cần dựng cả Next + đăng nhập), nên
// còn có đường kiểm bằng dữ liệu thật trước khi đẩy lên.
// ============================================================

import { MONTH_STATUS_LABEL, type KpiFacts, type KpiAiNarrative, type KpiAiRecommendation } from "@/lib/finance/kpi-analysis.shared";

// Kiểu kết quả AI nằm ở .shared.ts (trình duyệt cũng cần) — re-export để
// nơi gọi cũ không phải đổi đường import.
export type { KpiAiNarrative, KpiAiRecommendation } from "@/lib/finance/kpi-analysis.shared";

// ── Dựng bảng số cho AI đọc ───────────────────────────────────
// Đưa thẳng JSON facts thì tốn token và mô hình hay bỏ sót cờ `measured`.
// Viết thành bảng chữ, mỗi chỗ không đo được ghi hẳn "CHƯA ĐO ĐƯỢC" — để
// không còn đường nào hiểu nhầm một ô rỗng thành số 0 thật.

const money = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const cell = (m: { actual: number | null; target: number; pct: number | null; measured: boolean }, isMoney: boolean) => {
  const t = isMoney ? money(m.target) : String(m.target);
  if (!m.measured) return `KH ${t} / TT CHƯA ĐO ĐƯỢC`;
  const a = isMoney ? money(m.actual ?? 0) : String(m.actual ?? 0);
  return `KH ${t} / TT ${a}${m.pct !== null ? ` (${m.pct}%)` : " (chưa đặt KH)"}`;
};

export function factsToTable(f: KpiFacts): string {
  const L: string[] = [];
  L.push(`NĂM: ${f.year}`);
  if (f.currentMonth) {
    L.push(`THÁNG ĐANG CHẠY: T${f.currentMonth} — đã trôi qua ${f.currentMonthProgressPct}% số ngày của tháng. Số liệu T${f.currentMonth} chỉ tính tới hôm nay, KHÔNG phải cả tháng.`);
  }
  L.push("");
  // Mỗi dòng tự khai nó cộng những tháng nào. Một dòng tiêu đề chung là không
  // đủ: Odoo chết thì doanh thu mất tháng đó nhưng chi phí vẫn còn đủ, hai tổng
  // có phạm vi khác nhau thật.
  const cov = (ms: number[]) => (ms.length ? `[gồm ${ms.map(m => `T${m}`).join(", ")}]` : "[không có tháng nào]");
  L.push("=== CỘNG DỒN TỪ ĐẦU NĂM (chỉ cộng tháng đo được) ===");
  L.push(`Doanh thu MBC: ${cell(f.ytd.revenueMbc, true)} ${cov(f.ytd.coverage.revenue)}`);
  L.push(`Đơn hàng MBI: ${cell(f.ytd.ordersMbi, false)} ${cov(f.ytd.coverage.orders)}`);
  L.push(`Chi QC MBC: ${cell(f.ytd.spendMbc, true)} ${cov(f.ytd.coverage.spendMbc)}`);
  L.push(`Chi QC MBI: ${cell(f.ytd.spendMbi, true)} ${cov(f.ytd.coverage.spendMbi)}`);
  L.push(`Tổng chi QC: ${cell(f.ytd.totalSpend, true)} ${cov(f.ytd.coverage.totalSpend)}`);
  L.push(`Tỉ lệ QC/DT (chỉ tính MBC: chi QC MBC / doanh thu MBC): KH ${f.ytd.ratioQcDt.target ?? "—"}% / TT ${f.ytd.ratioQcDt.actual ?? "—"}% ${cov(f.ytd.coverage.ratio)}`);
  L.push(`Ngân sách QC cả năm (cả 12 tháng) đã đặt: ${money(f.ytd.yearBudgetTotal)} — đã tiêu ${money(f.ytd.yearSpentSoFar)} ${cov(f.ytd.coverage.totalSpend)} — CÒN LẠI ${money(f.ytd.yearBudgetRemaining)}. Lưu ý: phần "đã tiêu" chỉ gồm các tháng đo được, nên số "còn lại" là mức TRẦN CÒN LẠI chứ không phải tiền thật chưa tiêu.`);
  L.push("");
  L.push("=== TỪNG THÁNG ===");
  for (const m of f.months) {
    if (m.status === "chua_toi") continue;
    L.push(`--- T${m.month} [${MONTH_STATUS_LABEL[m.status]}]${m.monthProgressPct !== null ? ` (mới trôi ${m.monthProgressPct}% số ngày)` : ""} ---`);
    L.push(`  Doanh thu MBC: ${cell(m.revenueMbc, true)}`);
    L.push(`  Đơn hàng MBI: ${cell(m.ordersMbi, false)}`);
    for (const side of [m.mbc, m.mbi]) {
      L.push(`  Chi QC ${side.company}: ${cell(side.spend, true)}${side.remaining !== null ? ` — còn lại ${money(side.remaining)}` : ""}${side.manual > 0 ? ` (trong đó ${money(side.manual)} do người nhập tay)` : ""}`);
      const chs = side.channels
        .filter(c => c.actual > 0 || (c.budget ?? 0) > 0 || !c.measured)
        .map(c => {
          if (!c.measured) return `${c.label}: CHƯA ĐO ĐƯỢC`;
          const b = c.budget === null ? "không đặt trần" : `trần ${money(c.budget)}`;
          return `${c.label}: ${money(c.actual)} / ${b}${c.usedPct !== null ? ` (${c.usedPct}%)` : ""}${c.manualEntry && c.actual > 0 ? " [nhập tay]" : ""}`;
        });
      if (chs.length) L.push(`    theo kênh → ${chs.join(" | ")}`);
    }
    L.push(`  Tỉ lệ QC/DT (chỉ tính MBC): KH ${m.ratioQcDt.target ?? "—"}% / TT ${m.ratioQcDt.actual ?? "—"}%`);
    if (m.flags.length) L.push(`  ĐIỂM BẤT THƯỜNG (hệ thống đã tự phát hiện): ${m.flags.join(" ")}`);
  }
  if (f.dataGaps.length) {
    L.push("");
    L.push("=== CHỖ HỤT NGUỒN SỐ LIỆU ===");
    for (const g of f.dataGaps) L.push(`  • ${g}`);
  }
  return L.join("\n");
}

export const PROMPT_RULES = `
Bạn là chuyên viên phân tích hiệu quả quảng cáo, đang báo cáo cho người điều hành công ty (không phải dân kỹ thuật).

LUẬT BẮT BUỘC:
1. CHỈ dùng những con số có trong BẢNG SỐ LIỆU bên dưới. Tuyệt đối không tự cộng trừ ra số mới, không ước lượng, không suy ra con số nào chưa có sẵn. Cần nói về một con số thì chép đúng con số đó.
2. Ô nào ghi "CHƯA ĐO ĐƯỢC" nghĩa là hệ thống chưa lấy được dữ liệu — KHÔNG phải bằng 0. Không được khen/chê dựa trên các ô này; chỉ được nhắc rằng cần khắc phục nguồn dữ liệu.
3. Tháng đang chạy mới có số tới hôm nay. Khi nhận xét tháng đó phải so theo nhịp (đã trôi bao nhiêu % số ngày so với đã tiêu bao nhiêu % ngân sách), không được kết luận "tiêu ít" hay "hụt doanh thu" chỉ vì con số nhỏ hơn cả tháng.
4. Viết tiếng Việt tự nhiên, gọn, đi thẳng vào việc. Không dùng từ kỹ thuật kiểu "API", "timeout", "payload".
5. Mỗi đề xuất phải gắn với một tháng / công ty / kênh CỤ THỂ có trong bảng, và nói rõ làm gì. Không khuyên chung chung kiểu "tối ưu chiến dịch".
6. Nếu số liệu không đủ để kết luận thì nói thẳng là chưa đủ cơ sở, không đoán bừa.

Trả về ĐÚNG JSON theo cấu trúc sau, không kèm chữ nào khác:
{
  "headline": "một câu tóm tắt tình hình cả năm tới thời điểm này",
  "status": "on_track" | "at_risk" | "off_track",
  "kpiAssessment": "2-4 câu: KPI doanh thu và đơn hàng đang đạt tới đâu",
  "budgetAssessment": "2-4 câu: chi phí quảng cáo đang dùng thế nào, còn bao nhiêu, kênh nào đáng lo",
  "monthNotes": [{ "month": 1, "note": "một câu về tháng đó" }],
  "recommendations": [{ "priority": "cao" | "trung bình" | "thấp", "title": "việc cần làm", "detail": "làm cụ thể thế nào", "expectedImpact": "kỳ vọng thu được gì" }],
  "watchOuts": ["điều cần theo dõi thêm"]
}
monthNotes chỉ gồm các tháng đã có số liệu. recommendations tối đa 6 mục, xếp việc gấp nhất lên đầu.
`.trim();

export function parseNarrative(raw: string): KpiAiNarrative {
  const d = JSON.parse(raw) as Record<string, unknown>;
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v.trim() : fb);
  const status = str(d.status);
  return {
    headline: str(d.headline, "(AI không trả về tóm tắt)"),
    status: status === "on_track" || status === "at_risk" || status === "off_track" ? status : "at_risk",
    kpiAssessment: str(d.kpiAssessment),
    budgetAssessment: str(d.budgetAssessment),
    monthNotes: Array.isArray(d.monthNotes)
      ? d.monthNotes
          .map(x => {
            const o = (x ?? {}) as Record<string, unknown>;
            return { month: Number(o.month), note: str(o.note) };
          })
          .filter(x => Number.isInteger(x.month) && x.month >= 1 && x.month <= 12 && x.note)
      : [],
    recommendations: Array.isArray(d.recommendations)
      ? d.recommendations
          .slice(0, 6)
          .map(x => {
            const o = (x ?? {}) as Record<string, unknown>;
            const p = str(o.priority);
            return {
              priority: p === "cao" || p === "thấp" ? p : "trung bình",
              title: str(o.title),
              detail: str(o.detail),
              expectedImpact: str(o.expectedImpact),
            } as KpiAiRecommendation;
          })
          .filter(x => x.title)
      : [],
    watchOuts: Array.isArray(d.watchOuts) ? d.watchOuts.map(x => str(x)).filter(Boolean).slice(0, 6) : [],
  };
}
