// ─────────────────────────────────────────────
// PMax — luật tính mức ngân sách đề xuất.
//
// Vì sao là hàm thuần chứ không để AI chọn số: đây là TIỀN THẬT trên tài khoản
// thật. Một con số do LLM sinh ra thì không tra ngược được vì sao, và cùng một
// dữ liệu có thể ra hai số khác nhau ở hai lần chạy. Prompt của advisor cũng đã
// cấm AI ước tính số — mở ngoại lệ ở đây là tự phá guardrail của chính mình.
//
// Vậy: luật tính số, AI diễn giải số, người xác nhận rồi mới ghi. Tắt Gemini thì
// nút Áp dụng vẫn chạy đúng vì con số không phụ thuộc AI.
//
// Các bậc lấy tinh thần từ app/api/automation/google/budget-optimizer đã chạy
// production (1.2x/1.3x cho campaign thắng, bỏ qua thay đổi vụn dưới 50k) —
// không phát minh thang điểm thứ hai cho cùng một loại quyết định.
// ─────────────────────────────────────────────

/** Trần mỗi lần bấm. Muốn tăng nữa thì lần sau, sau khi đã đo. */
export const MAX_STEP_PCT = 20;
/** Ngưỡng tuyệt đối của route ghi ngân sách hiện có. */
export const MAX_DAILY_BUDGET_VND = 1_000_000_000;
/** Thay đổi nhỏ hơn mức này không đáng một lần ghi lên tài khoản.
 *
 *  Ban đầu để 50.000đ, mượn từ budget-optimizer — nhưng chỗ đó xử lý campaign
 *  Search có ngân sách lớn hơn hẳn. Số thật trên PMax cho thấy con số đó sai:
 *  campaign Google Workspace (ROAS 9,83x, Performance 68, Confidence 100 — rất
 *  tốt) có ngân sách 400.000đ/ngày, bậc 10% ra 40.000đ và BỊ CHẶN. Tức là một
 *  ngưỡng tuyệt đối 50.000đ buộc ngân sách 400k phải tăng trên 12,5% mới qua —
 *  mâu thuẫn với chính bậc thận trọng 10% của luật này.
 *
 *  Phần "đáng hay không đáng" đã do bậc % lo (luôn ≥10%). Ngưỡng tuyệt đối chỉ
 *  còn nhiệm vụ chặn thay đổi vụn thật sự, nên hạ về 10.000đ — đúng đơn vị tối
 *  thiểu mà route ghi ngân sách đang chấp nhận. */
export const MIN_MEANINGFUL_DELTA_VND = 10_000;
/** Dưới mức này thì chưa đủ tin để đẩy tiền. */
export const MIN_CONFIDENCE = 70;
/** Số ngày tối thiểu để một quyết định ngân sách có cơ sở.
 *
 *  Trùng với hệ số cửa sổ trong computeConfidenceScore: confidence =
 *  volumeScore × min(ngày/14, 1). Nghĩa là chọn khoảng 8 ngày thì confidence
 *  bị chặn trần ở 57 — KHÔNG BAO GIỜ chạm nổi 70, dù campaign có 200
 *  conversion. Người dùng gặp đúng bẫy này: đổi sang khoảng 8 ngày là nút Áp
 *  dụng biến mất ở mọi thẻ, kèm dòng "chưa đủ dữ liệu" nghe như lỗi tài khoản
 *  trong khi thật ra là do khoảng ngày họ chọn. Nên phải phân biệt được hai
 *  nguyên nhân và nói đúng cái nào. */
export const MIN_WINDOW_DAYS = 14;

export interface BudgetRuleInput {
  /** Nhãn do luật chấm: chỉ "expand" mới được đề xuất tăng. */
  recommendationStatus: string;
  confidence: number;
  /** ROAS của campaign trong kỳ. */
  roasTotal: number;
  /** ROAS trung bình toàn tài khoản cùng kỳ — mốc so sánh. */
  avgRoasTotal: number;
  /** % thay đổi doanh thu/ngày giữa nửa sau và nửa đầu kỳ. */
  trendPct: number;
  /** Xu hướng không đủ cơ sở (kỳ trước gần như chưa có doanh thu). */
  trendLowBaseline: boolean;
  dailyBudgetVnd: number | null;
  /** Số ngày của khoảng đang xem — để tách "khoảng quá ngắn" khỏi "ít dữ liệu". */
  totalDays?: number;
}

export interface BudgetProposal {
  currentVnd: number;
  proposedVnd: number;
  deltaPct: number;
  /** Căn cứ do LUẬT sinh, không phải AI viết. */
  basis: string[];
}

export interface BudgetRuleResult {
  eligible: boolean;
  proposal: BudgetProposal | null;
  /** Vì sao không đề xuất — để UI nói lý do thay vì hiện nút bấm không được. */
  reason: string | null;
}

const fmt = (n: number) => n.toLocaleString("vi-VN");

