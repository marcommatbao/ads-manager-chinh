// ============================================================
// Đọc lỗi của Google Ads API ra thành câu người hiểu
// ------------------------------------------------------------
// Thư viện `google-ads-api` KHÔNG ném `Error` khi Google từ chối một mutation —
// nó ném một object `GoogleAdsFailure` dạng:
//
//   { errors: [ { error_code: { campaign_error: "DUPLICATE_CAMPAIGN_NAME" },
//                 message: "...", trigger: {...},
//                 location: { field_path_elements: [{ field_name: "..." }] } } ],
//     request_id: "..." }
//
// Nên mọi chỗ viết `err instanceof Error ? err.message : String(err)` đều biến
// nguyên nhân thật thành đúng bảy ký tự vô nghĩa: **[object Object]**. Đó chính
// là thứ phép thử rollback trả về ở lượt chạy đầu — lỗi thật của Google bị nuốt
// sạch, không ai biết vì sao tạo campaign hỏng.
//
// Module này bóc lấy: mã lỗi (đủ để tra tài liệu Google), câu message, và
// trường nào gây lỗi.
// ============================================================

import { friendlyError } from "@/lib/not-configured";

export interface GoogleAdsErrorDetail {
  /** Ví dụ "campaign_error: DUPLICATE_CAMPAIGN_NAME" — tra được thẳng trên tài liệu Google. */
  code: string;
  message: string;
  /** Đường dẫn tới trường sai, ví dụ "operations[1].create.maximize_conversions". */
  field: string;
}

/** Một chủ đề chính sách Google gắn cho quảng cáo, kèm đúng chữ gây ra nó. */
export interface PolicyTopicHit {
  /** Mã chủ đề của Google, ví dụ "WEAPONS", "HEALTHCARE_AND_MEDICINES". */
  topic: string;
  /** PROHIBITED = cấm hẳn, không xin miễn trừ được. LIMITED = hạn chế vùng/điều kiện. */
  type: string;
  /** Đúng những chuỗi trong quảng cáo bị gắn cờ — thứ người dùng cần sửa. */
  texts: string[];
  /** URL bị gắn cờ (khi lỗi nằm ở trang đích chứ không ở chữ). */
  websites: string[];
  /** Trang đích không mở được: mã HTTP / lỗi DNS. */
  destination?: { url?: string; httpErrorCode?: string; dnsError?: string };
  /** Có xin miễn trừ được không. PROHIBITED thì luôn `false`. */
  exemptible: boolean;
}

export interface GoogleAdsErrorInfo {
  /** Câu gọn để hiện lên UI / ghi log. Không bao giờ là "[object Object]". */
  message: string;
  details: GoogleAdsErrorDetail[];
  requestId?: string;
  /** Chủ đề chính sách Google gắn cờ — rỗng khi lỗi không liên quan chính sách. */
  policyTopics: PolicyTopicHit[];
}

/** PROHIBITED = 2 · LIMITED = 4 · FULLY_LIMITED = 8 · DESCRIPTIVE = 5 ·
 *  BROADENING = 6 · AREA_OF_INTEREST_ONLY = 7.
 *  Đọc từ bản đồ trường của chính thư viện google-ads-api (protos/autogen/fields.js),
 *  không đoán: API trả về SỐ, không trả tên. */
const POLICY_TYPE: Record<string, string> = {
  "0": "UNSPECIFIED", "1": "UNKNOWN", "2": "PROHIBITED", "4": "LIMITED",
  "5": "DESCRIPTIVE", "6": "BROADENING", "7": "AREA_OF_INTEREST_ONLY", "8": "FULLY_LIMITED",
};

