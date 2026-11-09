// ============================================================
// Đợt 26b — AI đánh giá bảng So sánh tệp đối tượng (CHỈ dựa trên số trong bảng)
// ============================================================
// Nguyên tắc (bài học "phỏng đoán có sẵn lọt vào bằng chứng cho AI"): lời nhắc chỉ chứa SỐ đo được + cờ do tool tự tính —
// không gài sẵn nhận định. Mỗi ý AI trả về phải dẫn số; tool soát lại từng con số AI viết ra, số nào không có trong bảng thì
// gắn cảnh báo cho người đọc. Meta KHÔNG cho biết sở thích nào ra đơn → cấm AI khẳng định điều đó.
import type { CompareGroup, RankedAdset } from "./audience-compare"
import { targetingSummary } from "./winning-audiences-text"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export interface AiPoint { text: string; evidence: string[] }
export interface AiAssessment { conclusion: string; why: AiPoint[]; actions: AiPoint[]; caveats: string[] }

const r0 = (n: number) => Math.round(n)
const pct1 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10)

function rowFacts(r: RankedAdset) {
  // Khoá tiếng Việt dễ đọc — AI hay chép NGUYÊN tên khoá vào dẫn chứng (dùng thật 06/10: "click_ra_ket_qua_phan_tram 15.7").
  return {
    "Nhóm": r.name, "Chiến dịch": r.campaignName, "Hạng": r.rank, "Sự kiện tối ưu": r.optEventLabel, "Trạng thái học": r.learning ?? "không rõ",
    "Chi phí (₫)": r0(r.spend), "Kết quả từ lượt bấm": r.results, "Meta báo tổng (gồm chỉ xem)": r.resultsAll ?? r.results, "Chỉ xem": r.resultsView ?? 0,
    "Chi phí mỗi kết quả (₫)": r.costPerResult === null ? null : r0(r.costPerResult),
    "Khoảng tin cậy chi phí mỗi kết quả (₫)": r.cprLow !== null && r.cprHigh !== null ? [r0(r.cprLow), r0(r.cprHigh)] : null,
    "CTR (%)": pct1(r.ctr), "Click → kết quả (%)": pct1(r.clickToResult), "Tần suất": r.frequency === null ? null : Math.round(r.frequency * 10) / 10,
    "Nhắm chọn": targetingSummary(r.targeting), "Cờ cảnh báo của tool": r.flags,
  }
}

export function buildAssessPrompt(groups: CompareGroup[], range: { from: string; to: string }, t: TFunction = makeT("vi")): string {
  const VERDICT_VI: Record<string, string> = { winner: "winner (có tệp thắng)", leaning: "đang nghiêng về (chưa chắc)", undecided: "chưa phân thắng thua", not_enough: "chưa phân thắng thua (chưa đủ số)" }
  const data = groups.map((g) => ({ "Loại kết quả": g.goalKind === "leads" ? "lead" : "lượt mua", "Kết luận của tool": VERDICT_VI[g.verdict] ?? g.verdict, "Tóm tắt của tool": g.summary, "Các nhóm": g.rows.map(rowFacts) }))
  return `Bạn là chuyên gia quảng cáo Meta đọc một BẢNG SO SÁNH NHÓM QUẢNG CÁO do công cụ đo (khoảng ${range.from} → ${range.to}).

LUẬT BẮT BUỘC:
1. CHỈ dùng số có trong DỮ LIỆU bên dưới. Không ước đoán số khác, không lấy số "trung bình ngành".
2. Mỗi ý trong "why" và "actions" phải có "evidence": vài cụm ngắn, viết như người đọc báo cáo, vd "₫81.738/lượt mua", "CTR 0,2%", "click → lượt mua 15,7%", "tần suất 3,8". KHÔNG chép tên khoá dữ liệu.
3. Kết quả đã tính theo LƯỢT BẤM 7 ngày ("Kết quả từ lượt bấm"); "Meta báo tổng" gồm cả người chỉ xem — chỉ dùng để nhắc độ vênh, KHÔNG dùng để xếp hạng.
4. Không được nói sở thích/hạng mục nào "ra đơn" — Meta không cung cấp số theo sở thích. Chỉ được so cấu hình nhắm chọn ("nham_chon") giữa nhóm tốt và nhóm kém như một giả thuyết, ghi rõ là giả thuyết.
5. Tôn trọng "Kết luận của tool" và "Cờ cảnh báo của tool". Kết luận của tool khác "winner" → câu kết luận phải nói rõ CHƯA chọn được tệp thắng chắc chắn, không dùng từ "vượt trội"/"chắc chắn", và KHÔNG đề xuất tăng ngân sách. Nhóm "đang học", "chưa đủ", "khác mẫu quảng cáo", "khác sự kiện tối ưu" thì nói rõ cần gì để chắc.
5b. Chỉ đề xuất DỪNG / GIẢM nhóm có cờ "Kém rõ rệt" hoặc cờ "mà 0 …". Nhóm chỉ có cờ "chưa xếp hạng" thì đề xuất "chạy thêm rồi so lại", không dừng.
6. Đọc chỉ số để giải thích: CTR thấp = thông điệp/mẫu chưa hợp tệp; click→kết quả thấp = tệp hoặc trang đích chưa hợp; tần suất > 3,5 = tệp bắt đầu cạn.
7. "actions": việc cụ thể (giữ / tăng ngân sách / giảm / dừng / lưu làm tệp thắng / chạy thêm N ngày rồi so lại), mỗi việc gắn tên nhóm. Tối đa 5 việc.
${t("libmeta.ai.langRule")}

DỮ LIỆU:
${JSON.stringify(data, null, 1)}

Trả về JSON đúng dạng:
{"conclusion": "1–2 câu", "why": [{"text": "...", "evidence": ["..."]}], "actions": [{"text": "...", "evidence": ["..."]}], "caveats": ["điều cần biết trước khi tin kết luận"]}`
}

