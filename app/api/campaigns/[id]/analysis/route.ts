// ============================================================
// GET /api/campaigns/[id]/analysis?platform=facebook|google&company=MBC|MBI
// ============================================================
// Chấm hiệu quả MỘT chiến dịch và trả về kèm việc cần làm.
//
// KIẾN TRÚC — VÌ SAO CHIA HAI LỚP:
//
//   lib/campaign-analysis.ts  →  CHẤM ĐIỂM. Thuần tính toán, không AI.
//   route này                 →  gom dữ liệu + nhờ AI DIỄN GIẢI thành câu.
//
// Mô hình KHÔNG được chấm điểm và KHÔNG được sinh ra con số. Nó nhận bản kết
// luận đã tính xong và chỉ viết lại cho dễ đọc. Lý do: cả repo này đã nhiều
// lần dính chuyện AI trình một con số bịa như số thật. Tách ra thế này thì kể
// cả khi mô hình bịa, phần `pillars[].evidence` bên dưới vẫn là số thật và
// người dùng đối chiếu được ngay trên cùng màn hình.
//
// Gọi AI là TUỲ CHỌN (`?ai=0` để tắt). Mất mạng, hết hạn mức hay Gemini lỗi
// thì phần chấm điểm vẫn trả về đầy đủ — chỉ thiếu đoạn văn diễn giải, và ta
// nói rõ là thiếu chứ không im lặng bỏ qua.
// ============================================================

import { orgName } from "@/lib/brand/store"
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { detectCompany } from "@/lib/company-detect";
import { callGemini } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { fetchCampaignRevenue, extractUtmCampaign } from "@/lib/odoo-campaign-revenue";
import {
  analyzeCampaign,
  type AnalysisInput,
  type AnalysisPlatform,
  type CampaignAnalysis,
} from "@/lib/campaign-analysis";
import { resolveTarget } from "@/lib/targets/resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mỗi lượt là một lượt gọi Gemini có tính tiền cộng với một vòng kéo dữ liệu
// từ Meta/Google. Chặn theo người dùng, không theo IP — cả văn phòng đi chung
// một đường ra internet.
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;

interface CampaignDetailResponse {
  campaign?: AnalysisInput["campaign"];
  metrics?: AnalysisInput["metrics"];
  adsets?: AnalysisInput["adsets"];
  daily?: AnalysisInput["daily"];
  period?: { from: string; to: string };
  error?: string;
}

