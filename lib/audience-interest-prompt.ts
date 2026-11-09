// ============================================================
// Prompt gợi ý interest cho Audience Optimizer.
// ------------------------------------------------------------
// Tách khỏi route vì hai lẽ:
//   1. route.ts của Next chỉ nên export handler — thêm export khác dễ gãy build.
//   2. Prompt là thứ dễ sai nhất và không có kiểu dữ liệu nào bắt lỗi giúp.
//      Nằm ở lib thì dựng thử được bằng một script thường, đọc tận mắt xem hai
//      chiến dịch khác nhau có ra hai prompt khác nhau không — chính là câu hỏi
//      của người dùng ngày 16/09/2026 ("sao gợi ý lặp lại cho mọi chiến dịch").
// ============================================================

import { resolveProductFromCampaign } from "@/lib/products-from-campaign";

/** Phần targeting mà prompt cần — chỉ khai những trường thực sự dùng. */
export interface PromptTargeting {
  ageRanges: string[];
  genders: string[];
  locations: { countries: string[]; cities: string[] };
  placements: { platforms: string[] };
  behaviors: Array<{ name: string }>;
  isBroadTargeting: boolean;
  adsetCount: number;
  activeCount: number;
}

export interface BuildPromptArgs {
  campaignName: string;
  objective: string;
  topSegment: string;
  topSegmentReason: string;
  currentInterests: string[];
  summary: PromptTargeting | null;
}

