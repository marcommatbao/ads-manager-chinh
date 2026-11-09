// ============================================================
// AI Audience Insight — POST /api/ai/audience-insight
// Generates audience segments + competitor intelligence + strategy
// Called by Creative AI Studio Step 2 "Phân tích đối tượng"
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { callGemini, extractJSON, redactApiKeys } from "@/lib/gemini";
import { getCurrentUser } from "@/lib/auth";
import { PRODUCTS_KB } from "@/lib/products-knowledge";
import { log } from "@/lib/logger";
import { verifyGrounding } from "@/lib/audience-grounding";
import { readCachedPerformance, selectPromptCandidates, type PromptCandidates } from "@/lib/audience-performance";
import { getCachedBatch, normalizeQuery } from "@/lib/interest-resolution-cache";
import { creativeBrandFor, creativeBrandPrompt, isLegacyCreativeCompany, profileProduct } from "@/lib/brand/creative";
import { isCompany } from "@/lib/companies";
import { canAccessCompany } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";
import { winnersPromptBlock } from "@/lib/meta/winning-audiences";

// ─── Product label map ────────────────────────────────────────────────────────

const PRODUCT_LABELS: Record<string, string> = {
  "ten-mien":         "Tên miền",
  "hosting":          "Hosting",
  "microsoft-365":    "Microsoft 365",
  "google-workspace": "Google Workspace",
  "email-dn":         "Email doanh nghiệp",
  "ssl":              "SSL Certificate",
  "sale-ai":          "Sale.ai — CRM AI bán hàng",
  "hoa-don-dien-tu":  "Hóa đơn điện tử",
  "chu-ky-so":        "Chữ ký số",
  "hop-dong-dien-tu": "Hợp đồng điện tử",
  "hoa-don-ecom":     "Hóa đơn Ecom",
};

function resolveProductName(productId: string): string {
  if (productId.startsWith("custom_")) return productId.replace("custom_", "");
  return PRODUCT_LABELS[productId] ?? productId;
}

/**
 * Nạp kiến thức sản phẩm THẬT vào prompt.
 *
 * Trước đây prompt chỉ nhận đúng cái NHÃN sản phẩm ("Tên miền") rồi để mô hình
 * tự nghĩ ra mọi thứ từ kiến thức chung của nó. Đó là lý do nó từng đề xuất
 * "Bất động sản (ngành)" cho tên miền, và cũng là lý do mẻ sau lại trùng gần
 * nguyên văn danh sách ví dụ trong prompt: không có gì khác để bám vào.
 *
 * Trong khi lib/products-knowledge.ts đã có sẵn USP, câu hỏi THẬT của khách,
 * đối thủ và khoảng trống cạnh tranh — do người viết, không phải AI đoán. Đưa
 * vào đây thì phân khúc bám thực tế kinh doanh thay vì bám trí nhớ mô hình.
 *
 * Cắt gọn có chủ đích: chỉ lấy phần định hình được ĐỐI TƯỢNG (USP, câu hỏi
 * khách, đối thủ + tệp của họ). Không nhồi cả kho — token trả bằng tiền thật.
 */
function buildProductKnowledge(productId: string): string {
  const kb = (PRODUCTS_KB as Record<string, unknown>)[productId] as
    | {
        name?: string;
        description?: string;
        uniqueSellingPoints?: string[];
        realCustomerQuestions?: Array<{ question?: string; insight?: string }>;
        competitors?: Array<{ name?: string; targetAudience?: string }>;
        competitiveWhitespace?: string;
      }
    | undefined;
  if (!kb) return "";

  const parts: string[] = [];
  if (kb.description) parts.push(`Mô tả: ${kb.description}`);
  if (kb.uniqueSellingPoints?.length) {
    parts.push(`Điểm mạnh riêng: ${kb.uniqueSellingPoints.slice(0, 4).join("; ")}`);
  }
  if (kb.realCustomerQuestions?.length) {
    // Câu hỏi khách THẬT hỏi — tín hiệu đối tượng đáng tin nhất trong kho này,
    // vì nó đến từ hội thoại có thật chứ không từ suy đoán.
    const qs = kb.realCustomerQuestions
      .slice(0, 4)
      .map((q) => `"${q.question}" (${q.insight ?? ""})`)
      .join(" | ");
    parts.push(`Câu hỏi khách THẬT hay hỏi: ${qs}`);
  }
  if (kb.competitors?.length) {
    const cs = kb.competitors
      .slice(0, 3)
      .map((c) => `${c.name} (tệp: ${c.targetAudience ?? "?"})`)
      .join("; ");
    parts.push(`Đối thủ và tệp họ đang nhắm: ${cs}`);
  }
  if (kb.competitiveWhitespace) parts.push(`Khoảng trống cạnh tranh: ${kb.competitiveWhitespace}`);

  return parts.length
    ? `\n\nKIẾN THỨC SẢN PHẨM THẬT (do người trong công ty biên soạn — ưu tiên hơn kiến thức chung của bạn):\n${parts.join("\n")}`
    : "";
}

// Repeated calls with the same product/objective/budget produce a
// byte-identical prompt, and Gemini's JSON-constrained decoding at moderate
// temperature reliably converges to the same "safe" segments (TP.HCM/Hà
// Nội/Đà Nẵng, 25-45, CEO/Giám đốc) every time — not a bug, just how
// low-variance structured generation on a narrow repeated prompt behaves.
// Rotating which segmentation angle is emphasized each call gives Gemini an
// actual reason to diverge, instead of just being told "be creative."
const SEGMENTATION_LENSES = [
  "quy mô doanh nghiệp (micro/nhỏ/vừa/lớn)",
  "ngành nghề kinh doanh cụ thể",
  "giai đoạn tăng trưởng (mới thành lập/đang mở rộng/đã ổn định)",
  "vùng địa lý và đặc thù kinh tế vùng miền",
  "mức độ ứng dụng công nghệ/chuyển đổi số",
  "vai trò người ra quyết định (chủ DN/quản lý cấp trung/nhân viên phụ trách)",
  "kênh anh ta đang dùng thay thế (đối thủ/tự làm/chưa có giải pháp)",
];

