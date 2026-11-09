// ============================================================
// A1 — Kiểm chứng grounding & truy vết căn cứ cho phân khúc đối tượng
// ------------------------------------------------------------
// Bản deploy 002c727 đã nối lib/products-knowledge.ts vào prompt. Nhưng "đã đưa
// KB vào prompt" KHÔNG đồng nghĩa "AI đã dùng KB" — đó là hai câu khác nhau, và
// cả buổi hôm nay cho thấy khoảng cách giữa hai câu như vậy đắt tới mức nào.
//
// Module này không sinh thêm nội dung. Nó chỉ làm một việc: ĐỐI CHIẾU những gì
// AI nói với những gì thật sự có trong KB và trong dữ liệu người dùng nhập, rồi
// dán nhãn từng căn cứ:
//
//   kb_grounded       — truy được về một câu chữ CÓ THẬT trong products-knowledge
//   manual_input      — truy được về thứ người dùng tự gõ trong wizard
//   derived_inference — AI tự suy, không sai nhưng KHÔNG có nguồn
//   unverified        — AI khai là có nguồn nhưng đối chiếu KHÔNG khớp
//
// Nhãn cuối cùng là quan trọng nhất: nó bắt được đúng kiểu "nghe có vẻ đúng
// nên tin" đã khiến "Bất động sản (ngành)" lọt qua.
//
// KHÔNG gọi Meta API. KHÔNG đụng luồng launch. Chỉ đọc và chấm.
// ============================================================

import { PRODUCTS_KB } from "@/lib/products-knowledge";

export type EvidenceSourceType =
  | "kb_grounded"
  | "manual_input"
  /** Đã chạy thật trên tài khoản VÀ rẻ hơn trung vị. Bằng chứng mạnh nhất. */
  | "performance_proven"
  /**
   * Đã chạy thật NHƯNG ĐẮT hơn trung vị.
   *
   * Vì sao phải là một nhãn RIÊNG: mẻ thật 25/08 gắn "đã đo được" cho
   * "Small business" (CPL 40k) và "Business software" (CPL 40k) — cả hai thuộc
   * nhóm ĐẮT NHẤT, trong khi nhóm rẻ (Web hosting 22k) nằm sẵn trong prompt mà
   * AI không chọn. Một cái nhãn chỉ nói "đã đo được" đọc thành LỜI KHEN, nên nó
   * đang xác nhận cho đúng thứ đáng lẽ phải cảnh báo. Bằng chứng phải mang theo
   * phán quyết, không chỉ mang theo sự tồn tại.
   */
  | "performance_expensive"
  | "derived_inference"
  | "unverified";

export interface SegmentEvidence {
  /** Câu khẳng định mà AI đưa ra (vd "khách sợ kỹ thuật"). */
  claim: string;
  sourceType: EvidenceSourceType;
  /** Câu chữ trong KB / input mà nó truy về. Rỗng khi không truy được. */
  matchedSource: string;
}

export interface SegmentGrounding {
  segmentName: string;
  evidence: SegmentEvidence[];
  /** Đếm nhanh để UI khỏi phải tự tính. */
  kbGroundedCount: number;
  warnings: string[];
}

export interface GroundingReport {
  productId: string;
  /** KB có tồn tại cho sản phẩm này không — không có thì mọi thứ chỉ là suy luận. */
  kbAvailable: boolean;
  segments: SegmentGrounding[];
  /** Cảnh báo ở mức toàn bộ kết quả, không thuộc riêng phân khúc nào. */
  globalWarnings: string[];
  /** true khi có ít nhất một cảnh báo — UI dùng để quyết có bật đèn vàng không. */
  hasWarnings: boolean;
}

// ── Chuẩn hoá & so khớp ─────────────────────────────────────

/**
 * Ép về chuỗi một cách an toàn.
 *
 * Đầu ra của LLM KHÔNG có hợp đồng kiểu: cùng một trường, lần này là chuỗi, lần
 * sau là object `{name}`/`{text}`, lần khác là mảng. Bản đầu của module này coi
 * mọi thứ là string và gọi thẳng .toLowerCase() — đúng một lần AI trả object là
 * cả phân tích đối tượng chết với "e.toLowerCase is not a function", trong khi
 * phần chấm điểm chỉ là thứ PHỤ, không được phép làm hỏng việc chính.
 */
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(" ");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Những khoá LLM hay dùng khi nó tự ý bọc giá trị vào object.
    for (const k of ["name", "text", "value", "label", "question", "claim", "interest"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    return "";
  }
  return "";
}

