// ============================================================
// Chính sách quảng cáo Google — đọc trạng thái THẬT + soi trước nội dung
// ------------------------------------------------------------
// Hai lớp, và phải phân biệt rõ vì chúng trả lời hai câu khác nhau:
//
//   1. SOI TRƯỚC (checkAdTextPolicy) — luật BIÊN TẬP của Google mà máy kiểm
//      được: viết hoa quá tay, dấu câu lặp, số điện thoại trong nội dung, lời
//      hứa tuyệt đối. Chạy offline, không gọi API, không tốn gì. Đây là PHỎNG
//      ĐOÁN, không phải phán quyết.
//
//   2. ĐỌC PHÁN QUYẾT THẬT (GAQL policy_summary) — Google duyệt BẤT ĐỒNG BỘ.
//      Ngay sau khi tạo, trạng thái luôn là "đang duyệt"; kết quả thật chỉ có
//      sau vài phút tới vài giờ. Đây mới là câu trả lời có thẩm quyền.
//
// Trộn hai lớp làm một là nói dối: soi trước sạch KHÔNG có nghĩa Google sẽ
// duyệt, và Google từ chối cũng không có nghĩa soi trước sai.
// ============================================================

/** https://developers.google.com/google-ads/api/reference/rpc/v23/PolicyApprovalStatusEnum */
const APPROVAL_STATUS: Record<string, string> = {
  "0": "UNSPECIFIED", "1": "UNKNOWN", "2": "DISAPPROVED",
  "3": "APPROVED_LIMITED", "4": "APPROVED", "5": "AREA_OF_INTEREST_ONLY",
};

/** https://developers.google.com/google-ads/api/reference/rpc/v23/PolicyReviewStatusEnum */
const REVIEW_STATUS: Record<string, string> = {
  "0": "UNSPECIFIED", "1": "UNKNOWN", "2": "REVIEW_IN_PROGRESS",
  "3": "REVIEWED", "4": "UNDER_APPEAL", "5": "ELIGIBLE_MAY_SERVE",
};

function resolve(map: Record<string, string>, v: unknown): string {
  if (v === null || v === undefined) return "UNKNOWN";
  const key = String(v);
  if (Object.values(map).includes(key)) return key;
  return map[key] ?? key;
}

export const resolveApprovalStatus = (v: unknown) => resolve(APPROVAL_STATUS, v);
export const resolveReviewStatus = (v: unknown) => resolve(REVIEW_STATUS, v);

/** Nói bằng tiếng Việt trạng thái đó NGHĨA LÀ GÌ với tiền của người dùng. */
export function describeApproval(approval: string, review: string): {
  level: "ok" | "warn" | "bad" | "pending";
  text: string;
} {
  if (review === "REVIEW_IN_PROGRESS" || review === "UNSPECIFIED") {
    return { level: "pending", text: "Google đang duyệt — chưa có phán quyết. Thường xong trong vài giờ, có khi tới 1 ngày làm việc." };
  }
  if (review === "UNDER_APPEAL") {
    return { level: "pending", text: "Đang khiếu nại — chờ Google xem lại." };
  }
  switch (approval) {
    case "APPROVED":
      return { level: "ok", text: "Được duyệt — chạy bình thường." };
    case "APPROVED_LIMITED":
      return { level: "warn", text: "Được duyệt nhưng BỊ GIỚI HẠN — vẫn chạy, nhưng không hiện ở một số vùng/ngữ cảnh. Xem lý do bên dưới; sửa được thì tiếp cận rộng hơn hẳn." };
    case "AREA_OF_INTEREST_ONLY":
      return { level: "warn", text: "Chỉ hiện cho người ở ngoài vùng nhắm mục tiêu nhưng quan tâm — coi như gần như không chạy ở VN." };
    case "DISAPPROVED":
      return { level: "bad", text: "BỊ TỪ CHỐI — không hiển thị cho ai cả. Sửa theo lý do bên dưới rồi gửi duyệt lại." };
    default:
      return { level: "pending", text: `Trạng thái không rõ (${approval}).` };
  }
}

// ── Soi trước nội dung ───────────────────────────────────────────────────────

export interface PolicyFinding {
  severity: "block" | "warn";
  rule: string;
  where: string;
  detail: string;
}

/** Từ ngữ hứa tuyệt đối — Google đòi có căn cứ kiểm chứng được trên trang đích. */
const ABSOLUTE_CLAIMS = [
  "số 1", "số một", "tốt nhất", "rẻ nhất", "nhanh nhất", "duy nhất",
  "hàng đầu", "đứng đầu", "vô địch", "không ai bằng", "tuyệt đối",
  "cam kết 100", "đảm bảo 100", "chắc chắn 100",
];