export function computeBudgetProposal(input: BudgetRuleInput): BudgetRuleResult {
  const { recommendationStatus, confidence, roasTotal, avgRoasTotal, trendPct, trendLowBaseline, dailyBudgetVnd } = input;

  if (recommendationStatus !== "expand") {
    return { eligible: false, proposal: null, reason: "Chỉ đề xuất tăng ngân sách cho campaign đang ở trạng thái mở rộng được" };
  }
  if (confidence < MIN_CONFIDENCE) {
    const days = input.totalDays;
    if (days !== undefined && days < MIN_WINDOW_DAYS) {
      // Tách bạch: khoảng ngày ngắn làm confidence bị chặn trần, chứ chưa chắc
      // tài khoản thiếu dữ liệu. Nói thẳng việc cần làm thay vì đổ cho dữ liệu.
      const ceiling = Math.round(100 * (days / MIN_WINDOW_DAYS));
      return {
        eligible: false,
        proposal: null,
        reason: `Khoảng đang xem chỉ ${days} ngày nên độ tin cậy bị chặn ở mức ${ceiling} — chọn khoảng từ ${MIN_WINDOW_DAYS} ngày trở lên để quyết ngân sách có cơ sở`,
      };
    }
    return { eligible: false, proposal: null, reason: `Độ tin cậy ${confidence} < ${MIN_CONFIDENCE} — chưa đủ conversion/click để đẩy ngân sách` };
  }
  if (dailyBudgetVnd === null || dailyBudgetVnd <= 0) {
    return { eligible: false, proposal: null, reason: "Chưa đọc được ngân sách hiện tại của campaign" };
  }
  if (dailyBudgetVnd >= MAX_DAILY_BUDGET_VND) {
    return { eligible: false, proposal: null, reason: "Ngân sách đã ở mức trần cho phép" };
  }

  const basis: string[] = [];

  // Bậc tăng theo hiệu quả so với mặt bằng tài khoản.
  let stepPct: number;
  const ratio = avgRoasTotal > 0 ? roasTotal / avgRoasTotal : 0;
  if (avgRoasTotal <= 0) {
    stepPct = 10;
    basis.push("Chưa có ROAS trung bình tài khoản để so sánh — dùng bậc thận trọng nhất");
  } else if (ratio >= 2) {
    stepPct = 20;
    basis.push(`ROAS ${roasTotal.toFixed(2)}x, gấp ${ratio.toFixed(1)} lần trung bình tài khoản (${avgRoasTotal.toFixed(2)}x)`);
  } else if (ratio >= 1.2) {
    stepPct = 15;
    basis.push(`ROAS ${roasTotal.toFixed(2)}x, cao hơn trung bình tài khoản (${avgRoasTotal.toFixed(2)}x)`);
  } else {
    stepPct = 10;
    basis.push(`ROAS ${roasTotal.toFixed(2)}x, quanh mức trung bình tài khoản (${avgRoasTotal.toFixed(2)}x)`);
  }

  // Đang đi xuống thì không đẩy mạnh — hạ một bậc.
  if (!trendLowBaseline && trendPct < 0) {
    const before = stepPct;
    stepPct = stepPct === 20 ? 15 : 10;
    basis.push(`Doanh thu/ngày đang giảm ${Math.abs(trendPct).toFixed(0)}% — hạ mức tăng từ ${before}% xuống ${stepPct}%`);
  } else if (trendLowBaseline) {
    basis.push("Kỳ trước gần như chưa có doanh thu nên không tính vào xu hướng");
  } else if (trendPct > 0) {
    basis.push(`Doanh thu/ngày đang tăng ${trendPct.toFixed(0)}%`);
  }

  stepPct = Math.min(stepPct, MAX_STEP_PCT);

  let proposedVnd = Math.round(dailyBudgetVnd * (1 + stepPct / 100));
  if (proposedVnd > MAX_DAILY_BUDGET_VND) {
    proposedVnd = MAX_DAILY_BUDGET_VND;
    basis.push(`Chạm trần ₫${fmt(MAX_DAILY_BUDGET_VND)}/ngày`);
  }

  const delta = proposedVnd - dailyBudgetVnd;
  if (delta < MIN_MEANINGFUL_DELTA_VND) {
    return {
      eligible: false,
      proposal: null,
      reason: `Mức tăng chỉ ₫${fmt(delta)} — nhỏ hơn ₫${fmt(MIN_MEANINGFUL_DELTA_VND)}, chưa đáng một lần đổi`,
    };
  }

  return {
    eligible: true,
    reason: null,
    proposal: {
      currentVnd: dailyBudgetVnd,
      proposedVnd,
      // Tính lại từ con số cuối cùng: khi bị kẹp trần thì % thực tế khác bậc ban đầu.
      deltaPct: Math.round((delta / dailyBudgetVnd) * 1000) / 10,
      basis,
    },
  };
}