const SYSTEM_RULES = `Bạn là chuyên viên phân tích quảng cáo của __ORG__, đang giải thích kết quả chấm điểm một chiến dịch cho người chạy quảng cáo.

LUẬT TUYỆT ĐỐI:
1. CHỈ dùng đúng những con số có trong dữ liệu được đưa bên dưới. KHÔNG được tự tính thêm, tự làm tròn khác đi, hay nhắc tới bất kỳ con số nào không xuất hiện trong dữ liệu đó.
2. KHÔNG được đổi kết luận đã chấm. Trạng thái từng trụ (tốt/cần chú ý/kém/chưa chấm được) là kết quả tính toán — bạn diễn giải nó, không phản bác nó.
3. Chỗ nào dữ liệu ghi "chưa chấm được" hoặc "chưa có ngưỡng" thì phải nói thẳng là chưa đủ căn cứ. KHÔNG được lấp bằng phỏng đoán.
4. KHÔNG ĐƯỢC NÊU NGUYÊN NHÂN mà dữ liệu không đo. Cụ thể: không được nói tệp đối tượng hẹp/rộng, nội dung quảng cáo hay/dở, giá thầu cao/thấp, trang đích tốt/xấu — TRỪ KHI có đúng một dòng số liệu hoặc một mục vấn đề bên dưới nói ra điều đó. Không có phép đo thì không có nguyên nhân.
5. Số mục "Vấn đề phát hiện được" là con số chốt. Bằng 0 nghĩa là KHÔNG CÓ VẤN ĐỀ — không được đi tìm một vấn đề để nói cho đủ đoạn, và tuyệt đối không được gọi trạng thái giai đoạn học là "vấn đề lớn nhất".
6. Chỉ khi dữ liệu ghi rõ ĐANG TRONG GIAI ĐOẠN HỌC (bị khoá thao tác) thì mới được khuyên không tắt/không cắt ngân sách. Trạng thái "học hạn chế" KHÔNG bị khoá — với nó chỉ được khuyên theo dõi sát, không được dùng chữ "tuyệt đối không".
7. Viết tiếng Việt, xưng hô trung tính, không dùng "anh/chị". Không emoji. Không markdown heading. Dùng từ tiếng Việt: "chuyển đổi" không phải "conversion", "tệp đối tượng" không phải "audience", "tỷ lệ nhấp" không phải "tỷ lệ CTR" (nói "CTR" hoặc "tỷ lệ nhấp", đừng ghép cả hai).
8. KHÔNG nhắc tới tên các trụ như thể người đọc biết chúng. Cấm viết "trụ mục tiêu và kết quả", "trụ nghẽn ở đâu", "trụ cấu trúc bên trong" — đó là tên gọi nội bộ. Nói thẳng điều cần nói: thay vì "trụ nghẽn ở đâu được đánh giá tốt", viết "quảng cáo tiếp cận và thu hút tốt, không tắc ở khâu nào".
9. Nếu có trụ nào xếp loại KÉM, đoạn 1 KHÔNG được kết lại bằng một câu khen suôn sẻ. Phải nói rõ là nhìn chung ổn NHƯNG có điểm phải xử lý.

ĐỊNH DẠNG TRẢ VỀ — đúng 3 đoạn văn xuôi, cách nhau bằng một dòng trống, không đánh số, không gạch đầu dòng:
Đoạn 1 (2-3 câu): chiến dịch này đang hiệu quả hay không, và căn cứ vào đâu mà nói vậy.
Đoạn 2 (2-4 câu): NẾU số mục vấn đề lớn hơn 0 — nói mục nặng nhất nằm ở đâu và vì sao, chỉ dựa trên số liệu đã cho. NẾU bằng 0 — nói thẳng là chưa thấy vấn đề nào, rồi nêu chỉ số nào đáng theo dõi tiếp và ngưỡng nào chạm tới thì phải xem lại.
Đoạn 3 (2-3 câu): việc nên làm tiếp theo, xếp theo thứ tự nên làm trước.`;

/** Dựng phần dữ liệu đưa cho mô hình — CHỈ từ kết quả đã chấm, không thêm gì. */
function buildPrompt(name: string, platform: AnalysisPlatform, a: CampaignAnalysis, period: { from: string; to: string }): string {
  const statusText: Record<string, string> = {
    good: "tốt", warn: "cần chú ý", bad: "kém", unknown: "chưa chấm được",
  };

  const pillarBlock = a.pillars.map(p =>
    `[${p.label}] trạng thái: ${statusText[p.status]}\n` +
    `  kết luận: ${p.headline}\n` +
    `  thước đo: ${p.basis}\n` +
    (p.evidence.length ? `  số liệu: ${p.evidence.join(" | ")}\n` : "")
  ).join("\n");

  const findingBlock = a.findings.length
    ? a.findings.map((f, i) =>
        `${i + 1}. [${f.severity}] ${f.title}\n   chi tiết: ${f.detail}\n   đề xuất: ${f.recommendation}`
      ).join("\n")
    : "KHÔNG CÓ VẤN ĐỀ NÀO. Máy chấm đã đi hết 5 trụ và không có mục nào cần xử lý.";

  return `${SYSTEM_RULES.replace("__ORG__", orgName())}

=== DỮ LIỆU ĐÃ CHẤM (nguồn duy nhất được phép dùng) ===
Chiến dịch: ${name}
Nền tảng: ${platform === "google" ? "Google Ads" : "Facebook Ads"}
Kỳ số liệu: ${period.from} → ${period.to}
Điểm tổng: ${a.score === null ? "không chấm được" : `${a.score}/100`}
Kết luận máy chấm: ${a.verdict}
${a.gated
  ? `ĐANG TRONG GIAI ĐOẠN HỌC (hệ thống ĐÃ KHOÁ thao tác tắt/cắt ngân sách): ${a.gateReason}`
  : `KHÔNG bị khoá thao tác — được phép bàn tới việc tắt hoặc chỉnh ngân sách nếu số liệu đòi hỏi. Không dùng chữ "tuyệt đối không tắt".`}
${a.dataWarnings.length ? `Cảnh báo chất lượng dữ liệu: ${a.dataWarnings.join(" | ")}` : ""}

--- Năm trụ đánh giá ---
${pillarBlock}
--- Vấn đề phát hiện được: ${a.findings.length} mục ---
${findingBlock}
=== HẾT DỮ LIỆU ===`;
}

