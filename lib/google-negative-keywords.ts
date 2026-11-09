// ============================================================
// Từ khoá phủ định cho chiến dịch Google Search
// ------------------------------------------------------------
// LỖI ĐÃ SỬA: mọi chiến dịch Search tool tạo ra đều ra đời với ĐÚNG SỐ KHÔNG
// từ khoá phủ định.
//
//   · app/api/google/launch/search/route.ts:507 đọc `keywords.negativeKeywords`
//     và có vòng lặp thêm chúng vào campaign
//   · GoogleCreativePanel có khối hiển thị chúng
//   · nhưng schema yêu cầu Gemini trả về (generate-creative/route.ts) KHÔNG HỀ
//     có trường đó
//   · phần AI sinh từ phủ định ở bước audience-insight chỉ được nhét vào CÂU
//     LỆNH viết quảng cáo (dòng 83), rồi `saveCreative({ ...generated })` lưu
//     đúng thứ Gemini trả về — không có dòng nào ghép nó vào
//
// Hậu quả: với match type BROAD và PHRASE, tiền chảy vào "tuyển dụng hosting",
// "hosting miễn phí", "crack"… mà không có gì chặn.
//
// Đây là loại lỗi không phép kiểm nào bắt được: không ai ném lỗi, campaign tạo
// thành công, Google nhận hết. Chỉ lộ khi đọc báo cáo cụm tìm kiếm vài tuần sau.
// ============================================================

/**
 * Bộ chặn mặc định cho ngành hosting / tên miền / dịch vụ số.
 *
 * Chia theo NHÓM LÝ DO chứ không phải một danh sách phẳng: người duyệt cần
 * hiểu vì sao một cụm bị chặn thì mới bỏ đúng cái cần bỏ. Vài nhóm KHÔNG phải
 * lúc nào cũng đúng — ví dụ "miễn phí" nên chặn khi bán trả phí, nhưng lại sai
 * nếu đang chạy khuyến mãi tặng gói dùng thử.
 */
export const NEGATIVE_GROUPS: Array<{
  key: string;
  label: string;
  why: string;
  /** `false` = nên cân nhắc, không bật sẵn. */
  defaultOn: boolean;
  terms: string[];
}> = [
  {
    key: "job",
    label: "Tìm việc / tuyển dụng",
    why: "Người tìm việc không mua dịch vụ. Đây là nhóm đốt ngân sách nhiều nhất trên từ khoá ngành kỹ thuật.",
    defaultOn: true,
    terms: ["tuyển dụng", "tuyen dung", "việc làm", "viec lam", "tuyển", "lương", "luong", "thực tập", "thuc tap", "cv", "tuyển nhân viên", "job", "hiring", "recruit", "internship", "salary"],
  },
  {
    key: "free",
    label: "Miễn phí / dùng thử",
    why: "Người tìm bản miễn phí hiếm khi chuyển thành khách trả tiền. BỎ NHÓM NÀY nếu đang chạy khuyến mãi tặng gói dùng thử.",
    defaultOn: true,
    terms: ["miễn phí", "mien phi", "free", "gratis", "0đ", "0 đồng", "không mất phí", "khong mat phi", "trial miễn phí", "dùng thử miễn phí"],
  },
  {
    key: "piracy",
    label: "Crack / lậu / chia sẻ",
    why: "Không bao giờ mua, và còn kéo chất lượng tài khoản xuống.",
    defaultOn: true,
    terms: ["crack", "cracked", "nulled", "lậu", "lau", "share", "chia sẻ tài khoản", "chia se tai khoan", "key free", "serial", "keygen", "patch", "bẻ khoá", "be khoa", "torrent"],
  },
  {
    key: "diy",
    label: "Tự làm / hướng dẫn",
    why: "Người tìm cách tự làm đang KHÔNG định thuê dịch vụ. Cẩn thận: vài cụm dạng này vẫn ra đơn nếu bạn bán cho dân kỹ thuật.",
    defaultOn: true,
    terms: ["cách tự", "cach tu", "tự làm", "tu lam", "hướng dẫn cài", "huong dan cai", "tutorial", "how to", "diy", "tự cài đặt", "tu cai dat", "tự setup"],
  },
  {
    key: "study",
    label: "Học tập / định nghĩa",
    why: "Tìm hiểu khái niệm, làm bài tập — chưa có nhu cầu mua.",
    defaultOn: true,
    terms: ["là gì", "la gi", "nghĩa là", "nghia la", "wikipedia", "định nghĩa", "dinh nghia", "bài tập", "bai tap", "luận văn", "luan van", "đồ án", "do an", "giáo trình", "giao trinh"],
  },
  {
    key: "complaint",
    label: "Khiếu nại / huỷ dịch vụ",
    why: "Đang muốn rời đi, không phải muốn mua.",
    defaultOn: true,
    terms: ["lừa đảo", "lua dao", "scam", "huỷ dịch vụ", "huy dich vu", "hoàn tiền", "hoan tien", "refund", "khiếu nại", "khieu nai", "tố cáo", "to cao", "kém", "tệ"],
  },
  {
    key: "career",
    label: "Nghề nghiệp / khoá học",
    why: "Học nghề, không mua dịch vụ.",
    defaultOn: false,
    terms: ["khóa học", "khoa hoc", "học nghề", "hoc nghe", "chứng chỉ", "chung chi", "đào tạo", "dao tao", "course"],
  },
];