function pickSegmentationLens(): string {
  return SEGMENTATION_LENSES[Math.floor(Math.random() * SEGMENTATION_LENSES.length)];
}

// ─── Request shape ────────────────────────────────────────────────────────────

interface AudienceInsightRequest {
  productId: string;
  /** Đợt 21 A3b: công ty đang làm creative. Thiếu / công ty gói Mắt Bão → cách cũ (kho kiến thức Mắt Bão). */
  company?: string;
  campaignObjective?: string;
  funnelStage?: string;
  adSetCount?: number;
  currentCustomer?: {
    description?: string;
    painPoints?: string;
    motivation?: string;
    language?: string;
  };
  competitors?: {
    names?: string;
    differentiate?: string;
  };
  budget?: {
    dailyBudget?: number;
    totalDays?: number;
    adSetCount?: number;
  };
  /** Nền tảng chọn ở Bước 1. Quyết định Bước 2 sinh ra bộ nhắm mục tiêu NÀO.
   *  Thiếu ⇒ coi như "facebook" để nhánh cũ chạy y nguyên. */
  platform?: "facebook" | "google" | "both";
  google?: {
    campaignType?: string;
    seedKeywords?: string;
    negativeKws?: string;
    matchType?: string;
    audienceSignals?: string;
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Khối "đã đo được trên chính tài khoản này".
 *
 * Đây là lớp bằng chứng MẠNH NHẤT trong cả pipeline: A1 nói phân khúc có căn cứ
 * trong kho kiến thức, A2 nói Meta có hạng mục — cả hai đều là bằng chứng hình
 * thức. Khối này nói tiền đã chi và kết quả đã về.
 *
 * Đưa cả danh sách ĐẮT NHẤT chứ không chỉ danh sách rẻ nhất: dạy AI tránh cũng
 * quan trọng ngang dạy AI chọn, và nếu chỉ đưa danh sách tốt thì nó sẽ chép y
 * nguyên danh sách đó thay vì hiểu quy luật.
 *
 * Nói thẳng giới hạn trong prompt: chi phí được chia đều cho các sở thích trong
 * cùng ad set nên đây là PHÉP GÁN, không phải phép đo từng sở thích. Giấu điều
 * đó đi sẽ khiến AI (và người đọc kết quả) tin con số chắc hơn mức nó xứng đáng.
 */
function buildPerformanceBlock(c: PromptCandidates | null, legacy = true): string {
  if (!c) return "";
  // Ưu tiên tên TIẾNG ANH khi có: AI đề xuất sở thích bằng tiếng Anh, nên đưa
  // tên tiếng Anh vào prompt thì thứ nó học được cũng là thứ nó sẽ viết ra —
  // và lần khớp sau mới trúng. Đưa tên tiếng Việt rồi mong nó tự dịch ngược là
  // tự tạo thêm một chỗ để trượt.
  const fmt = (x: { name: string; nameEn?: string | null; cpl: number; conversions: number }) =>
    `${x.nameEn || x.name} (CPL ${Math.round(x.cpl / 1000)}k, ${Math.round(x.conversions)} kết quả)`;
  return `

SỐ LIỆU ĐÃ ĐO ĐƯỢC TRÊN CHÍNH TÀI KHOẢN NÀY — đây là bằng chứng mạnh hơn suy luận:
- Sở thích cho chi phí/kết quả RẺ NHẤT: ${c.best.map(fmt).join("; ")}
- Sở thích ĐẮT NHẤT (tránh, trừ khi có lý do rõ): ${c.worst.map(fmt).join("; ")}
${c.medianCpl ? `- CPL trung vị của các sở thích đủ dữ liệu: ${Math.round(c.medianCpl / 1000)}k\n` : ""}
Cách dùng số này:
- HIỂU QUY LUẬT, đừng chép danh sách. Nhìn xem nhóm rẻ có đặc điểm gì chung so với
  nhóm đắt, rồi áp quy luật đó để chọn sở thích phù hợp với sản phẩm đang làm.
- Nếu một sở thích trong danh sách rẻ KHÔNG liên quan tới sản phẩm này thì ĐỪNG
  chọn nó chỉ vì nó rẻ ở sản phẩm khác.
- Được phép đề xuất sở thích chưa từng chạy nếu nó bám sản phẩm — nhưng khi có
  hai lựa chọn tương đương, ưu tiên cái đã có số liệu tốt.
${legacy ? `- CẢNH BÁO TỪ SỐ LIỆU THẬT: nhóm sở thích mô tả DOANH NGHIỆP NÓI CHUNG ("Small
  business", "Business software", "Home business", "Entrepreneurship") đang đắt
  hơn rõ rệt so với nhóm mô tả ĐÚNG VIỆC người mua đang làm ("Web hosting",
  "Web development", "Web design"). Nếu bạn định chọn một sở thích thuộc nhóm
  chung chung, hãy tự hỏi có sở thích nào mô tả cụ thể hơn nhu cầu sản phẩm
  không — và chọn cái cụ thể hơn.
` : ""}- LƯU Ý GIỚI HẠN: chi phí được chia đều cho các sở thích trong cùng ad set, nên
  đây là phép GÁN chứ không phải phép đo riêng từng sở thích. Dùng để xếp thứ tự
  ưu tiên, không dùng để khẳng định một con số chính xác.`;
}

/** knowledge: khối kiến thức sản phẩm (legacy = kho Mắt Bão; khác = hồ sơ thương hiệu của công ty).
 *  A3.5 (nối 05/10/2026): khối "SỐ LIỆU ĐÃ ĐO ĐƯỢC" (buildPerformanceBlock) viết từ commit e6fb4fc nhưng CHƯA TỪNG được gọi —
 *  phân khúc chưa bao giờ học từ CPL thật dù báo cáo đã dựng. `perf` chỉ có ở nhánh Facebook (xem usePerf trong POST). */
function buildPrompt(body: AudienceInsightRequest, productName: string, perf: PromptCandidates | null, lens: string, knowledge: string, legacy: boolean): string {
  const adSetCount = Math.min(body.adSetCount ?? 3, 4);
  // Vẫn dùng để đưa tên đối thủ vào NGỮ CẢNH cho AI hiểu thị trường. Khối
  // "competitorIntelligence" riêng đã GỠ ngày 16/09/2026: giao diện hiện nó bị
  // khoá bằng hằng false suốt, nên mỗi lần người dùng khai đối thủ là sinh ra
  // một khối phân tích tốn token rồi vứt thẳng.
  const hasCompetitors = !!body.competitors?.names?.trim();

  // ── Bộ nhắm mục tiêu sinh ra theo NỀN TẢNG ───────────────────────────────
  // Trước 26/08/2026 bước này luôn sinh interests/behaviors của Meta, kể cả khi
  // người dùng chọn Nền tảng = Google ở Bước 1. Google Ads không có khái niệm
  // đó (Search nhắm bằng TỪ KHOÁ, PMax nhắm bằng audience signal), nên toàn bộ
  // phần đó vừa vô dụng vừa dạy sai cách nghĩ — và đường sinh creative Google
  // thực tế chỉ dùng đúng `segmentName`.
  //
  // Chỉ sinh thứ dùng được cho nền tảng đã chọn: chọn Google mà vẫn sinh cả bộ
  // Meta là bắt Gemini viết thừa (tốn token, dễ bịa) và bắt người đọc lọc.
  const platform = body.platform ?? "facebook";
  const wantFacebook = platform === "facebook" || platform === "both";
  const wantGoogle = platform === "google" || platform === "both";

  const funnelStage = body.funnelStage?.trim();

  const ctx: string[] = [
    `Sản phẩm: ${productName}`,
    `Mục tiêu: ${body.campaignObjective || "Lead generation"}`,
    `Số phân khúc cần tạo: ${adSetCount}`,
  ];
  if (funnelStage) ctx.push(`Funnel stage yêu cầu: ${funnelStage}`);
  if (body.currentCustomer?.description) ctx.push(`Khách hàng hiện tại: ${body.currentCustomer.description}`);
  if (hasCompetitors) ctx.push(`Đối thủ: ${body.competitors!.names}. Khác biệt: ${body.competitors!.differentiate || "chưa rõ"}`);
  if (body.budget?.dailyBudget) ctx.push(`Ngân sách: ${body.budget.dailyBudget.toLocaleString()}đ/ngày`);

  const funnelInstruction = funnelStage && funnelStage.includes("+")
    ? `\n\nQUAN TRỌNG — funnelStage: yêu cầu bao gồm các giai đoạn ${funnelStage.split("+").join(", ")}. PHÂN BỔ funnelStage KHÁC NHAU cho từng phân khúc trong số ${adSetCount} phân khúc — ví dụ nếu yêu cầu là "TOFU+MOFU" thì một số phân khúc nên là "TOFU" (khách chưa biết sản phẩm, nội dung nhận diện/giáo dục) và một số phân khúc nên là "MOFU" (khách đang cân nhắc, nội dung so sánh/thuyết phục). KHÔNG gán cùng 1 funnelStage cho tất cả các phân khúc.`
    : funnelStage
      ? `\n\nQUAN TRỌNG — funnelStage: tất cả phân khúc dùng funnelStage "${funnelStage}".`
      : "";

  return `Chuyên gia quảng cáo B2B VN. Tạo ${adSetCount} phân khúc đối tượng cho: ${ctx.join(", ")}.${knowledge}${buildPerformanceBlock(perf, legacy)}${legacy ? "" : "\n\nLƯU Ý: các ví dụ về tên miền / hosting trong hướng dẫn dưới đây CHỈ minh hoạ cách làm — sản phẩm của bạn là sản phẩm ở trên, đừng đề xuất gì về tên miền / hosting."}

QUAN TRỌNG — góc nhìn phân khúc: ưu tiên phân chia đối tượng theo góc nhìn "${lens}" cho lần phân tích này, thay vì lặp lại các phân khúc mẫu quen thuộc (TP.HCM/Hà Nội/Đà Nẵng, 25-45 tuổi, "CEO/Giám đốc") — chỉ giữ mẫu quen thuộc đó nếu nó thực sự là lựa chọn phù hợp nhất, không phải vì đó là lựa chọn an toàn/mặc định.

QUAN TRỌNG — CÁI GÌ TARGET ĐƯỢC Ở VIỆT NAM: Meta VN chỉ nhắm được theo TUỔI, GIỚI TÍNH, VỊ TRÍ, SỞ THÍCH (interests) và HÀNH VI (behaviors). KHÔNG nhắm được theo thu nhập, và trên thực tế cũng không nhắm được theo chức danh ở VN. Vì vậy:
- "income" và "jobTitles" chỉ dùng để VIẾT NỘI DUNG (chọn giọng văn, ví dụ, mức giá nêu ra) — đừng coi chúng là tiêu chí lọc người.
- Sức nặng nhắm mục tiêu thật nằm ở "interests" và "behaviors". Nếu một phân khúc chỉ khác phân khúc kia ở thu nhập hay chức danh mà interests/behaviors giống hệt, thì trên Meta chúng là CÙNG MỘT tệp — hãy gộp lại hoặc tìm sở thích/hành vi thật sự phân biệt được.

QUAN TRỌNG — location: chọn tỉnh/thành PHÙ HỢP VỚI TỪNG PHÂN KHÚC dựa trên nơi khách hàng mục tiêu thực sự tập trung (ngành nghề, quy mô doanh nghiệp, mức thu nhập, đặc thù sản phẩm) — ví dụ phân khúc "doanh nghiệp sản xuất" có thể tập trung ở Bình Dương/Đồng Nai/Hải Phòng, phân khúc "startup công nghệ" có thể tập trung ở TP.HCM/Hà Nội/Đà Nẵng, phân khúc "hộ kinh doanh du lịch" có thể tập trung ở Nha Trang/Đà Lạt/Phú Quốc. KHÔNG mặc định dùng TP.HCM+Hà Nội+Đà Nẵng cho mọi phân khúc — chỉ dùng khi thực sự phù hợp với logic nghiệp vụ, và các phân khúc khác nhau trong cùng 1 lần tạo nên có location khác nhau nếu bản chất khách hàng khác nhau. NHƯNG: chỉ dẫn này là để tránh lối mòn, KHÔNG phải lý do để loại bỏ thị trường lớn nhất. Nếu TP.HCM/Hà Nội đúng là nơi tệp khách tập trung đông nhất cho phân khúc đó thì cứ chọn — và khi CỐ Ý loại một thành phố lớn, phải nói rõ lý do trong "whyThisSegment".${funnelInstruction}

Trả về JSON (không markdown):
{
  "audienceSegments": [
    {
      "segmentName": "string",
      "size": "<khoảng quy mô AI ước tính, ghi chữ (ước tính)>",
      "priority": 1,
      "funnelStage": "<TOFU hoặc MOFU hoặc BOFU tùy phân khúc, xem hướng dẫn funnelStage ở trên>",
      "demographics": {"age": "25-45", "gender": "Tất cả", "location": ["<tỉnh/thành phù hợp phân khúc này>"], "income": "10-30tr/tháng", "jobTitles": ["CEO", "Giám đốc"]},
${wantFacebook ? `      "facebookTargeting": {"interests": ["Digital marketing", "Cloud computing"], "behaviors": ["Small business owners"], "jobTitles": ["CEO", "Director"], "excludeAudiences": []},` : ""}
${wantGoogle ? `      "googleTargeting": {"searchIntents": ["câu người dùng THẬT SỰ gõ vào Google, tiếng Việt có dấu, 2-6 từ"], "negativeKeywords": ["từ khoá phải LOẠI để không hiện sai người"], "audienceSignals": ["tín hiệu đối tượng cho Performance Max — in-market/affinity/custom segment"]},` : ""}
      "painPoints": ["pain 1", "pain 2"],
      "messagingAngle": "string",
      "estimatedCTR": "<khoảng CTR AI ước tính dạng x.x-y.y%, KHÔNG chép ví dụ>",
      "difficulty": "medium",
      "whyThisSegment": "string — phải nêu CĂN CỨ, không chỉ mô tả phân khúc",
      "evidence": [
        {"claim": "điều bạn khẳng định về tệp này", "sourceType": "kb_grounded|manual_input|derived_inference", "sourceRef": "trích ĐÚNG câu chữ trong KIẾN THỨC SẢN PHẨM THẬT hoặc trong thông tin người dùng nhập; để rỗng nếu là suy luận"}
      ],
      "emotionalDriver": "string",
      "recommendedTones": ["Professional"],
      "sampleAd": {"primaryText": "nội dung 125 ký tự", "headline": "tiêu đề 40 ký tự", "cta": "Learn More"}
    }
  ],
  "campaignStrategy": {
    "bestTimeToRun": {"daysOfWeek": ["Thứ 2-6"], "timeOfDay": "8-11h, 13-17h", "reasoning": "string"},
    "budgetRecommendation": {"minimumDaily": <số VND/ngày tự tính từ giá sản phẩm + mục tiêu>, "optimalDaily": <số VND/ngày>, "reasoning": "string — nêu cách tính"}
  }
}

${wantFacebook ? `QUAN TRỌNG — facebookTargeting.interests và behaviors:
- Mỗi interest phải trả lời được câu: "người quan tâm thứ này có lý do gì để mua ${productName}?"
  Suy từ KIẾN THỨC SẢN PHẨM THẬT ở trên (USP, câu hỏi khách hay hỏi, tệp đối thủ đang nhắm) —
  KHÔNG chép ví dụ minh hoạ trong hướng dẫn này.
- CẤM chọn interest theo NGÀNH KHÁCH HÀNG LÀM VIỆC nếu ngành đó không liên quan tới sản phẩm.
  Ví dụ SAI có thật: sản phẩm tên miền mà chọn "Real estate", "Sales" — chủ doanh nghiệp ngành nào
  cũng có thể mua tên miền, nên chọn theo ngành chỉ làm tệp loãng, không làm nó đúng hơn.
- ƯU TIÊN interest mô tả: (a) chính loại sản phẩm/dịch vụ, (b) công cụ và nền tảng người mua đang
  dùng, (c) hoạt động nghề nghiệp gắn với nhu cầu mua.
- CHỈ dùng tên hạng mục Facebook CÓ THẬT. Không tự đặt tên nghe hợp lý (ví dụ đã gặp: "Purchased
  domain" — không tồn tại). Không chắc tên đó có thật thì bỏ, đừng đoán: tên bịa sẽ bị loại khi
  đối chiếu với Meta và phân khúc mất luôn tiêu chí đó.
- Thà trả về ÍT interest mà đúng còn hơn nhiều interest cho đủ số. Không có interest nào thật sự
  liên quan thì để mảng rỗng.` : ""}

${wantGoogle ? `QUAN TRỌNG — googleTargeting (Google Ads KHÔNG nhắm bằng interest/behavior như Meta):
- "searchIntents" = câu người ta THẬT SỰ GÕ VÀO Ô TÌM KIẾM khi đang có nhu cầu này. Viết tiếng
  Việt CÓ DẤU ĐẦY ĐỦ ở MỌI từ khoá — không được bỏ dấu ở bất kỳ cụm nào (đã gặp: "mua domain
  tang hosting" lẫn giữa các cụm có dấu). 2-6 từ, đúng cách người Việt gõ. Đây là thứ quyết định
  campaign Search chạy trúng hay không — quan trọng hơn mọi mô tả nhân khẩu học.
- Bám vào GIAI ĐOẠN PHỄU của phân khúc: TOFU thì gõ câu tìm hiểu ("hosting là gì", "nên chọn
  hosting nào"), BOFU thì gõ câu sắp mua ("mua hosting giá rẻ", "đăng ký tên miền .vn").
- CẤM đưa tên thương hiệu đối thủ vào searchIntents.
- CHỈ đưa từ khoá mà ${productName} THẬT SỰ BÁN. Đã gặp lỗi: sản phẩm tên miền mà đề xuất
  "đăng ký thương hiệu online" — đó là đăng ký NHÃN HIỆU ở Cục Sở hữu trí tuệ, một dịch vụ khác
  hẳn. Từ khoá kiểu này kéo về người không bao giờ mua, tốn tiền mà không ra đơn.

- "negativeKeywords" = từ khoá phải LOẠI để quảng cáo không hiện cho người không mua: người tìm
  bản lậu ("crack", "nulled", "share"), người tìm việc ("tuyển dụng", "lương"), người học lý
  thuyết ("là gì", "ý nghĩa" — chỉ khi phân khúc là BOFU). Đây là chỗ tiết kiệm tiền nhiều nhất.

- ⛔ CẤM TUYỆT ĐỐI đưa vào negativeKeywords bất kỳ từ nào mô tả CHÍNH ƯU ĐÃI của sản phẩm. Trước
  khi loại một từ, đối chiếu với "Ưu đãi đang chạy" và "Câu hỏi khách hay hỏi" trong KIẾN THỨC
  SẢN PHẨM THẬT ở trên. Lỗi có thật đã gặp: sản phẩm tên miền có ưu đãi "Tặng kèm hosting/email
  khi mua domain" và khách hay hỏi "Mua domain có được tặng hosting không?", nhưng AI vẫn loại
  "miễn phí" và "free" — tức tự chặn đúng nhóm khách BIẾT RÕ mình đang bán gì. Tệ hơn, cùng phân
  khúc đó lại có từ khoá dương "mua domain tặng hosting": hai dòng triệt tiêu nhau.
- Muốn chặn người tìm đồ chùa thì dùng CỤM CỤ THỂ chứ đừng chặn TỪ ĐƠN: loại "tên miền miễn phí",
  "hosting free vĩnh viễn", "domain free" — KHÔNG loại trần trụi "miễn phí" hay "free".
- Kiểm chéo lần cuối trước khi trả về: không một từ nào trong negativeKeywords được xuất hiện
  trong searchIntents của cùng phân khúc đó.
- "audienceSignals" = gợi ý tệp cho Performance Max (in-market, affinity, custom segment theo
  hành vi tìm kiếm). PMax chỉ coi đây là TÍN HIỆU gợi ý, không phải bộ lọc cứng — viết ngắn gọn.
- Mỗi mảng 3-8 mục. Không đủ thì để ít, đừng độn cho đủ số.` : ""}

QUAN TRỌNG — evidence (BẮT BUỘC, mỗi phân khúc 1–3 mục, KHÔNG quá 3):
- Mỗi khẳng định đáng kể về tệp phải kèm một mục evidence.
- sourceType "kb_grounded" CHỈ được dùng khi bạn TRÍCH ĐƯỢC câu chữ có thật trong KIẾN THỨC SẢN
  PHẨM THẬT ở trên, và phải đặt đúng câu chữ đó vào sourceRef. Khai "kb_grounded" mà không trích
  được sẽ bị hệ thống đối chiếu và đánh dấu là KHÔNG XÁC MINH ĐƯỢC.
- Suy luận của riêng bạn thì khai thẳng "derived_inference" với sourceRef rỗng. Suy luận trung
  thực KHÔNG bị trừ điểm; khai có nguồn mà không có mới bị.

Nội dung tiếng Việt.${wantFacebook ? " facebookTargeting.interests/behaviors dùng tiếng Anh (đó là tên hạng mục của Meta)." : ""}${wantGoogle ? " googleTargeting.searchIntents/negativeKeywords dùng TIẾNG VIỆT CÓ DẤU (đó là câu người Việt gõ vào Google)." : ""}`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: friendlyError("GEMINI_API_KEY not configured") },
      { status: 401 }
    );
  }

  let body: AudienceInsightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.productId) {
    return NextResponse.json(
      { success: false, error: "productId is required" },
      { status: 400 }
    );
  }

  // Đợt 21 A3b: công ty ngoài gói Mắt Bão → CHỈ hồ sơ thương hiệu của công ty đó (không kho kiến thức / nhãn sản phẩm Mắt Bão).
  if (body.company !== undefined && (!isCompany(body.company) || !canAccessCompany(user, body.company))) {
    return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 });
  }
  const legacy = !body.company || isLegacyCreativeCompany(body.company);
  const ownProduct = legacy ? null : profileProduct(body.company!, body.productId);
  const productName = legacy ? resolveProductName(body.productId) : (ownProduct?.label ?? body.productId.replace(/^custom_/, ""));
  const ownBrand = legacy ? null : creativeBrandFor(body.company!);
  const ownCorpus: string[] | null = ownBrand ? [ownProduct?.label ?? "", ownProduct?.description ?? "", ownBrand.persona, ...ownBrand.strengths] : null;
  const knowledge = legacy
    ? buildProductKnowledge(body.productId)
    : `\n\nKIẾN THỨC SẢN PHẨM THẬT (từ HỒ SƠ DOANH NGHIỆP của công ty — chỉ dùng đúng các ý này):${ownProduct?.description ? `\nMô tả sản phẩm: ${ownProduct.description}` : ""}${creativeBrandPrompt(body.company)}`;