/**
 * Bóc chủ đề chính sách + ĐÚNG CHỮ gây ra nó.
 *
 * VÌ SAO CẦN: khi Google từ chối quảng cáo vì chính sách, câu message chỉ nói
 * "the policy summary includes policy topics of type PROHIBITED" — không nói
 * chủ đề nào, càng không nói dòng tiêu đề nào phải sửa. Người dùng nhận được
 * một lời từ chối không hành động được gì.
 *
 * Chi tiết thật nằm ở `error.details.policy_finding_details.policy_topic_entries`,
 * cấu trúc xác minh từ bản đồ trường của thư viện:
 *   { topic, type, evidences: { text_list: { texts }, website_list: { websites },
 *     destination_not_working: { expanded_url, http_error_code, dns_error_type } } }
 * Trường `type` trả về SỐ (PROHIBITED = 2), nên phải tra bảng mới ra tên.
 *
 * Bóc phòng thủ ở mọi tầng: Google đổi hình dạng giữa các phiên bản API, và
 * mất chi tiết còn đỡ hơn ném lỗi ngay trong đường xử lý lỗi.
 */
function readPolicyTopics(rawList: unknown): PolicyTopicHit[] {
  const hits: PolicyTopicHit[] = [];
  if (!Array.isArray(rawList)) return hits;

  for (const e of rawList as Array<Record<string, unknown>>) {
    const det = (e?.details ?? {}) as Record<string, unknown>;

    // Dạng 1: policy_finding_details — nhiều chủ đề cùng lúc.
    const finding = (det.policy_finding_details ?? det.policyFindingDetails) as
      { policy_topic_entries?: unknown; policyTopicEntries?: unknown } | undefined;
    const entries = finding?.policy_topic_entries ?? finding?.policyTopicEntries;
    if (Array.isArray(entries)) {
      for (const en of entries as Array<Record<string, unknown>>) {
        const ev = (en?.evidences ?? {}) as Record<string, unknown>;
        // `evidences` có thể là object đơn hoặc mảng tuỳ phiên bản.
        const evList = Array.isArray(ev) ? (ev as Array<Record<string, unknown>>) : [ev];
        const texts: string[] = [];
        const websites: string[] = [];
        let destination: PolicyTopicHit["destination"];
        for (const one of evList) {
          const tl = (one?.text_list ?? one?.textList) as { texts?: unknown } | undefined;
          if (Array.isArray(tl?.texts)) texts.push(...(tl.texts as unknown[]).map(String));
          const wl = (one?.website_list ?? one?.websiteList) as { websites?: unknown } | undefined;
          if (Array.isArray(wl?.websites)) websites.push(...(wl.websites as unknown[]).map(String));
          const dn = (one?.destination_not_working ?? one?.destinationNotWorking) as Record<string, unknown> | undefined;
          if (dn) {
            destination = {
              url: dn.expanded_url ? String(dn.expanded_url) : undefined,
              httpErrorCode: dn.http_error_code != null ? String(dn.http_error_code) : undefined,
              dnsError: dn.dns_error_type != null ? String(dn.dns_error_type) : undefined,
            };
          }
        }
        const rawType = en?.type;
        hits.push({
          topic: String(en?.topic ?? "(không rõ chủ đề)"),
          type: POLICY_TYPE[String(rawType)] ?? String(rawType ?? ""),
          texts: [...new Set(texts)],
          websites: [...new Set(websites)],
          destination,
          exemptible: false, // policy_finding không đi kèm cờ này; PROHIBITED thì luôn không.
        });
      }
    }

    // Dạng 2: policy_violation_details — một vi phạm, có nói rõ có xin miễn trừ được không.
    const viol = (det.policy_violation_details ?? det.policyViolationDetails) as
      Record<string, unknown> | undefined;
    if (viol) {
      const key = (viol.key ?? {}) as Record<string, unknown>;
      hits.push({
        topic: String(viol.external_policy_name ?? key.policy_name ?? "(không rõ chủ đề)"),
        type: viol.is_exemptible ? "LIMITED" : "PROHIBITED",
        texts: key.violating_text ? [String(key.violating_text)] : [],
        websites: [],
        exemptible: Boolean(viol.is_exemptible),
      });
    }
  }
  return hits;
}