/** Bóc số trong một câu tiếng Việt ("₫9.888", "79,2%", "1.957.882", "2.5") → số thực. */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  // Soát 07/10: hậu tố "k" / "tr" / "triệu" (AI hay viết "81k", "1,7tr", "21,5 triệu") quy ra đồng để so với bảng.
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(k\b|tr\b|triệu)?/gi)) {
    const raw = m[1]
    let n = /\d\.\d{3}(?:\.|,|$)/.test(raw) && !/^\d+\.\d{1,2}$/.test(raw) ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw.replace(",", "."))
    const suf = (m[2] ?? "").toLowerCase()
    if (suf === "k") n *= 1_000
    else if (suf === "tr" || suf === "triệu") n *= 1_000_000
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** Số mà AI viết ra nhưng KHÔNG có trong bảng (sai lệch ≤ 1% hoặc ≤ 0,15 coi là khớp). Bỏ qua số nhỏ ≤ 14 (ngày, số nhóm…). */
export function unsupportedNumbers(a: AiAssessment, groups: CompareGroup[]): number[] {
  const allowed: number[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      for (const v of [r0(r.spend), r.results, r.resultsAll ?? r.results, r.resultsView ?? 0, r.costPerResult === null ? null : r0(r.costPerResult), r.cprLow === null ? null : r0(r.cprLow), r.cprHigh === null ? null : r0(r.cprHigh), pct1(r.ctr), pct1(r.clickToResult), r.frequency === null ? null : Math.round(r.frequency * 10) / 10]) if (typeof v === "number") allowed.push(v)
      // Số nằm trong TÊN nhóm / chiến dịch ("22-48T", "28/8", "2026") và tóm tắt nhắm chọn ("21–65 tuổi") — dùng thật 06/10 báo nhầm.
      for (const t of [r.name, r.campaignName, targetingSummary(r.targeting), ...r.flags]) for (const n of numbersIn(t.replace(/[-–/]/g, " "))) allowed.push(n)
    }
    for (const n of numbersIn(g.summary)) allowed.push(n)
  }
  // Tỉ lệ chênh giữa các nhóm (AI hay nói "rẻ hơn 15%", "gấp 3 lần") — tính sẵn mọi cặp chi phí/kết quả.
  for (const g of groups) {
    const c = g.rows.map((r) => r.costPerResult).filter((x): x is number => !!x)
    for (const x of c) for (const y of c) if (x !== y) { allowed.push(Math.round((y / x - 1) * 100), Math.round((1 - x / y) * 100), Math.round((y / x) * 10) / 10) }
  }
  const text = [a.conclusion, ...a.why.flatMap((p) => [p.text, ...p.evidence]), ...a.actions.flatMap((p) => [p.text, ...p.evidence])].join(" \n ")
  const bad = new Set<number>()
  for (const n of numbersIn(text.replace(/(\d)[-–/](\d)/g, "$1 $2"))) {
    if (Math.abs(n) <= 14) continue
    const ok = allowed.some((v) => Math.abs(v - n) <= Math.max(0.15, Math.abs(v) * 0.01))
    if (!ok) bad.add(n)
  }
  return [...bad]
}

/** Đọc JSON AI trả về; thiếu trường → mặc định rỗng (không vỡ trang). */
export function parseAssessment(raw: string): AiAssessment | null {
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<AiAssessment>
    const pts = (x: unknown): AiPoint[] => (Array.isArray(x) ? x : []).filter((p) => p && typeof p.text === "string").map((p) => ({ text: String(p.text).slice(0, 600), evidence: (Array.isArray(p.evidence) ? p.evidence : []).map(String).slice(0, 6) })).slice(0, 6)
    if (typeof j.conclusion !== "string" || !j.conclusion.trim()) return null
    return { conclusion: j.conclusion.slice(0, 600), why: pts(j.why), actions: pts(j.actions).slice(0, 5), caveats: (Array.isArray(j.caveats) ? j.caveats : []).map(String).slice(0, 5) }
  } catch { return null }
}