export function buildInterestPrompt(args: BuildPromptArgs): string {
  const { campaignName, objective, topSegment, topSegmentReason, currentInterests, summary } = args;

  // ── Căn cứ 1: sản phẩm ──
  const product = resolveProductFromCampaign(campaignName);
  let productBlock: string;
  if (product) {
    const kb = product.kb as {
      name?: string; description?: string;
      uniqueSellingPoints?: string[];
      realCustomerQuestions?: Array<{ question?: string; insight?: string }>;
    };
    const usp = (kb.uniqueSellingPoints ?? []).slice(0, 4).map(u => `  - ${u}`).join("\n");
    const qs = (kb.realCustomerQuestions ?? []).slice(0, 3)
      .map(q => `  - Khách hỏi: "${q.question}" → ${q.insight}`).join("\n");
    productBlock = [
      `Sản phẩm: ${kb.name ?? product.key}`,
      kb.description ? `Mô tả: ${kb.description}` : "",
      usp ? `Điểm mạnh:\n${usp}` : "",
      qs ? `Khách hàng THẬT hay hỏi:\n${qs}` : "",
    ].filter(Boolean).join("\n");
  } else {
    // Không suy được sản phẩm thì NÓI THẲNG là không biết. Đưa đại một sản phẩm
    // vào đây sẽ cho ra gợi ý sai một cách rất thuyết phục.
    productBlock = "Sản phẩm: KHÔNG suy được từ tên chiến dịch. Chỉ dựa vào targeting hiện tại, đừng đoán ngành.";
  }

  // ── Căn cứ 2: targeting đang chạy ──
  const targetingBlock = summary ? [
    `Tuổi: ${summary.ageRanges.join(", ") || "không rõ"}`,
    `Giới tính: ${summary.genders.join(", ") || "không rõ"}`,
    `Khu vực: ${[...summary.locations.countries, ...summary.locations.cities].join(", ") || "không rõ"}`,
    `Vị trí hiển thị: ${summary.placements.platforms.join(", ") || "không rõ"}`,
    `Số adset: ${summary.adsetCount} (đang chạy: ${summary.activeCount})`,
    summary.isBroadTargeting ? "Đang chạy BROAD (không khoanh interest)." : "",
    // Behavior đang chạy cũng phải liệt kê: nếu không, AI gợi lại đúng thứ đang
    // bật rồi người dùng thấy "gợi ý cái đã có" — vẫn là một kiểu lặp lại.
    summary.behaviors.length > 0
      ? `Behavior ĐANG chạy: ${summary.behaviors.map(b => b.name).join(", ")}`
      : "",
  ].filter(Boolean).join("\n") : "Không đọc được targeting hiện tại.";

  // ── Căn cứ 3: interest ĐANG chạy — cấm gợi ý lại ──
  const currentStr = currentInterests.length > 0
    ? currentInterests.map(i => `  - ${i}`).join("\n")
    : "  (chưa có interest nào — đang chạy Broad)";

  // ── Căn cứ 4: phân khúc người dùng tự ghi nhận (có thì dùng, không có thì thôi) ──
  const segmentBlock = topSegment
    ? `Phân khúc hiệu quả nhất (người chạy ads ghi nhận): ${topSegment}${topSegmentReason ? `\nLý do: ${topSegmentReason}` : ""}`
    : "Người chạy ads chưa ghi nhận phân khúc nào hiệu quả nhất — đừng bịa ra một phân khúc rồi nói là của họ.";

  const prompt = `
Bạn là chuyên gia targeting Facebook Ads cho thị trường Việt Nam, đang tối ưu MỘT chiến dịch cụ thể.

=== CHIẾN DỊCH ===
Tên: ${campaignName}
Mục tiêu: ${objective || "không rõ"}
${productBlock}

=== ĐANG NHẮM AI ===
${targetingBlock}

Interest ĐANG chạy (${currentInterests.length}):
${currentStr}

=== GHI NHẬN TỪ NGƯỜI CHẠY ADS ===
${segmentBlock}

=== LUẬT BẮT BUỘC ===
1. TUYỆT ĐỐI không đề xuất lại bất kỳ interest nào đã có trong danh sách "ĐANG chạy" ở trên.
2. KHÔNG đề xuất nhóm chung chung mà chiến dịch nào cũng dùng được: người dùng thiết bị di động, sắp đến sinh nhật, hay đi du lịch, ngoại kiều, người dùng Facebook... Những thứ đó không nói lên nhu cầu sản phẩm.
3. Mỗi đề xuất phải gắn với NGHỀ NGHIỆP, NHU CẦU hoặc CÔNG CỤ mà người mua sản phẩm này thực sự có. Đề xuất nào đem sang chiến dịch khác của công ty vẫn đúng y nguyên thì đó là đề xuất tồi — bỏ đi, nghĩ cái khác.
4. Tên phải là tên CÓ THẬT trong ô Detailed Targeting của Facebook — tiếng Anh, đúng như gõ vào rồi thấy Facebook gợi ra. Không tự chế tên. Không chắc có thật thì đừng đưa vào.
4b. Được phép đề xuất cả ba loại mục nhắm sau, miễn là tên CÓ THẬT trong danh mục Facebook:
   - Sở thích (Interests) — ví dụ "Web hosting", "SAP ERP", "Entrepreneurship".
   - Hành vi (Behaviors) — ví dụ "Facebook Page Admins", "Small business owners", "Technology early adopters".
   - Chức danh / Ngành nghề (Nhân khẩu học) — ví dụ "Chief Executive Officer", "Information technology".
   Hệ thống sẽ tự tra lại từng tên trong danh mục của Facebook và tự đưa vào đúng ô. Tên nào không có thật sẽ bị loại và người dùng không thấy — nên đừng chế tên, và đừng đề xuất khái niệm chung chung không phải là một mục nhắm (vd "doanh nghiệp vừa và nhỏ" không phải tên mục).
5. Trường "basis" phải nói rõ dựa vào đâu, chọn đúng một trong bốn: "kho sản phẩm" | "targeting hiện tại" | "ghi nhận của người chạy ads" | "suy luận ngành". Dùng "suy luận ngành" khi không có nguồn nào ở trên — nói thật còn hơn khai bừa là có nguồn.
6. Trường "reason" viết tiếng Việt, một câu, nói VÌ SAO tệp này mua sản phẩm này — không mô tả lại tên interest.

Đề xuất 10 interest (hệ thống sẽ tra lại từng cái trên Facebook và chỉ giữ những cái có thật, nên đề xuất dư để còn đủ dùng), chia theo category:
- "Nghề nghiệp": nghề/vai trò của người ra quyết định mua
- "Công nghệ": công cụ, nền tảng, phần mềm họ đang dùng
- "Hành vi": hành vi mua sắm/kinh doanh gắn TRỰC TIẾP với sản phẩm

Trả về JSON duy nhất, KHÔNG markdown:
[
  { "name": "tên interest tiếng Anh", "category": "Nghề nghiệp" | "Công nghệ" | "Hành vi", "reason": "một câu tiếng Việt", "basis": "kho sản phẩm" | "targeting hiện tại" | "ghi nhận của người chạy ads" | "suy luận ngành" }
]
`.trim();

  return prompt;
}