/** Chuẩn hoá để so khớp: bỏ dấu, gộp khoảng trắng, hạ chữ thường. */
export function normalizeTerm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface NegativeKeyword {
  keyword: string;
  /** "default" (bộ ngành) · "ai" (AI sinh theo phân khúc) · "manual" (bạn tự thêm). */
  source: "default" | "ai" | "manual";
  /** Nhóm lý do — chỉ có với nguồn "default". */
  group?: string;
  matchType: "BROAD" | "PHRASE";
}

export interface NegativePlan {
  keywords: NegativeKeyword[];
  /** Từ phủ định bị BỎ vì nó sẽ chặn chính từ khoá của mình. */
  conflicts: Array<{ negative: string; blocks: string[] }>;
}

/**
 * Gộp các nguồn từ phủ định, khử trùng, và LOẠI những cụm sẽ tự chặn từ khoá
 * của chính mình.
 *
 * PHÉP CHẮN QUAN TRỌNG NHẤT ở đây là kiểm xung đột. Google áp từ phủ định
 * TRƯỚC khi khớp từ khoá: thêm phủ định "miễn phí" trong khi đang đấu từ khoá
 * "hosting miễn phí" sẽ giết chết đúng từ khoá đó — im lặng, không lỗi, không
 * cảnh báo. Người chạy quảng cáo chỉ thấy một từ khoá "không bao giờ chạy" mà
 * không hiểu vì sao.
 *
 * Prompt của bước audience-insight có DẶN AI đừng làm thế, nhưng dặn không
 * phải là chắn. Chắn phải nằm trong mã.
 */
export function planNegativeKeywords(opts: {
  /** Từ khoá DƯƠNG của campaign — dùng để dò xung đột. */
  positiveKeywords: string[];
  /** Từ phủ định AI sinh ở bước phân tích đối tượng. */
  aiNegatives?: string[];
  /** Người dùng tự thêm. */
  manualNegatives?: string[];
  /** Nhóm mặc định muốn bật; không truyền thì lấy các nhóm `defaultOn`. */
  enabledGroups?: string[];
}): NegativePlan {
  const positives = opts.positiveKeywords.map(normalizeTerm).filter(Boolean);
  const groups = opts.enabledGroups
    ?? NEGATIVE_GROUPS.filter((g) => g.defaultOn).map((g) => g.key);

  const candidates: NegativeKeyword[] = [];

  for (const g of NEGATIVE_GROUPS) {
    if (!groups.includes(g.key)) continue;
    for (const t of g.terms) candidates.push({ keyword: t, source: "default", group: g.key, matchType: "PHRASE" });
  }
  for (const t of opts.aiNegatives ?? []) {
    if (t) candidates.push({ keyword: String(t), source: "ai", matchType: "PHRASE" });
  }
  for (const t of opts.manualNegatives ?? []) {
    if (t) candidates.push({ keyword: String(t), source: "manual", matchType: "PHRASE" });
  }

  const seen = new Set<string>();
  const keywords: NegativeKeyword[] = [];
  const conflicts: NegativePlan["conflicts"] = [];

  // So theo TỪ, không theo chuỗi con.
  //
  // Bản đầu của hàm này dùng `includes()` trên chuỗi đã chuẩn hoá, và phép đo
  // lập tức bắt được lỗi: nó báo "tệ" xung đột với "đăng ký tên miền", vì
  // "ten" có chứa "te". Google khớp từ phủ định theo CHUỖI TỪ chứ không theo
  // chuỗi ký tự — "tên miền" không hề chứa từ "tệ". Giữ nguyên bản cũ sẽ âm
  // thầm vứt đi những từ phủ định hợp lệ.
  const positiveWords = positives.map((p) => p.split(" ").filter(Boolean));

  for (const cand of candidates) {
    const norm = normalizeTerm(cand.keyword);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const negWords = norm.split(" ").filter(Boolean);
    const blocks = opts.positiveKeywords.filter((_, i) => {
      const words = positiveWords[i];
      if (!words || negWords.length === 0 || words.length < negWords.length) return false;
      // Cụm phủ định phải xuất hiện LIỀN NHAU trong từ khoá dương.
      for (let start = 0; start + negWords.length <= words.length; start++) {
        let hit = true;
        for (let k = 0; k < negWords.length; k++) {
          if (words[start + k] !== negWords[k]) { hit = false; break; }
        }
        if (hit) return true;
      }
      return false;
    });

    if (blocks.length > 0) {
      conflicts.push({ negative: cand.keyword, blocks });
      continue;
    }
    keywords.push(cand);
  }

  return { keywords, conflicts };
}