  // A3.5 — nạp hiệu quả ĐÃ ĐO ĐƯỢC vào prompt. CHỈ đọc file đã lưu; sinh phân
  // khúc KHÔNG BAO GIỜ được tự gọi Meta. Chưa dựng báo cáo lần nào thì khối này
  // vắng mặt và prompt chạy y như trước — không bịa ra số để lấp chỗ trống.
  // CHỈ áp cho nhánh Facebook: CPL này đo từ 277 ad set META. Đưa nó vào luồng
  // Google là lấy bằng chứng của nền tảng này biện minh cho quyết định ở nền
  // tảng kia — sai về bản chất, không chỉ thừa.
  const platformForPerf = body.platform ?? "facebook";
  const usePerf = platformForPerf !== "google";
  const wantGoogleTargeting = platformForPerf === "google" || platformForPerf === "both";

  let perfCandidates: PromptCandidates | null = null;
  let perfReport: Awaited<ReturnType<typeof readCachedPerformance>>["report"] = null;
  if (usePerf) try {
    const { report } = await readCachedPerformance(90);
    perfReport = report;
    perfCandidates = selectPromptCandidates(report);
  } catch {
    /* không đọc được thì thôi — đây là lớp bổ sung, không phải điều kiện cần */
  }

  // Bốc góc nhìn Ở ĐÂY thay vì bên trong buildPrompt, để còn trả được ra UI —
  // không nói ra thì người đọc không hiểu vì sao lần này toàn phân khúc theo tỉnh.
  const lens = pickSegmentationLens();
  // Đợt 26: tệp thắng đã lưu (So sánh tệp đối tượng) làm điểm xuất phát — CHỈ nhánh Facebook (đo trên Meta), chỉ khi có công ty.
  let winners = "";
  if (usePerf && body.company) { try { winners = winnersPromptBlock(body.company); } catch { /* lớp bổ sung */ } }
  const prompt = buildPrompt(body, productName, perfCandidates, lens, knowledge + winners, legacy);