/** Ngành/nội dung Google quản chặt — không cấm, nhưng cần giấy phép hoặc chứng nhận. */
const RESTRICTED_HINTS = [
  "cá cược", "cờ bạc", "casino", "vay tiền", "vay nhanh", "tín dụng đen",
  "thuốc", "chữa bệnh", "giảm cân", "tăng cân", "rượu", "bia", "thuốc lá",
  "vũ khí", "súng", "crack", "bẻ khoá", "hack",
];

/**
 * Soi nội dung quảng cáo theo các luật biên tập của Google mà máy kiểm được.
 *
 * CHỦ Ý chỉ bắt những gì đo được bằng quy tắc rõ ràng. Không đoán mò về "nội
 * dung có gây hiểu nhầm không" — đó là việc của người duyệt, đoán bừa chỉ tạo
 * cảnh báo giả rồi bị bỏ qua, và cảnh báo bị bỏ qua thì tệ hơn không có.
 */
export function checkAdTextPolicy(params: {
  headlines: string[];
  descriptions: string[];
  finalUrl?: string;
}): { findings: PolicyFinding[]; clean: boolean } {
  const findings: PolicyFinding[] = [];
  const add = (severity: PolicyFinding["severity"], rule: string, where: string, detail: string) =>
    findings.push({ severity, rule, where, detail });

  const items = [
    ...params.headlines.map((t, i) => ({ t, where: `Tiêu đề ${i + 1}` })),
    ...params.descriptions.map((t, i) => ({ t, where: `Mô tả ${i + 1}` })),
  ];

  for (const { t, where } of items) {
    const lower = t.toLowerCase();

    // Viết hoa quá tay: Google cấm VIẾT HOA TOÀN BỘ để gây chú ý.
    const letters = t.replace(/[^A-Za-zÀ-ỹ]/g, "");
    const upper = t.replace(/[^A-ZÀ-Ỵ]/g, "");
    if (letters.length >= 4 && upper.length / letters.length > 0.7) {
      add("block", "Viết hoa toàn bộ", where, `"${t}" — Google cấm viết hoa cả cụm để gây chú ý. Chỉ viết hoa chữ đầu hoặc tên riêng.`);
    }

    // Dấu câu lặp: "!!!" "???"
    if (/([!?])\1/.test(t)) {
      add("block", "Dấu câu lặp", where, `"${t}" — không được dùng !! hay ?? liên tiếp.`);
    }

    // Nhiều hơn một dấu chấm than trong một dòng.
    if ((t.match(/!/g) ?? []).length > 1) {
      add("warn", "Nhiều dấu chấm than", where, `"${t}" — mỗi dòng nên tối đa một dấu chấm than.`);
    }

    // Số điện thoại trong nội dung: phải dùng tiện ích cuộc gọi, không nhét vào chữ.
    if (/(?:\+?84|0)\d[\d\s.]{7,}\d/.test(t)) {
      add("block", "Số điện thoại trong nội dung", where, `"${t}" — Google cấm để số điện thoại trong tiêu đề/mô tả. Dùng tiện ích cuộc gọi.`);
    }

    // Lời hứa tuyệt đối.
    for (const c of ABSOLUTE_CLAIMS) {
      if (lower.includes(c)) {
        add("warn", "Khẳng định tuyệt đối", where, `"${t}" chứa "${c}" — Google đòi căn cứ kiểm chứng được NGAY TRÊN TRANG ĐÍCH. Không chứng minh được thì bỏ hoặc đổi thành so sánh có số liệu.`);
        break;
      }
    }

    // Ngành quản chặt.
    for (const r of RESTRICTED_HINTS) {
      if (lower.includes(r)) {
        add("warn", "Nội dung bị quản chặt", where, `"${t}" chứa "${r}" — thuộc nhóm Google quản chặt, có thể cần giấy phép hoặc bị hạn chế hiển thị.`);
        break;
      }
    }
  }

  // Trang đích: phải là HTTPS và không phải rút gọn.
  if (params.finalUrl) {
    if (!/^https:\/\//i.test(params.finalUrl)) {
      add("warn", "Trang đích không HTTPS", "URL trang đích", `${params.finalUrl} — Google ưu tiên HTTPS; HTTP dễ bị đánh dấu không an toàn.`);
    }
    if (/(bit\.ly|goo\.gl|tinyurl|t\.co|rebrand\.ly)/i.test(params.finalUrl)) {
      add("block", "Link rút gọn", "URL trang đích", `${params.finalUrl} — Google cấm link rút gọn ở trang đích.`);
    }
  }

  return { findings, clean: findings.length === 0 };
}