function normalize(v: unknown): string {
  return asText(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "va", "cua", "cho", "khi", "tren", "trong", "voi", "de", "la", "co", "khong",
  "nguoi", "khach", "hang", "doanh", "nghiep", "the", "and", "the", "for", "with",
]);

function contentTokens(v: unknown): string[] {
  return normalize(v).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Một câu được coi là truy về được nguồn khi ĐỦ tỉ lệ từ nội dung của nó xuất
 * hiện trong nguồn. Ngưỡng cố ý đặt vừa phải: mục tiêu là bắt câu bịa hẳn, không
 * phải bắt bẻ cách diễn đạt.
 */
function findSource(claim: unknown, sources: string[]): string | null {
  const tokens = contentTokens(claim);
  if (tokens.length === 0) return null;

  let best: { src: string; ratio: number } | null = null;
  for (const src of sources) {
    const normSrc = normalize(src);
    const hit = tokens.filter((t) => normSrc.includes(t)).length;
    const ratio = hit / tokens.length;
    if (!best || ratio > best.ratio) best = { src, ratio };
  }
  return best && best.ratio >= 0.5 ? best.src : null;
}

// ── Rút corpus từ KB ────────────────────────────────────────

interface KbEntry {
  name?: string;
  description?: string;
  uniqueSellingPoints?: string[];
  topOffers?: string[];
  realCustomerQuestions?: Array<{ question?: string; insight?: string; copyAngle?: string }>;
  competitors?: Array<{ name?: string; targetAudience?: string; weaknesses?: string[]; counterPosition?: string }>;
  competitiveWhitespace?: string;
  category?: string;
}

export function getKbEntry(productId: string): KbEntry | null {
  const kb = (PRODUCTS_KB as Record<string, unknown>)[productId] as KbEntry | undefined;
  return kb ?? null;
}

/** Mọi câu chữ trong KB, dùng làm nguồn đối chiếu. */
export function buildKbCorpus(kb: KbEntry | null): string[] {
  if (!kb) return [];
  const out: string[] = [];
  if (kb.name) out.push(kb.name);
  if (kb.description) out.push(kb.description);
  if (kb.category) out.push(kb.category);
  out.push(...(kb.uniqueSellingPoints ?? []));
  out.push(...(kb.topOffers ?? []));
  for (const q of kb.realCustomerQuestions ?? []) {
    if (q.question) out.push(q.question);
    if (q.insight) out.push(q.insight);
    if (q.copyAngle) out.push(q.copyAngle);
  }
  for (const c of kb.competitors ?? []) {
    if (c.name) out.push(c.name);
    if (c.targetAudience) out.push(`${c.name ?? ""} ${c.targetAudience}`);
    if (c.counterPosition) out.push(c.counterPosition);
    out.push(...(c.weaknesses ?? []));
  }
  if (kb.competitiveWhitespace) out.push(kb.competitiveWhitespace);
  return out.map(asText).filter(Boolean);
}

// ── Các mẫu sai đã gặp thật, kiểm bằng luật ─────────────────

/** Danh sách ví dụ minh hoạ trong prompt. Trả về nguyên xi = dấu hiệu CHÉP. */
const PROMPT_EXAMPLE_INTERESTS = [
  "web hosting", "domain name", "wordpress", "e-commerce", "small business",
  "web development", "digital marketing",
];

/** Thành phố lớn: loại khỏi phân khúc thì phải nói lý do. */
const MAJOR_CITIES = ["tp.hcm", "tphcm", "ho chi minh", "hồ chí minh", "hà nội", "ha noi"];

/** Kiểu LỎNG có chủ ý: đây là JSON do LLM sinh, không phải hợp đồng API. Ép
 *  kiểu chặt ở đây chỉ tạo cảm giác an toàn giả — thực tế vẫn phải asText(). */
interface RawSegment {
  segmentName?: unknown;
  whyThisSegment?: unknown;
  painPoints?: unknown[];
  demographics?: { location?: unknown[] };
  facebookTargeting?: { interests?: unknown[]; behaviors?: unknown[] };
  evidence?: Array<{ claim?: unknown; sourceType?: unknown; sourceRef?: unknown }>;
}

/**
 * Chấm một mẻ phân khúc.
 * @param manualInputs những gì người dùng tự gõ trong wizard (mô tả khách, đối thủ…)
 */
export function verifyGrounding(
  productId: string,
  segments: RawSegment[],
  manualInputs: string[] = [],
  /** Sở thích đã có số liệu THẬT trên tài khoản này, kèm CPL đo được. */
  provenInterests: Array<{ id: string; name: string; nameEn?: string | null; cpl: number; conversions: number }> = [],
  /** CPL trung vị của các sở thích đủ dữ liệu — mốc để nói rẻ hay đắt. */
  medianCpl: number | null = null,
  /**
   * Tên sở thích (AI đề xuất) → id Meta, lấy từ CACHE resolve của A2-lite.
   *
   * Đây là thứ gỡ được lệch ngôn ngữ mà không tốn một lượt gọi Meta nào: AI đề
   * xuất "Small business" (tiếng Anh), báo cáo hiệu quả lưu "Doanh nghiệp nhỏ"
   * (Meta trả về locale tiếng Việt) — so bằng tên thì trượt, so bằng id thì
   * khớp chính xác. Cache đã có sẵn cặp tên↔id từ những lần resolve trước.
   */
  interestIdByName: Map<string, string> = new Map(),
  /** Đợt 21 A3b: bản cài khách — nguồn nội bộ là HỒ SƠ DOANH NGHIỆP của công ty, KHÔNG tra kho kiến thức Mắt Bão
   *  (tránh sản phẩm khách tên "hosting" khớp nhầm kho của Mắt Bão). null = cách cũ. */
  ownCorpus: string[] | null = null,
): GroundingReport {
  const own = ownCorpus ? ownCorpus.map((x) => x.trim()).filter(Boolean) : null;
  const kb = own ? null : getKbEntry(productId);
  const kbCorpus = own ?? buildKbCorpus(kb);
  const hasSource = own ? own.length > 0 : !!kb;
  const manualCorpus = manualInputs.filter(Boolean);

  const globalWarnings: string[] = [];
  if (!hasSource) {
    globalWarnings.push(own
      ? "Hồ sơ doanh nghiệp chưa có mô tả sản phẩm / điểm mạnh / khách hàng mục tiêu — toàn bộ phân khúc dưới đây là suy luận của AI, không có nguồn nội bộ nào để đối chiếu. Bổ sung ở Cài đặt → Hồ sơ doanh nghiệp."
      : `Không có kiến thức sản phẩm cho "${productId}" trong products-knowledge — toàn bộ phân khúc dưới đây là suy luận của AI, không có nguồn nội bộ nào để đối chiếu.`,
    );
  }

  // Chép nguyên văn ví dụ — nhưng chỉ tính những cụm KHÔNG truy được về KB.
  //
  // Luật này đo trùng VĂN BẢN, không đo Ý ĐỊNH. Với sản phẩm tên miền thì
  // "Web hosting" / "Domain name" vừa nằm trong danh sách ví dụ của prompt vừa
  // là lựa chọn ĐÚNG — cấm chúng chỉ vì trùng ví dụ là phạt nhầm câu trả lời
  // tốt. Cách phân biệt: một cụm xuất hiện VÌ có căn cứ trong kho kiến thức thì
  // hợp lệ; xuất hiện mà không truy được về đâu, lại đúng bằng ví dụ trong
  // prompt, mới là dấu hiệu chép.
  const allInterests = segments
    .flatMap((s) => s.facebookTargeting?.interests ?? [])
    .map(asText)
    .filter(Boolean);
  const copiedUngrounded = allInterests.filter((it) => {
    if (!PROMPT_EXAMPLE_INTERESTS.includes(normalize(it))) return false;
    return !findSource(it, kbCorpus) && !findSource(it, manualCorpus);
  });
  if (
    allInterests.length > 0 &&
    copiedUngrounded.length >= Math.max(3, Math.ceil(allInterests.length * 0.6))
  ) {
    globalWarnings.push(
      `${copiedUngrounded.length}/${allInterests.length} sở thích trùng nguyên văn ví dụ trong prompt MÀ không truy được về kiến thức sản phẩm (${copiedUngrounded.join(", ")}) — nhiều khả năng AI đang CHÉP ví dụ thay vì suy từ KB.`,
    );
  }

  // AI không trả trường evidence nào cả.
  //
  // Đây là ca nguy nhất: giao diện sẽ trống trơn và đọc thành "không có cảnh
  // báo nào", trong khi sự thật là phần kiểm chứng KHÔNG CHẠY. Schema đang dài
  // và maxOutputTokens có hạn, nên Gemini bỏ trường phụ là chuyện có thật.
  const declaredEvidenceCount = segments.reduce((n, s) => n + (s.evidence?.length ?? 0), 0);
  if (segments.length > 0 && declaredEvidenceCount === 0) {
    globalWarnings.push(
      "AI không trả về trường evidence nào — phần truy vết căn cứ dưới đây được suy ra từ painPoints và lý do chọn, KHÔNG phải do AI tự khai nguồn. Nếu lặp lại nhiều lần, nhiều khả năng JSON bị cắt do vượt giới hạn token.",
    );
  }

  const segmentReports: SegmentGrounding[] = segments.map((seg) => {
    const warnings: string[] = [];
    const evidence: SegmentEvidence[] = [];

    // Câu khẳng định cần truy nguồn: evidence AI tự khai + painPoints + lý do chọn.
    const claims: Array<{ text: string; declared?: string; ref?: string }> = [];
    for (const e of seg.evidence ?? []) {
      const claimText = asText(e.claim);
      if (claimText) claims.push({ text: claimText, declared: asText(e.sourceType), ref: asText(e.sourceRef) });
    }
    for (const p of seg.painPoints ?? []) {
      const t = asText(p);
      if (t) claims.push({ text: t });
    }
    const whyText = asText(seg.whyThisSegment);
    if (whyText) claims.push({ text: whyText });

    for (const c of claims) {
      const kbHit = findSource(c.ref ? `${c.text} ${c.ref}` : c.text, kbCorpus);
      if (kbHit) {
        evidence.push({ claim: c.text, sourceType: "kb_grounded", matchedSource: kbHit });
        continue;
      }
      const manualHit = findSource(c.text, manualCorpus);
      if (manualHit) {
        evidence.push({ claim: c.text, sourceType: "manual_input", matchedSource: manualHit });
        continue;
      }
      // AI KHAI là có nguồn KB mà đối chiếu không ra → unverified, không phải
      // derived_inference. Phân biệt này là điểm mấu chốt: "tự suy" là trung
      // thực, "khai có nguồn mà không có" là thứ cần cảnh báo.
      if (c.declared === "kb_grounded" || c.ref) {
        evidence.push({ claim: c.text, sourceType: "unverified", matchedSource: "" });
        warnings.push(`Căn cứ khai là từ kiến thức sản phẩm nhưng đối chiếu không khớp: "${c.text.slice(0, 80)}"`);
      } else {
        evidence.push({ claim: c.text, sourceType: "derived_inference", matchedSource: "" });
      }
    }

    // performance_proven đứng đầu: tiền đã chi, kết quả đã về — mạnh hơn mọi
    // loại bằng chứng hình thức. unverified vẫn xếp TRÊN derived_inference vì
    // nó là một cảnh báo, không được để bản sao vô hại che đi.
    const RANK: Record<EvidenceSourceType, number> = {
      // performance_expensive xếp ngay sau performance_proven: nó cũng là bằng
      // chứng đo được, và là bằng chứng người đọc CẦN THẤY SỚM — đẩy xuống cuối
      // rồi bị cắt khỏi màn hình thì lại tái diễn đúng lỗi hôm nay.
      performance_proven: 0, performance_expensive: 1, kb_grounded: 2, manual_input: 3, unverified: 4, derived_inference: 5,
    };

    // Gộp trùng: một khẳng định có thể vào đây từ hai đường — AI khai trong
    // `evidence` (có sourceRef nên truy được về KB) và lặp lại trong
    // `painPoints` (không có ref nên rơi xuống "AI tự suy"). Mẻ thật 25/08 hiện
    // đúng lỗi này: "Khách sợ kỹ thuật" xuất hiện hai lần, một dòng xanh một
    // dòng xám — người đọc không biết tin dòng nào.
    //
    // Giữ nhãn MẠNH NHẤT cho mỗi câu. Thứ tự ưu tiên phản ánh độ tin cậy của
    // nguồn, riêng `unverified` xếp trên `derived_inference` vì nó là một CẢNH
    // BÁO, không được để một bản sao vô hại che đi.
    // performance_proven đứng đầu: tiền đã chi, kết quả đã về — mạnh hơn mọi
    // loại bằng chứng hình thức. unverified vẫn xếp TRÊN derived_inference vì
    // nó là một cảnh báo, không được để bản sao vô hại che đi.
    const bestByClaim = new Map<string, SegmentEvidence>();
    for (const e of evidence) {
      const key = normalize(e.claim);
      const cur = bestByClaim.get(key);
      if (!cur || RANK[e.sourceType] < RANK[cur.sourceType]) bestByClaim.set(key, e);
    }
    // Xếp MẠNH NHẤT LÊN TRƯỚC.
    //
    // Căn cứ "đã đo được" bị đẩy xuống cuối mảng (nó được thêm sau vòng lặp
    // claims), rồi giao diện cắt còn 6 mục đầu — nên nó BẮN ĐÚNG mà KHÔNG AI
    // THẤY. Đo bằng mẻ thật 25/08: log ghi performance_proven: 1 trong khi màn
    // hình chỉ hiện 4 xanh + 2 xám. Bằng chứng mạnh nhất mà nằm ngoài phần bị
    // cắt thì coi như không có.
    const deduped = [...bestByClaim.values()].sort((a, b) => RANK[a.sourceType] - RANK[b.sourceType]);
    evidence.length = 0;
    evidence.push(...deduped);

    // Đối chiếu CHÍNH DANH SÁCH SỞ THÍCH với số liệu đã đo được.
    //
    // Bản đầu chỉ đối chiếu provenInterests với các CÂU KHẲNG ĐỊNH (painPoints,
    // lý do chọn) — mà tên sở thích thì gần như không bao giờ xuất hiện nguyên
    // văn trong mấy câu đó. Kết quả: nhãn "đã đo được" KHÔNG THỂ xuất hiện, dù
    // dữ liệu có sẵn và AI chọn đúng sở thích đã chứng minh hiệu quả. Một tính
    // năng gắn nhãn mà về mặt cấu trúc không bao giờ chạy được cho đúng thứ nó
    // sinh ra để gắn — đo bằng mẻ thật 25/08: 0 nhãn performance_proven trên
    // một phân khúc có tới 6 sở thích, trong đó nhiều cái nằm trong danh sách
    // đã đo. Phải đối chiếu thẳng với danh sách sở thích.
    for (const rawIt of seg.facebookTargeting?.interests ?? []) {
      const itName = asText(rawIt);
      if (!itName) continue;
      // Khớp theo ID trước — chính xác, không phụ thuộc ngôn ngữ hiển thị.
      const resolvedId = interestIdByName.get(normalize(itName));
      const hit =
        // 1. Theo ID — chính xác tuyệt đối, không phụ thuộc ngôn ngữ (hướng C).
        (resolvedId ? provenInterests.find((p) => p.id === resolvedId) : undefined)
        // 2. Theo tên tiếng Anh Meta trả về (hướng B) — lấp đúng phần C không
        //    lo được: sở thích mới toanh, chưa từng resolve nên chưa có cache.
        ?? provenInterests.find((p) => p.nameEn && normalize(p.nameEn) === normalize(itName))
        // 3. Theo tên gốc, rồi khớp mờ — lưới cuối.
        ?? provenInterests.find((p) => normalize(p.name) === normalize(itName))
        ?? provenInterests.find((p) => findSource(itName, [p.name, p.nameEn ?? ""].filter(Boolean)));
      if (hit) {
        const expensive = medianCpl !== null && hit.cpl > medianCpl;
        const cmp = medianCpl !== null
          ? ` (trung vị ${Math.round(medianCpl / 1000)}k — ${expensive ? "ĐẮT hơn" : "rẻ hơn"})`
          : "";
        evidence.push({
          claim: `Sở thích "${itName}"`,
          sourceType: expensive ? "performance_expensive" : "performance_proven",
          matchedSource: `đã chạy thật: CPL ${Math.round(hit.cpl / 1000)}k · ${Math.round(hit.conversions)} kết quả${cmp}`,
        });
        if (expensive) {
          warnings.push(
            `Sở thích "${itName}" đã chạy thật nhưng CPL ${Math.round(hit.cpl / 1000)}k, ĐẮT hơn trung vị ${Math.round(medianCpl! / 1000)}k — cân nhắc thay bằng sở thích bám sản phẩm hơn.`,
          );
        }
      }
    }

    const kbGroundedCount = evidence.filter((e) => e.sourceType === "kb_grounded").length;
    if (hasSource && kbGroundedCount === 0) {
      warnings.push("Không có căn cứ nào truy được về kiến thức sản phẩm — phân khúc này hoàn toàn do AI suy luận.");
    }

    // Loại thành phố lớn mà không nói lý do.
    const locs = (seg.demographics?.location ?? []).map((l) => normalize(l));  // normalize đã tự ép chuỗi
    const nameAndWhy = normalize(`${asText(seg.segmentName)} ${asText(seg.whyThisSegment)}`);
    const excludesMajor =
      locs.length > 0 && !MAJOR_CITIES.some((c) => locs.some((l) => l.includes(normalize(c))));
    if (excludesMajor) {
      const explains = /ngoai tru|khong bao gom|loai tru|tap trung|thay vi|it canh tranh|chua duoc phuc vu/.test(nameAndWhy);
      // Có chữ giải thích thôi CHƯA đủ: "để mở rộng thị trường" là một câu
      // trống rỗng đọc như một lý do. Đòi thêm rằng lý do đó phải neo được vào
      // căn cứ nào đó — kiến thức sản phẩm hoặc thứ người dùng tự nhập.
      const reasonGrounded = evidence.some(
        (e) => (e.sourceType === "kb_grounded" || e.sourceType === "manual_input"),
      );
      if (!explains) {
        warnings.push(
          "Phân khúc bỏ qua TP.HCM và Hà Nội mà không nêu lý do — đây là hai thị trường lớn nhất, loại ra phải là quyết định có chủ ý.",
        );
      } else if (!reasonGrounded) {
        warnings.push(
          "Phân khúc bỏ qua TP.HCM và Hà Nội, có nêu lý do nhưng lý do đó không neo được vào căn cứ nào — cần chiến lược cụ thể, không phải câu chung chung.",
        );
      }
    }

    // Sở thích lạc khỏi lĩnh vực sản phẩm: chỉ cảnh báo khi KHÔNG truy được về
    // KB lẫn input — tránh bắt bẻ những lựa chọn có căn cứ.
    for (const raw of seg.facebookTargeting?.interests ?? []) {
      const it = asText(raw);
      if (!it) continue;
      if (!findSource(it, kbCorpus) && !findSource(it, manualCorpus)) {
        const t = normalize(it);
        if (/(bat dong san|real estate|xe hoi|automotive|thoi trang|fashion|du lich|travel|the thao|sports)/.test(t)) {
          warnings.push(`Sở thích "${it}" thuộc lĩnh vực không liên quan tới sản phẩm và không truy được về căn cứ nào.`);
        }
      }
    }

    return {
      segmentName: asText(seg.segmentName) || "(không tên)",
      evidence,
      kbGroundedCount,
      warnings,
    };
  });

  const hasWarnings =
    globalWarnings.length > 0 || segmentReports.some((s) => s.warnings.length > 0);

  return {
    productId,
    kbAvailable: hasSource,
    segments: segmentReports,
    globalWarnings,
    hasWarnings,
  };
}