  try {
    const geminiRes = await callGemini(
      prompt,
      // thinkingBudget: 0 — chế độ "thinking" của Gemini âm thầm ăn hết
      // into maxOutputTokens; without disabling it, longer prompts (like the
      // segmentation-lens instruction added above) intermittently truncate
      // mid-JSON and fail to parse (confirmed live: 2/3 identical calls
      // failed with "AI trả về dữ liệu không hợp lệ" before this was set).
      { temperature: 0.9, maxOutputTokens: 6144, responseMimeType: "application/json", thinkingBudget: 0 },
      apiKey
    );

    const rawText = geminiRes.text?.trim() ?? "";
    if (!rawText) {
      console.error("[audience-insight] Empty response from Gemini. finishReason:", geminiRes.finishReason);
      return NextResponse.json(
        { success: false, error: "AI trả về kết quả rỗng. Vui lòng thử lại." },
        { status: 502 }
      );
    }

    // With responseMimeType: application/json, Gemini returns clean JSON — parse directly
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Fallback: try extractJSON for cases where model adds extra text
      const fallback = extractJSON(rawText);
      if (!fallback || typeof fallback !== "object") {
        console.error("[audience-insight] JSON parse failed. First 300 chars:", rawText.slice(0, 300));
        return NextResponse.json(
          { success: false, error: "AI trả về dữ liệu không hợp lệ. Vui lòng thử lại." },
          { status: 502 }
        );
      }
      data = fallback as Record<string, unknown>;
    }