/**
 * Lấy utm_campaign của một chiến dịch Google rồi hỏi Odoo doanh thu tương ứng.
 *
 * Đếm luôn số chiến dịch KHÁC cùng dùng mỗi thẻ: đo 24/09 thì `domain_brand`
 * được BẢY chiến dịch dùng chung, nên doanh thu của thẻ đó không chia riêng
 * cho một chiến dịch được. Phải biết con số đó mới nói thật được.
 */
async function fetchGoogleCampaignOdooRevenue(campaignId: string, company: string) {
  const customer = getGoogleAdsCustomer(company);
  const numeric = Number(campaignId);
  if (!Number.isFinite(numeric)) throw new Error("campaignId không hợp lệ");

  const mine = (await customer.query(`
    SELECT ad_group_ad.ad.final_urls FROM ad_group_ad
    WHERE campaign.id = ${numeric} LIMIT 200
  `)) as Array<{ ad_group_ad?: { ad?: { final_urls?: unknown } } }>;

  const tags = new Set<string>();
  for (const r of mine) {
    const urls = r.ad_group_ad?.ad?.final_urls;
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      const t = extractUtmCampaign(String(u));
      if (t) tags.add(t);
    }
  }
  if (tags.size === 0) return fetchCampaignRevenue([]);

  // Thẻ này còn chiến dịch nào khác dùng không.
  const all = (await customer.query(`
    SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad
    WHERE campaign.status != 'REMOVED' LIMIT 2000
  `)) as Array<{ campaign?: { id?: unknown }; ad_group_ad?: { ad?: { final_urls?: unknown } } }>;

  const shared = new Map<string, Set<string>>();
  for (const r of all) {
    const urls = r.ad_group_ad?.ad?.final_urls;
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      const t = extractUtmCampaign(String(u));
      if (!t || !tags.has(t)) continue;
      if (!shared.has(t)) shared.set(t, new Set());
      shared.get(t)!.add(String(r.campaign?.id ?? ""));
    }
  }
  const counts = new Map(Array.from(shared, ([t, set]) => [t, set.size]));
  return fetchCampaignRevenue(Array.from(tags), counts);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`campaign-analysis:${user.id}`, RATE_MAX, RATE_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: "Bạn đang yêu cầu phân tích quá nhanh. Đợi một chút rồi thử lại." },
      { status: 429 }
    );
  }

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const platform = (sp.get("platform") === "google" ? "google" : "facebook") as AnalysisPlatform;
  const company = sp.get("company") as string | null;
  const wantAi = sp.get("ai") !== "0";

  if (platform === "google" && !company) {
    return NextResponse.json(
      { error: "Thiếu thông tin công ty để đọc chiến dịch Google" },
      { status: 400 }
    );
  }
  if (company && !canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Không có quyền xem công ty này" }, { status: 403 });
  }

  // Dùng lại ĐÚNG đường dữ liệu mà trang chi tiết đang hiển thị, thay vì gọi
  // thẳng Meta/Google lần nữa. Nhờ vậy phần phân tích không bao giờ nói một
  // con số khác với con số người dùng đang nhìn thấy ngay phía trên nó.
  const cookie = request.headers.get("cookie") ?? "";
  const baseUrl = process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const detailPath = platform === "google"
    ? `/api/google/campaigns/${id}?company=${company}`
    : `/api/meta/campaigns/${id}`;

  let detail: CampaignDetailResponse;
  try {
    const res = await fetch(`${baseUrl}${detailPath}`, { headers: { cookie } });
    detail = (await res.json()) as CampaignDetailResponse;
    if (!res.ok || detail.error) {
      return NextResponse.json(
        { error: detail.error ?? `Không đọc được dữ liệu chiến dịch (HTTP ${res.status})` },
        { status: res.status === 200 ? 502 : res.status }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Không đọc được dữ liệu chiến dịch: ${err instanceof Error ? err.message : "lỗi không rõ"}` },
      { status: 502 }
    );
  }

  if (!detail.campaign || !detail.metrics) {
    return NextResponse.json({ error: "Dữ liệu chiến dịch trả về không đủ để phân tích" }, { status: 502 });
  }

  // Meta dùng CHUNG một tài khoản quảng cáo cho cả hai công ty — công ty chỉ
  // suy được từ tên chiến dịch. Route chi tiết bên Meta đã tự kiểm quyền theo
  // cách đó; lặp lại ở đây để phần phân tích không thành đường vòng đọc trộm
  // dữ liệu công ty khác.
  const effectiveCompany = platform === "google"
    ? company
    : detectCompany(detail.campaign.name ?? "");
  if (effectiveCompany && !canAccessCompany(user, effectiveCompany)) {
    return NextResponse.json({ error: "Không có quyền xem chiến dịch này" }, { status: 403 });
  }

  const period = detail.period ?? { from: "", to: "" };
  const input: AnalysisInput = {
    platform,
    company: effectiveCompany ?? null,
    campaign: detail.campaign,
    metrics: detail.metrics,
    adsets: detail.adsets ?? [],
    daily: detail.daily ?? [],
    period,
    // Đợt 23 (3b): CPL mục tiêu ở Xử lý chiến dịch → Mục tiêu (chỉ khi đã nhập; chưa → ngưỡng cũ trong analyzeCampaign).
    leadTarget: (() => {
      if (!effectiveCompany) return null;
      const t = resolveTarget({ company: effectiveCompany, campaignName: detail.campaign.name, goalKind: "leads" });
      return t && t.source === "case_target_cpl" ? { target: t.target, ceiling: t.ceiling, source: t.source } : null;
    })(),
  };

  const analysis = analyzeCampaign(input);

  // ── P2: doanh thu THẬT từ Odoo, đặt cạnh doanh thu nền tảng tự báo ──────
  // Khoá nối là utm_campaign trong final URL, KHÔNG phải tên chiến dịch —
  // Odoo lưu "domain_brand" còn Google gọi "GS_Digital_Domain_Brand_HCM_01_11".
  // Chỉ làm được cho Google: Meta không cho đọc final URL của quảng cáo qua
  // đường dữ liệu đang dùng ở đây.
  // Hỏng thì bỏ qua — đây là lớp bổ sung, không được làm chết phần chấm điểm.
  let odooRevenue: Awaited<ReturnType<typeof fetchCampaignRevenue>> | null = null;
  let odooError: string | null = null;
  if (platform === "google" && effectiveCompany) {
    try {
      odooRevenue = await fetchGoogleCampaignOdooRevenue(id, effectiveCompany);
    } catch (e) {
      odooError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Phần diễn giải bằng AI (tuỳ chọn, hỏng thì vẫn trả phần chấm điểm) ──
  let narrative: string | null = null;
  let narrativeError: string | null = null;
  if (wantAi) {
    try {
      const out = await callGemini(
        buildPrompt(detail.campaign.name, platform, analysis, period),
        { temperature: 0.3, maxOutputTokens: 900, thinkingBudget: 0, timeoutMs: 25_000 }
      );
      narrative = out.text?.trim() || null;
      if (!narrative) narrativeError = "Mô hình trả về nội dung rỗng.";
    } catch (err) {
      // Nói ra lỗi thay vì im lặng bỏ phần diễn giải — người dùng phải biết
      // họ đang đọc bản thiếu, không phải bản đầy đủ.
      narrativeError = err instanceof Error ? err.message : "Không gọi được mô hình phân tích.";
    }
  }

  return NextResponse.json({
    campaignId: id,
    campaignName: detail.campaign.name,
    platform,
    company: effectiveCompany,
    period,
    // Ngân sách ngày hiện tại — cần cho nút "giảm ngân sách" biết mốc xuất phát.
    dailyBudget: detail.campaign.dailyBudget ?? 0,
    status: detail.campaign.status,
    analysis,
    narrative,
    narrativeError,
    // Doanh thu Odoo — CÓ THỂ null. Khi có, luôn kèm `note` giải thích độ phủ
    // và việc có chia riêng cho chiến dịch này được không.
    odooRevenue,
    odooError,
  });
}