/** `error_code` là object chỉ có đúng một khoá được set — lấy khoá đó + giá trị. */
function readErrorCode(errorCode: unknown): string {
  if (!errorCode || typeof errorCode !== "object") return "";
  for (const [k, v] of Object.entries(errorCode as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== "" && v !== 0) return `${k}: ${String(v)}`;
  }
  return "";
}

function readFieldPath(location: unknown): string {
  if (!location || typeof location !== "object") return "";
  const el = (location as { field_path_elements?: Array<{ field_name?: string; index?: number }> })
    .field_path_elements;
  if (!Array.isArray(el)) return "";
  return el
    .map((e) => (e.index === undefined || e.index === null ? e.field_name : `${e.field_name}[${e.index}]`))
    .filter(Boolean)
    .join(".");
}

/**
 * Bóc lỗi Google Ads ở mọi hình dạng đã gặp: GoogleAdsFailure thô, Error có
 * kèm `errors`, lỗi gRPC, hoặc một Error thường.
 */
/** Đợt 22b: như describeGoogleAdsErrorRaw nhưng câu "chưa kết nối" đổi sang tiếng Việt dễ hiểu. */
export function describeGoogleAdsError(err: unknown): GoogleAdsErrorInfo {
  const raw = describeGoogleAdsErrorRaw(err);
  return { ...raw, message: friendlyError(raw.message) };
}

function describeGoogleAdsErrorRaw(err: unknown): GoogleAdsErrorInfo {
  const anyErr = err as {
    message?: string;
    errors?: unknown;
    failure?: { errors?: unknown };
    request_id?: string;
    requestId?: string;
    details?: unknown;
  } | null | undefined;

  const rawList =
    (Array.isArray(anyErr?.errors) && anyErr?.errors) ||
    (Array.isArray(anyErr?.failure?.errors) && anyErr?.failure?.errors) ||
    (Array.isArray(anyErr?.details) && anyErr?.details) ||
    null;

  const details: GoogleAdsErrorDetail[] = [];
  if (rawList) {
    for (const e of rawList as Array<Record<string, unknown>>) {
      if (!e || typeof e !== "object") continue;
      details.push({
        code: readErrorCode(e.error_code ?? e.errorCode),
        message: typeof e.message === "string" ? e.message : "",
        field: readFieldPath(e.location),
      });
    }
  }

  const requestId = anyErr?.request_id ?? anyErr?.requestId;
  const policyTopics = readPolicyTopics(rawList);

  if (details.length > 0) {
    const message = details
      .map((d) => [d.message || d.code, d.field ? `(trường: ${d.field})` : "", d.message && d.code ? `[${d.code}]` : ""]
        .filter(Boolean)
        .join(" "))
      .join(" · ");
    return { message, details, requestId, policyTopics };
  }

  if (err instanceof Error && err.message) return { message: err.message, details: [], requestId, policyTopics };
  if (typeof anyErr?.message === "string" && anyErr.message) {
    return { message: anyErr.message, details: [], requestId, policyTopics };
  }

  // Hết cách bóc thì in JSON — xấu nhưng vẫn còn đọc được, hơn hẳn "[object Object]".
  try {
    const json = JSON.stringify(err);
    return { message: json && json !== "{}" ? json.slice(0, 800) : "Lỗi không rõ từ Google Ads", details: [], requestId, policyTopics };
  } catch {
    return { message: "Lỗi không rõ từ Google Ads (không tuần tự hoá được)", details: [], requestId, policyTopics };
  }
}

/** Rút gọn cho chỗ chỉ cần một chuỗi. */
export function googleAdsErrorMessage(err: unknown): string {
  return friendlyError(describeGoogleAdsError(err).message); // Đợt 22b: "chưa kết nối" → câu tiếng Việt
}