    if (!Array.isArray(data.audienceSegments) || data.audienceSegments.length === 0) {
      console.error("[audience-insight] No audienceSegments. Keys:", Object.keys(data));
      return NextResponse.json(
        { success: false, error: "AI không tạo được phân khúc đối tượng. Vui lòng thử lại." },
        { status: 502 }
      );
    }

    // ── Chốt bằng MÃ cho từ khoá phủ định của Google ─────────────────────
    // Prompt đã cấm, nhưng cấm trong prompt là lời khuyên chứ không phải hàng
    // rào — mẻ 26/08 vẫn loại "miễn phí"/"free" trong khi sản phẩm tên miền có
    // ưu đãi "Tặng kèm hosting/email khi mua domain", tức tự chặn đúng nhóm
    // khách biết rõ mình đang bán gì. Cùng phân khúc đó lại có từ khoá dương
    // "mua domain tặng hosting": hai dòng triệt tiêu nhau.
    //
    // Hai luật, đều đo được nên đặt vào mã:
    //  1. Từ phủ định KHÔNG được xuất hiện trong chính searchIntents của phân
    //     khúc đó — đây là mâu thuẫn nội tại, không phải chuyện khẩu vị.
    //  2. Từ phủ định KHÔNG được là từ đơn mô tả ưu đãi của sản phẩm (đối chiếu
    //     `topOffers` + `realCustomerQuestions` trong KB). Chỉ chặn được khi nó
    //     là CỤM cụ thể ("tên miền miễn phí"), không phải từ trần trụi.
    let droppedNegativeNote: string | null = null;
    if (wantGoogleTargeting) {
      const kbMap = PRODUCTS_KB as Record<string, {
        topOffers?: string[];
        realCustomerQuestions?: Array<{ question?: string }>;
      } | undefined>;
      // Đợt 21 A3b: kho ưu đãi là của Mắt Bão — công ty khác không đối chiếu (tránh "custom_hosting" khớp nhầm kho Mắt Bão).
      const kb = legacy ? kbMap[body.productId.replace(/^custom_/, "")] : undefined;
      const offerText = [
        ...(kb?.topOffers ?? []),
        ...(kb?.realCustomerQuestions ?? []).map((q) => q.question ?? ""),
      ].join(" ").toLowerCase();
      // Một HỌ TỪ ĐỒNG NGHĨA, không phải các từ rời rạc.
      //
      // Đo thật bằng chính mẻ 26/08: `topOffers` của tên miền viết "TẶNG kèm
      // hosting/email khi mua domain" — không hề có chữ "miễn phí". Nếu chỉ
      // chặn đúng từ mà KB dùng thì luật này KHÔNG bắn, và "miễn phí"/"free"
      // vẫn lọt vào danh sách phủ định. Nhưng với khách thì "tặng hosting" và
      // "hosting miễn phí" là CÙNG MỘT ưu đãi, họ gõ từ nào cũng được.
      //
      // Nên: sản phẩm có BẤT KỲ ưu đãi nào ⇒ cấm chặn MỌI từ đơn trong họ này.
      const OFFER_WORDS = ["miễn phí", "mien phi", "free", "tặng", "tang", "khuyến mãi", "khuyen mai", "ưu đãi", "uu dai", "giảm giá", "giam gia", "dùng thử", "dung thu", "trial", "sale"];
      const hasOffer = OFFER_WORDS.some((w) => offerText.includes(w));

      const norm = (x: string) => x.toLowerCase().trim();
      let dropped = 0;
      for (const seg of data.audienceSegments as Array<{ googleTargeting?: { searchIntents?: string[]; negativeKeywords?: string[] } }>) {
        const gt = seg.googleTargeting;
        if (!gt?.negativeKeywords?.length) continue;
        const intents = (gt.searchIntents ?? []).map(norm);
        gt.negativeKeywords = gt.negativeKeywords.filter((kwRaw) => {
          const kw = norm(kwRaw);
          // (1) trùng/nằm trong chính từ khoá dương của phân khúc này
          if (intents.some((it) => it.includes(kw))) { dropped++; return false; }
          // (2) là TỪ ĐƠN mô tả ưu đãi đang chạy — chặn nó là tự bắn vào chân.
          //     Cụm dài chứa từ đó ("tên miền miễn phí") thì GIỮ: đó mới là
          //     cách chặn người tìm đồ chùa mà không chặn khách của mình.
          if (hasOffer && OFFER_WORDS.includes(kw)) { dropped++; return false; }
          return true;
        });
      }
      if (dropped > 0) {
        log.info("audience_insight", `Đã bỏ ${dropped} từ khoá phủ định tự mâu thuẫn với ưu đãi/từ khoá dương`, {
          productId: body.productId, hasOffer,
        });
        // Bỏ âm thầm là sai: người dùng phải biết danh sách đã bị can thiệp,
        // và biết vì sao — không thì họ tưởng AI viết ra đúng như vậy.
        droppedNegativeNote =
          `Đã tự bỏ ${dropped} từ khoá phủ định vì chúng chặn luôn ưu đãi của chính sản phẩm ` +
          `(ví dụ loại "miễn phí"/"free" trong khi đang có chương trình tặng kèm). ` +
          `Muốn chặn người tìm đồ chùa thì thêm CỤM cụ thể như "tên miền miễn phí", đừng chặn từ đơn.`;
      }
    }

    // ── A1: đối chiếu những gì AI nói với KB và với input người dùng ──
    // "Đã đưa KB vào prompt" KHÔNG đồng nghĩa "AI đã dùng KB". Bước này không
    // sinh thêm nội dung, chỉ dán nhãn từng căn cứ và nêu cảnh báo.
    const manualInputs = [
      body.currentCustomer?.description,
      body.currentCustomer?.painPoints,
      body.currentCustomer?.motivation,
      body.competitors?.names,
      body.competitors?.differentiate,
    ].filter((x): x is string => Boolean(x && x.trim()));

    // Bọc try/catch: phần chấm căn cứ là thứ PHỤ, không bao giờ được phép làm
    // hỏng việc chính là phân tích đối tượng.
    //
    // Đã xảy ra thật ngay lần chạy đầu (25/08): AI trả một trường dạng object
    // thay vì chuỗi, normalize() gọi .toLowerCase() trên nó, cả màn hình chết
    // với "e.toLowerCase is not a function" — người dùng mất luôn kết quả phân
    // tích chỉ vì phần chấm điểm vấp. asText() đã vá ca đó; try/catch này chặn
    // CẢ LỚP lỗi, vì đầu ra LLM không có hợp đồng kiểu nào để mà tin.
    let grounding: ReturnType<typeof verifyGrounding> | null = null;
    let groundingError: string | null = null;
    // Khai báo NGOÀI try: khối log bên dưới cần đọc kích thước của nó.
    const idByName = new Map<string, string>();
    try {
      // Tra cache resolve (A2-lite) để đổi tên sở thích AI đề xuất sang id Meta.
      // KHÔNG gọi Meta — chỉ đọc thứ đã lưu từ các lần launch trước.
      const proposedNames = (data.audienceSegments as Array<{ facebookTargeting?: { interests?: unknown[] } }>)
        .flatMap((sg) => sg.facebookTargeting?.interests ?? [])
        .map((x) => (typeof x === "string" ? x : ""))
        .filter(Boolean);
      try {
        const cached = await getCachedBatch(proposedNames, process.env.META_AD_ACCOUNT_ID ?? "unknown");
        for (const [name, res] of cached) {
          if (res.match?.id) idByName.set(normalizeQuery(name), res.match.id);
        }
      } catch {
        /* không có cache thì rơi về khớp theo tên */
      }

      grounding = verifyGrounding(
        body.productId,
        data.audienceSegments as Parameters<typeof verifyGrounding>[1],
        manualInputs,
        // Tên sở thích đã có số liệu thật — để căn cứ nào trùng với chúng được
        // gắn nhãn "đã đo được" thay vì tụt xuống "AI tự suy".
        [...(perfCandidates?.best ?? []), ...(perfCandidates?.worst ?? [])],
        perfCandidates?.medianCpl ?? null,
        idByName,
        ownCorpus, // Đợt 21 A3b: bản khách đối chiếu với hồ sơ doanh nghiệp, không với kho Mắt Bão
      );
      // Đưa việc "đã can thiệp danh sách từ khoá phủ định" lên cùng chỗ với các
      // cảnh báo khác, để nó không nằm riêng một góc không ai đọc.
      if (droppedNegativeNote) grounding.globalWarnings.push(droppedNegativeNote);
    } catch (gErr) {
      // Hỏng thì NÓI RA, không im lặng bỏ qua: giao diện trống trơn đọc thành
      // "không có cảnh báo nào", trong khi sự thật là phần kiểm chứng đã chết.
      groundingError = gErr instanceof Error ? gErr.message : String(gErr);
      console.error("[audience-insight] verifyGrounding hỏng:", groundingError);
    }

    if (!grounding) {
      return NextResponse.json({
        success: true,
        data,
        grounding: null,
        groundingError:
          `Không chấm được căn cứ cho mẻ này (${groundingError}). Phân khúc bên dưới VẪN LÀ kết quả thật của AI, ` +
          `nhưng chưa được đối chiếu với kiến thức sản phẩm — hãy tự kiểm trước khi dùng.`,
      });
    }

    // Ghi log MỌI mẻ, không chỉ mẻ có cảnh báo. Tiêu chí nghiệm thu của phase
    // này là "có ít nhất 2 mẻ thật được ghi nhận" — chỉ log khi có cảnh báo thì
    // một mẻ sạch sẽ không để lại dấu vết nào, và không ai chứng minh được nó
    // đã từng chạy.
    console.log(
      "[audience-insight] grounding:",
      JSON.stringify({
        product: body.productId,
        // Nạp được bao nhiêu ứng viên đã đo vào prompt. 0 = khối hiệu quả VẮNG
        // MẶT, nên đừng thắc mắc vì sao không có nhãn "đã đo được".
        perfCandidates: (perfCandidates?.best.length ?? 0) + (perfCandidates?.worst.length ?? 0),
        perfExcludedLowVolume: perfCandidates?.excludedForLowVolume ?? null,
        /** Bao nhiêu tên sở thích tra được id từ cache — 0 nghĩa là đang phải
         *  khớp theo tên và sẽ trượt khi Meta trả tên tiếng Việt. */
        interestIdsFromCache: idByName.size,
        /** Số sở thích trong báo cáo có tên tiếng Anh (hướng B). 0 = endpoint
         *  không trả tên, việc khớp sẽ dựa hoàn toàn vào id trong cache. */
        englishNames: perfReport?.englishNamesResolved ?? 0,
        kbAvailable: grounding.kbAvailable,
        segments: grounding.segments.length,
        kbGroundedTotal: grounding.segments.reduce((n, s) => n + s.kbGroundedCount, 0),
        global: grounding.globalWarnings,
        perSegment: grounding.segments.map((s) => ({
          name: s.segmentName,
          kb: s.kbGroundedCount,
          labels: s.evidence.map((e) => e.sourceType),
          warn: s.warnings,
        })),
      }),
    );

    // Trả góc nhìn đã dùng ra UI. Góc nhìn được BỐC NGẪU NHIÊN mỗi lần gọi
    // (SEGMENTATION_LENSES) để tránh lối mòn — nhưng khi bốc trúng "vùng địa lý"
    // thì kết quả ra toàn phân khúc theo tỉnh và người đọc không hiểu vì sao
    // TP.HCM/Hà Nội biến mất. Nói rõ góc nhìn thì kết quả giải thích được, và
    // người dùng biết bấm tạo lại để đổi góc.
    return NextResponse.json({ success: true, data, grounding, lens });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("RATE_LIMITED")) {
      return NextResponse.json(
        { success: false, error: "Gemini API đang bận. Vui lòng thử lại sau 30 giây." },
        { status: 429 }
      );
    }
    if (message.includes("GEMINI_TIMEOUT")) {
      return NextResponse.json(
        { success: false, error: "AI phản hồi quá lâu — vui lòng thử lại." },
        { status: 504 }
      );
    }
    // Khoá Gemini chết là việc của người quản trị, không phải lỗi thao tác. Nói
    // rõ phải làm gì, và tuyệt đối KHÔNG in nguyên văn lỗi Google (chuỗi đó có
    // chứa chính khoá API).
    if (message.includes("GEMINI_KEY_SUSPENDED") || message.includes("GEMINI_KEY_INVALID")) {
      return NextResponse.json(
        { success: false, error: redactApiKeys(message.replace(/^GEMINI_KEY_(SUSPENDED|INVALID): /, "")) },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: redactApiKeys(`Audience analysis failed: ${message}`) },
      { status: 500 }
    );
  }
}
