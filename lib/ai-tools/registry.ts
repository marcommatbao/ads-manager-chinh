// ─────────────────────────────────────────────
// AdsBot — bộ công cụ truy vấn, TOÀN BỘ CHỈ ĐỌC
//
// Trước đây ngữ cảnh chat được nạp sẵn: chi tiêu 7 ngày cố định tách theo kênh
// + 12 improvement. Vì thế những câu như "chiến dịch MBC mục tiêu Xem Trang
// Đích tháng này chi bao nhiêu" là không trả lời được — không có danh sách
// campaign, không có trường objective, không có mốc thời gian tuỳ ý. Nhồi thêm
// cả trăm campaign vào mỗi lượt chat thì tốn token mà vẫn không mở rộng nổi
// sang câu hỏi ngoài dự kiến. Nên: để model tự gọi hàm lấy đúng thứ nó cần.
//
// LẰN RANH KHÔNG ĐƯỢC VƯỢT: không tool nào được GHI. Repo này từng có
// `AIChatbot.executeFunction` in ra "đã được thực thi trên server" cho lệnh
// pause và đổi ngân sách mà không gọi API nào — nó chỉ vô hại vì route khi đó
// 404. Đã bị gỡ ở a49589c. Muốn AdsBot thao tác thật thì phải là mini-spec
// riêng có bước xác nhận của người dùng, không lẫn vào đây.
//
// Phạm vi công ty ép ở server: tham số `company` do model đưa chỉ là ĐỀ NGHỊ,
// luôn được giao với quyền thật của người đang chat.
// ─────────────────────────────────────────────
import type { SessionUser } from "@/lib/auth";
import { getCompaniesForRole, canAccessCompany } from "@/lib/permissions";
import { creativeBrandFor, isLegacyCreativeCompany } from "@/lib/brand/creative";
// Kiểu lấy TỪ CHÍNH nguồn trả dữ liệu, không khai lại ở đây. Khai lại là mở
// đường cho sai tên trường: sai tên thì `undefined` lặng lẽ đi tới model, ra
// câu trả lời trống — hoặc tệ hơn, model diễn giải quanh chỗ trống nghe như
// số thật. Nhập kiểu thật thì sai tên là lỗi biên dịch.
import type { CompareResult } from "@/lib/creative-compare";
import type { PMaxRecommendation, PMaxDiagnosis } from "@/lib/pmax-insights/types";
import type { KeywordMetric } from "@/lib/google-keyword-planner";
import type { CPLResult } from "@/lib/cpl-calculator";
import type { GA4CampaignData } from "@/lib/ga4-client";
import { companyIds } from "@/lib/companies"
import { isCompany } from "@/lib/companies/registry";

/** Trần dòng mỗi tool — vượt thì cắt và NÓI RÕ là đã cắt. */
const MAX_ROWS = 50;

export interface ToolContext {
  user: SessionUser;
  cookie: string;
  baseUrl: string;
  /** Hạn mức cho MỘT tin nhắn, dùng chung cho mọi vòng gọi công cụ. Xem
   *  `spendBudget` bên dưới. */
  budget: { expensiveLeft: number };
}

export interface ToolResult {
  [key: string]: unknown;
}

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

interface ToolDef {
  declaration: Record<string, unknown>;
  handler: ToolHandler;
}

// ── Helper ───────────────────────────────────────────────

/** Lấy câu lỗi THẬT mà route đã viết, thay vì chỉ còn mã HTTP.
 *
 *  Các route ở đây trả `{success:false, error:"..."}` KÈM mã 4xx/5xx. Nuốt mất
 *  câu đó thì model chỉ có "HTTP 502" để nói với người dùng, trong khi lý do
 *  thật ("Không có quyền chỉnh sửa nội dung quảng cáo", "Rate limit — thử lại
 *  sau 30 giây", "Campaign not found") mới là thứ cho họ biết phải làm gì. */
async function describeHttpFailure(res: Response, path: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    /* thân phản hồi không phải JSON — rơi về mã HTTP */
  }
  return `HTTP ${res.status} khi gọi ${path}`;
}

async function internalGet<T>(path: string, ctx: ToolContext): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, { headers: { cookie: ctx.cookie } });
  if (!res.ok) throw new Error(await describeHttpFailure(res, path));
  return (await res.json()) as T;
}

async function internalPost<T>(path: string, body: unknown, ctx: ToolContext): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: ctx.cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeHttpFailure(res, path));
  return (await res.json()) as T;
}

/** Hạn mức lượt gọi AI SINH NỘI DUNG trong một tin nhắn.
 *
 *  Vài công cụ dưới đây mỗi lượt lại kích một lượt gọi Gemini THẬT ở phía
 *  server (sinh/cải thiện creative, phân tích đối tượng, viết lại RSA, chẩn
 *  đoán PMax). Không chặn thì một câu hỏi mơ hồ có thể kéo model gọi liên tiếp
 *  qua 3 vòng × nhiều lời gọi song song — repo này đã có tiền lệ một công cụ
 *  gọi API trả phí không trần và đốt tiền thật.
 *
 *  PHẢI gọi hàm này ở DÒNG ĐẦU của handler, TRƯỚC mọi `await`: Promise.all
 *  chạy thân mỗi hàm async đồng bộ cho tới `await` đầu tiên, nên trừ trước khi
 *  await chính là thứ khiến các lời gọi song song trong cùng một vòng không
 *  cùng nhìn thấy một hạn mức chưa bị trừ. */
function spendBudget(ctx: ToolContext): string | null {
  if (ctx.budget.expensiveLeft <= 0) {
    return "Đã tới giới hạn 3 lượt gọi AI sinh nội dung cho một tin nhắn. Hỏi từng việc một, hoặc gửi tin nhắn mới.";
  }
  ctx.budget.expensiveLeft--;
  return null;
}

/** Tham số bắt buộc nào đang THIẾU. Trả ra để handler bảo model đi hỏi người
 *  dùng, thay vì gửi đi một request chắc chắn hỏng rồi báo lại một câu lỗi kỹ
 *  thuật khó hiểu — hoặc tệ hơn, tự bịa ra giá trị cho đủ. */
function missingParams(args: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => {
    const v = args[k];
    if (Array.isArray(v)) return v.length === 0;
    return typeof v !== "string" || v.trim().length === 0;
  });
}

/** Chuỗi sạch hoặc undefined — không đẩy "" hay kiểu lạ xuống route. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Mảng chuỗi sạch. Mọi route nhận mảng dưới đây đều đọc `.length`/`.map`
 *  NGOÀI try/catch của nó, nên gửi thiếu là 500 chứ không phải 400. */
function strArray(v: unknown, limit = MAX_ROWS): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, limit);
}

/** Giao đề nghị của model với quyền thật. Không bao giờ tin tham số model đưa. */
function resolveCompanies(user: SessionUser, requested: unknown): {
  companies: Array<string>;
  note?: string;
} {
  const allowed = getCompaniesForRole(user);
  const want = typeof requested === "string" ? requested.toUpperCase() : "";

  if (isCompany(want)) {
    if (allowed.includes(want as string)) return { companies: [want as string] };
    return {
      companies: allowed,
      note: `Người dùng không có quyền xem ${want}; kết quả dưới đây chỉ gồm ${allowed.join(", ") || "không công ty nào"}.`,
    };
  }
  return { companies: allowed };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRange(args: Record<string, unknown>): { from: string; to: string; note?: string } {
  const from = typeof args.from === "string" && ISO_DATE.test(args.from) ? args.from : null;
  const to = typeof args.to === "string" && ISO_DATE.test(args.to) ? args.to : null;
  if (from && to && from <= to) return { from, to };

  const today = new Date();
  const toStr = today.toISOString().slice(0, 10);
  const fromStr = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return {
    from: fromStr,
    to: toStr,
    note: "Không nhận được khoảng ngày hợp lệ nên đã dùng mặc định 30 ngày gần nhất.",
  };
}

function cap<T>(rows: T[]): { rows: T[]; truncated: boolean; totalBeforeCap: number } {
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, totalBeforeCap: rows.length };
}

// ── Kiểu dữ liệu tối thiểu từ các route đã có ────────────

interface CampaignLike {
  id?: string;
  name?: string;
  platform?: string;
  status?: string;
  objective?: string;
  company?: string;
  metrics?: { spend?: number; clicks?: number; impressions?: number; leads?: number; conversions?: number };
}

// ── Tool 1: query_campaigns ──────────────────────────────

const queryCampaigns: ToolDef = {
  declaration: {
    name: "query_campaigns",
    description:
      "Liệt kê chiến dịch quảng cáo kèm chi phí, click, lead, CPL. Lọc được theo công ty (MBC/MBI), " +
      "nền tảng (facebook/google), mục tiêu chiến dịch Facebook (vd OUTCOME_TRAFFIC = Xem Trang Đích, " +
      "OUTCOME_SALES = Doanh số, OUTCOME_LEADS = Khách hàng tiềm năng), trạng thái và khoảng ngày. " +
      "Dùng khi người dùng hỏi về danh sách chiến dịch, chi phí theo mục tiêu, hoặc chiến dịch nào đang chạy.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", enum: companyIds(), description: "Bỏ trống = tất cả công ty người dùng được xem" },
        platform: { type: "string", enum: ["facebook", "google"] },
        objective: { type: "string", description: "Mục tiêu Facebook, vd OUTCOME_TRAFFIC" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const range = resolveRange(args);
    const platform = typeof args.platform === "string" ? args.platform.toLowerCase() : null;
    const objective = typeof args.objective === "string" ? args.objective.toUpperCase() : null;
    const status = typeof args.status === "string" ? args.status.toUpperCase() : null;

    const q = `from=${range.from}&to=${range.to}`;
    const all: CampaignLike[] = [];
    const errors: string[] = [];

    if (platform !== "google") {
      for (const st of status ? [status] : ["ACTIVE", "PAUSED"]) {
        try {
          const r = await internalGet<{ campaigns?: CampaignLike[] }>(`/api/meta/campaigns?status=${st}&${q}`, ctx);
          all.push(...(r.campaigns ?? []).map((c) => ({ ...c, platform: "facebook" })));
        } catch (e) {
          errors.push(`Facebook ${st}: ${e instanceof Error ? e.message : "lỗi"}`);
        }
      }
    }
    if (platform !== "facebook") {
      for (const co of companies) {
        try {
          const r = await internalGet<{ campaigns?: CampaignLike[] }>(`/api/google/campaigns?company=${co}&${q}`, ctx);
          all.push(...(r.campaigns ?? []).map((c) => ({ ...c, platform: "google", company: co })));
        } catch (e) {
          errors.push(`Google ${co}: ${e instanceof Error ? e.message : "lỗi"}`);
        }
      }
    }

    const filtered = all.filter((c) => {
      const co = (c.company ?? "").toUpperCase();
      if (co && !companies.includes(co as string)) return false;
      if (objective && (c.objective ?? "").toUpperCase() !== objective) return false;
      if (status && (c.status ?? "").toUpperCase() !== status) return false;
      return true;
    });

    filtered.sort((a, b) => (b.metrics?.spend ?? 0) - (a.metrics?.spend ?? 0));
    const { rows, truncated, totalBeforeCap } = cap(filtered);

    const totalSpend = filtered.reduce((s, c) => s + (c.metrics?.spend ?? 0), 0);
    const totalLeads = filtered.reduce((s, c) => s + (c.metrics?.leads ?? c.metrics?.conversions ?? 0), 0);

    return {
      window: range,
      windowNote: range.note,
      scopeNote: note,
      companies,
      campaignCount: totalBeforeCap,
      totalSpend: Math.round(totalSpend),
      totalLeads: Math.round(totalLeads),
      truncated,
      truncatedNote: truncated ? `Chỉ liệt kê ${MAX_ROWS} chiến dịch chi nhiều nhất trong tổng ${totalBeforeCap}.` : undefined,
      dataErrors: errors.length ? errors : undefined,
      campaigns: rows.map((c) => ({
        // id là thứ DUY NHẤT nối được sang compare_ad_creatives /
        // get_pmax_diagnosis. Không trả ra thì model chỉ còn cách tự nghĩ ra
        // một id — đúng cái kiểu bịa mà cả tệp này sinh ra để chặn.
        id: c.id,
        name: c.name,
        platform: c.platform,
        company: c.company,
        status: c.status,
        objective: c.objective,
        spend: Math.round(c.metrics?.spend ?? 0),
        clicks: c.metrics?.clicks ?? 0,
        leads: Math.round(c.metrics?.leads ?? c.metrics?.conversions ?? 0),
      })),
    };
  },
};

// ── Tool 2: get_spend_summary ────────────────────────────

const getSpendSummary: ToolDef = {
  declaration: {
    name: "get_spend_summary",
    description:
      "Tổng chi tiêu, lead và CPL theo kênh (Facebook/Google) trong một khoảng ngày. " +
      "Dùng cho câu hỏi tổng quan về hiệu suất, không cần danh sách chiến dịch.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", enum: companyIds() },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const range = resolveRange(args);
    const scope = companies.length === 1 ? companies[0] : "ALL";

    try {
      const u = await internalGet<{
        summary?: Record<string, { spend?: number; leads?: number; clicks?: number; leadsBasis?: string }>;
      }>(`/api/dashboard/unified?company=${scope}&from=${range.from}&to=${range.to}`, ctx);

      const out: Record<string, unknown> = {};
      for (const key of ["facebook", "google"]) {
        const d = u.summary?.[key];
        if (!d) continue;
        const spend = d.spend ?? 0;
        const leads = d.leads ?? 0;
        out[key] = {
          spend: Math.round(spend),
          leads: Math.round(leads),
          cpl: leads > 0 ? Math.round(spend / leads) : null,
          leadsBasis: d.leadsBasis,
        };
      }
      return { window: range, windowNote: range.note, scopeNote: note, scope, channels: out };
    } catch (e) {
      return { error: `Không lấy được dữ liệu chi tiêu: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 3: list_improvements ────────────────────────────

const listImprovements: ToolDef = {
  declaration: {
    name: "list_improvements",
    description: "Danh sách đề xuất tối ưu đang mở của hệ thống (Improvements), kèm mức ưu tiên và giá trị ước tính.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", enum: companyIds() },
        priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    const priority = typeof args.priority === "string" ? args.priority.toUpperCase() : null;

    try {
      const r = await internalGet<{
        improvements?: Array<{ priority?: string; type?: string; title?: string; campaignName?: string; impactValue?: number; status?: string }>;
      }>(`/api/improvements?company=${company}`, ctx);
      const active = (r.improvements ?? []).filter(
        (i) => i.status === "ACTIVE" && (!priority || i.priority === priority),
      );
      const { rows, truncated, totalBeforeCap } = cap(active);
      return {
        company,
        scopeNote: note,
        count: totalBeforeCap,
        truncated,
        improvements: rows.map((i) => ({
          priority: i.priority, type: i.type, title: i.title,
          campaign: i.campaignName, impactValue: i.impactValue,
        })),
      };
    } catch (e) {
      return { error: `Không lấy được improvements: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 4: get_policy_updates ───────────────────────────

const getPolicyUpdates: ToolDef = {
  declaration: {
    name: "get_policy_updates",
    description: "Thay đổi chính sách / thông báo sản phẩm gần đây từ Google Ads và Meta (Policy Radar).",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["google_ads", "meta"] },
        limit: { type: "number", description: "Mặc định 10" },
      },
    },
  },
  handler: async (args, ctx) => {
    const platform = typeof args.platform === "string" ? args.platform : null;
    const limit = Math.min(Number(args.limit) || 10, MAX_ROWS);
    try {
      const r = await internalGet<{
        items?: Array<{ title?: string; platform?: string; severity?: string; publishedAt?: string; summaryShort?: string; sourceUrl?: string }>;
      }>(`/api/policy-radar/items`, ctx);
      const items = (r.items ?? []).filter((i) => !platform || i.platform === platform).slice(0, limit);
      return {
        count: items.length,
        items: items.map((i) => ({
          title: i.title, platform: i.platform, severity: i.severity,
          publishedAt: i.publishedAt, summary: i.summaryShort, url: i.sourceUrl,
        })),
      };
    } catch (e) {
      return { error: `Không lấy được Policy Radar: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Nhóm công cụ SINH NHÁP (creative / audience / RSA) ───
//
// Mọi thứ nhóm này trả ra là BẢN NHÁP. Không route nào bên dưới ghi vào tài
// khoản quảng cáo — generate/improve-text chỉ gọi Gemini rồi trả chữ, rsa/suggest
// nói thẳng trong chính chú thích của nó là "never writes to Google". Lằn ranh ở
// đầu tệp vẫn nguyên: AdsBot đưa chữ cho người dùng, người dùng tự áp.

const TONE_IDS = ["professional", "urgent", "friendly", "authority", "fomo", "value"] as const;
const PLATFORMS = ["facebook", "google"] as const;
// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại). Khai báo công cụ dùng getter `enum` vì cùng lý do.

/** productId hợp lệ của /api/ai/audience-insight — đúng khoá trong PRODUCT_LABELS
 *  của route đó. Sai khoá thì route vẫn chạy nhưng mất toàn bộ kiến thức sản
 *  phẩm thật, và phân khúc sinh ra chỉ còn là trí nhớ chung của mô hình. */
const PRODUCT_IDS = [
  "ten-mien", "hosting", "microsoft-365", "google-workspace", "email-dn", "ssl",
  "sale-ai", "hoa-don-dien-tu", "chu-ky-so", "hop-dong-dien-tu", "hoa-don-ecom",
] as const;

/** Đợt 21 A3b: sản phẩm theo hồ sơ doanh nghiệp của các công ty NGOÀI gói Mắt Bão (bản cài khách) → `custom_<tên>`. */
function profileProductIds(): { id: string; company: string }[] {
  const out: { id: string; company: string }[] = [];
  for (const co of companyIds()) {
    if (isLegacyCreativeCompany(co)) continue;
    for (const p of creativeBrandFor(co).products) out.push({ id: p.id, company: co });
  }
  return out;
}

const DRAFT_NOTE =
  "BẢN NHÁP do AI viết — chưa đăng, chưa lưu, chưa áp vào tài khoản quảng cáo nào. " +
  "Người dùng tự xem lại rồi tự áp dụng trong Creative Studio.";

/** Giá trị enum hợp lệ (bỏ qua hoa/thường), hoặc undefined. Model hay trả
 *  "Facebook"/"MBC " — route thì so sánh === nên lệch một chữ hoa là rẽ nhầm
 *  nhánh mà không báo lỗi. */
function enumStr<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return allowed.find((a) => a.toLowerCase() === s);
}

interface DraftTextResponse {
  success?: boolean;
  error?: string;
  data?: {
    headline?: string; primaryText?: string; description?: string; cta?: string;
    score?: number; reason?: string;
    detailedScore?: unknown; withinLimits?: boolean; limitViolations?: unknown;
    complianceNotes?: unknown;
  };
}

// ── Tool 5: generate_ad_creative ─────────────────────────

const generateAdCreative: ToolDef = {
  declaration: {
    name: "generate_ad_creative",
    description:
      "Viết BẢN NHÁP nội dung quảng cáo mới (headline, primary text, description, CTA) cho một sản phẩm × một đối tượng × một tone, kèm điểm chấm và cảnh báo vượt giới hạn ký tự. " +
      "KHÔNG đăng, KHÔNG lưu, KHÔNG áp vào tài khoản quảng cáo — chỉ là nháp để người dùng tự dùng lại trong Creative Studio. " +
      "Thiếu product, segment hoặc tone thì PHẢI HỎI người dùng. TUYỆT ĐỐI không tự nghĩ ra USP, ưu đãi (offer) hay social proof — " +
      "chỉ điền những trường đó khi người dùng đã nói ra; bịa một ưu đãi không có thật là quảng cáo sai sự thật.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "Tên sản phẩm, vd 'Hosting'. Chưa biết thì HỎI, đừng đoán." },
        segment: { type: "string", description: "Mô tả đối tượng nhắm tới. Chưa biết thì HỎI, đừng đoán." },
        segmentName: { type: "string", description: "Tên ngắn của phân khúc" },
        tone: { type: "string", enum: [...TONE_IDS] },
        toneLabel: { type: "string", description: "Tên tiếng Việt của tone, vd 'Chuyên nghiệp'" },
        platform: { type: "string", enum: [...PLATFORMS] },
        funnelStage: { type: "string", description: "TOFU | MOFU | BOFU" },
        usp: { type: "string", description: "CHỈ điền khi người dùng đã nói ra" },
        socialProof: { type: "string", description: "CHỈ điền khi người dùng đã nói ra" },
        offer: { type: "string", description: "Ưu đãi. CHỈ điền khi người dùng đã nói ra" },
        objective: { type: "string", description: "Mục tiêu chiến dịch" },
        company: { type: "string", get enum() { return [...companyIds()] } },
      },
      required: ["product", "segment", "segmentName", "tone", "toneLabel", "platform"],
    },
  },
  handler: async (args, ctx) => {
    // Kiểm tham số TRƯỚC khi trừ hạn mức — cả hai bước đều đồng bộ và đều nằm
    // trước `await` đầu tiên, nên tính chống-đua của spendBudget giữ nguyên,
    // mà một lời gọi thiếu tham số (không hề chạm tới Gemini) thì không ăn
    // mất một suất của lời gọi hợp lệ sau nó.
    const missing = missingParams(args, ["product", "segment", "tone", "platform"]);
    if (missing.length > 0) {
      return { error: `Thiếu tham số bắt buộc: ${missing.join(", ")}. HỎI người dùng, không tự điền.` };
    }
    const platform = enumStr(args.platform, PLATFORMS);
    const tone = enumStr(args.tone, TONE_IDS);
    if (!platform) return { error: "platform phải là facebook hoặc google." };
    if (!tone) return { error: `tone phải là một trong: ${TONE_IDS.join(", ")}.` };

    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    const body = {
      product: str(args.product),
      segment: str(args.segment),
      segmentName: str(args.segmentName) ?? str(args.segment),
      tone,
      toneLabel: str(args.toneLabel) ?? tone,
      platform,
      funnelStage: str(args.funnelStage),
      usp: str(args.usp),
      socialProof: str(args.socialProof),
      offer: str(args.offer),
      objective: str(args.objective),
      company: enumStr(args.company, companyIds()),
    };

    try {
      const r = await internalPost<DraftTextResponse>("/api/creative/generate-text", body, ctx);
      if (!r.success || !r.data) return { error: r.error ?? "Không sinh được nội dung quảng cáo." };
      const d = r.data;
      return {
        platform, tone: body.toneLabel, segmentName: body.segmentName,
        draft: {
          headline: d.headline, primaryText: d.primaryText, description: d.description, cta: d.cta,
          score: d.score, reason: d.reason, detailedScore: d.detailedScore,
          withinLimits: d.withinLimits, limitViolations: d.limitViolations,
          complianceNotes: d.complianceNotes,
        },
        note: DRAFT_NOTE,
      };
    } catch (e) {
      return { error: `Không sinh được nội dung: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 6: improve_ad_creative ──────────────────────────

const improveAdCreative: ToolDef = {
  declaration: {
    name: "improve_ad_creative",
    description:
      "Cải thiện một mẩu quảng cáo ĐÃ CÓ: người dùng đưa headline/primary text/description/CTA hiện tại, công cụ trả BẢN NHÁP viết lại tốt hơn. " +
      "Nội dung gốc PHẢI do người dùng cung cấp — nếu chưa có thì HỎI, tuyệt đối không tự bịa ra một mẩu quảng cáo rồi tự cải thiện nó. " +
      "Kết quả chỉ là nháp để người dùng tự áp dụng, không ghi vào tài khoản quảng cáo.",
    parameters: {
      type: "object",
      properties: {
        headline: { type: "string", description: "Headline hiện tại — do người dùng đưa" },
        primaryText: { type: "string", description: "Primary text hiện tại — do người dùng đưa" },
        description: { type: "string", description: "Description hiện tại — do người dùng đưa" },
        cta: { type: "string", description: "CTA hiện tại — do người dùng đưa" },
        platform: { type: "string", enum: [...PLATFORMS] },
        product: { type: "string" },
        segmentName: { type: "string", description: "Đối tượng của mẩu quảng cáo này" },
        funnelStage: { type: "string" },
        tone: { type: "string", enum: [...TONE_IDS] },
        toneLabel: { type: "string" },
        usp: { type: "string", description: "CHỈ điền khi người dùng đã nói ra" },
        socialProof: { type: "string", description: "CHỈ điền khi người dùng đã nói ra" },
        offer: { type: "string", description: "CHỈ điền khi người dùng đã nói ra" },
        weakPoints: {
          type: "array", items: { type: "string" },
          description: "Điểm yếu người dùng muốn sửa, vd 'CTA chưa rõ'",
        },
      },
      required: ["headline", "primaryText", "description", "cta", "platform", "product", "segmentName"],
    },
  },
  handler: async (args, ctx) => {
    const missing = missingParams(args, ["headline", "primaryText", "platform", "product"]);
    if (missing.length > 0) {
      return {
        error: `Thiếu ${missing.join(", ")}. Nội dung quảng cáo gốc phải do NGƯỜI DÙNG đưa — hỏi họ, đừng tự viết ra rồi tự sửa.`,
      };
    }
    const platform = enumStr(args.platform, PLATFORMS);
    if (!platform) return { error: "platform phải là facebook hoặc google." };

    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    const body = {
      headline: str(args.headline) ?? "",
      primaryText: str(args.primaryText) ?? "",
      description: str(args.description) ?? "",
      cta: str(args.cta) ?? "",
      platform,
      product: str(args.product) ?? "",
      segmentName: str(args.segmentName) ?? "",
      funnelStage: str(args.funnelStage),
      tone: enumStr(args.tone, TONE_IDS),
      toneLabel: str(args.toneLabel),
      usp: str(args.usp),
      socialProof: str(args.socialProof),
      offer: str(args.offer),
      // Hai trường này route đọc NGOÀI try/catch của nó (Object.entries(scores)
      // và suggestions.length). Thiếu là 500 chứ không phải 400 — nên luôn gửi,
      // kể cả rỗng. scores rỗng thì route tự ghi "Cải thiện tổng thể".
      scores: {},
      suggestions: strArray(args.weakPoints),
    };

    try {
      const r = await internalPost<DraftTextResponse>("/api/creative/improve-text", body, ctx);
      if (!r.success || !r.data) return { error: r.error ?? "Không cải thiện được nội dung." };
      const d = r.data;
      return {
        platform,
        original: { headline: body.headline, primaryText: body.primaryText, description: body.description, cta: body.cta },
        improved: {
          headline: d.headline, primaryText: d.primaryText, description: d.description, cta: d.cta,
          score: d.score, reason: d.reason,
        },
        note: DRAFT_NOTE,
      };
    } catch (e) {
      return { error: `Không cải thiện được nội dung: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 7: compare_ad_creatives ─────────────────────────

const compareAdCreatives: ToolDef = {
  declaration: {
    name: "compare_ad_creatives",
    description:
      "So sánh hiệu quả HAI CHIẾN DỊCH Facebook theo toàn bộ vòng đời: chi phí, CTR, CPA, tỷ lệ chuyển đổi, chỉ số video (hook/hold rate), kèm kiểm định ý nghĩa thống kê và kết luận nên giữ cái nào. " +
      "BẮT BUỘC: hai campaign id phải lấy từ trường `id` mà query_campaigns trả về — KHÔNG tự bịa id. " +
      "Chỉ so ở cấp CHIẾN DỊCH (chat không có id từng mẩu quảng cáo).",
    parameters: {
      type: "object",
      properties: {
        campaignIdA: { type: "string", description: "id chiến dịch thứ nhất, lấy từ query_campaigns" },
        campaignIdB: { type: "string", description: "id chiến dịch thứ hai, lấy từ query_campaigns" },
      },
      required: ["campaignIdA", "campaignIdB"],
    },
  },
  handler: async (args, ctx) => {
    const missing = missingParams(args, ["campaignIdA", "campaignIdB"]);
    if (missing.length > 0) {
      return { error: `Thiếu ${missing.join(", ")}. Gọi query_campaigns trước để lấy id thật, đừng tự nghĩ ra id.` };
    }
    const a = str(args.campaignIdA)!;
    const b = str(args.campaignIdB)!;
    if (a === b) return { error: "Hai id trùng nhau — cần hai chiến dịch khác nhau." };

    // buildNarrative bên trong route có thể gọi Gemini (best-effort). Không
    // chắc chắn tốn tiền như nhóm sinh nháp, nhưng vẫn tính vào hạn mức cho an toàn.
    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    try {
      const r = await internalPost<{ success?: boolean; error?: string; data?: CompareResult }>(
        "/api/campaigns/ads-content/compare",
        { ids: [a, b], level: "campaign" },
        ctx,
      );
      if (!r.success || !r.data) return { error: r.error ?? "Không so sánh được hai chiến dịch." };
      const d = r.data;

      const side = (s: CompareResult["a"]) => ({
        campaignId: s.campaignId,
        campaignName: s.campaignName,
        objective: s.campaignObjective,
        adCount: s.adCount,
        videoCount: s.videoCount,
        window: s.window,
        metrics: {
          spend: Math.round(s.metrics.spend),
          impressions: s.metrics.impressions,
          clicks: s.metrics.clicks,
          ctr: s.metrics.ctr,
          cpc: Math.round(s.metrics.cpc),
          cpm: Math.round(s.metrics.cpm),
          frequency: s.metrics.frequency,
          conversions: s.metrics.conversions,
          cpa: s.metrics.cpa,
          cvr: s.metrics.cvr,
          roas: s.metrics.roas,
        },
        video: s.video && {
          hookRate: s.video.hookRate,
          holdRate: s.video.holdRate,
          completionRate: s.video.completionRate,
          avgWatchSeconds: s.video.avgWatchSeconds,
        },
        notes: s.notes?.length ? s.notes : undefined,
      });

      return {
        a: side(d.a),
        b: side(d.b),
        // Mức "so sánh được tới đâu" phải đi kèm kết luận, không thì người đọc
        // tưởng mọi chênh lệch đều là do nội dung.
        comparabilityLevel: d.comparabilityLevel,
        comparability: cap(d.comparability ?? []).rows.map((c) => ({
          label: c.label, level: c.level, detail: c.detail,
        })),
        verdicts: cap(d.verdicts ?? []).rows.map((v) => ({
          label: v.label, meaning: v.meaning,
          aValue: v.aValue, bValue: v.bValue, unit: v.unit,
          lowerIsBetter: v.lowerIsBetter, winner: v.winner,
          deltaPercent: v.deltaPercent, confidence: v.confidence, significant: v.significant,
          insufficientReason: v.insufficientReason,
        })),
        summary: d.summary,
        decidedBy: d.decidedBy,
        recommendations: cap(d.recommendations ?? []).rows.map((x) => ({
          priority: x.priority, title: x.title, evidence: x.evidence, action: x.action,
        })),
        narrative: d.narrative?.text ?? undefined,
        warnings: d.warnings?.length ? d.warnings : undefined,
      };
    } catch (e) {
      return { error: `Không so sánh được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 8: analyze_audience_segments ────────────────────

interface AudienceSegmentLike {
  segmentName?: string;
  priority?: number;
  funnelStage?: string;
  demographics?: { age?: string; gender?: string; location?: string[] };
  painPoints?: string[];
  messagingAngle?: string;
  estimatedCTR?: string;
  whyThisSegment?: string;
  recommendedTones?: string[];
  facebookTargeting?: unknown;
  googleTargeting?: unknown;
}

const analyzeAudienceSegments: ToolDef = {
  declaration: {
    name: "analyze_audience_segments",
    description:
      "Phân tích và đề xuất các PHÂN KHÚC ĐỐI TƯỢNG cho một sản phẩm: nhân khẩu học, nỗi đau, góc tiếp cận thông điệp, CTR ước tính, bộ nhắm mục tiêu Facebook (interests/behaviors) hoặc Google (search intent/negative keywords). " +
      "productId PHẢI là một trong danh sách cho sẵn — sản phẩm khác thì HỎI người dùng xem gần nhất với mục nào, đừng tự suy. " +
      "Kết quả là ĐỀ XUẤT để người dùng tự dùng ở bước Đối tượng trong Creative Studio, không tạo ad set nào cả.",
    parameters: {
      type: "object",
      properties: {
        get productId() { return { type: "string", enum: [...(companyIds().some(isLegacyCreativeCompany) ? PRODUCT_IDS : []), ...profileProductIds().map((x) => x.id)] } },
        campaignObjective: { type: "string", description: "Mục tiêu chiến dịch" },
        funnelStage: { type: "string", description: "TOFU | MOFU | BOFU, hoặc 'TOFU+MOFU'" },
        platform: { type: "string", enum: ["facebook", "google", "both"], description: "Mặc định facebook" },
      },
      required: ["productId"],
    },
  },
  handler: async (args, ctx) => {
    // Đợt 21 A3b: sản phẩm Mắt Bão (kho kiến thức) HOẶC sản phẩm trong hồ sơ của công ty bản cài khách mà người này được xem.
    const own = profileProductIds().filter((x) => canAccessCompany(ctx.user, x.company));
    const legacyId = companyIds().some(isLegacyCreativeCompany) ? enumStr(args.productId, PRODUCT_IDS) : null;
    const ownHit = legacyId ? null : own.find((x) => x.id === args.productId) ?? null;
    const productId = legacyId ?? ownHit?.id ?? null;
    if (!productId) {
      const allowed = [...(companyIds().some(isLegacyCreativeCompany) ? PRODUCT_IDS : []), ...own.map((x) => x.id)];
      return {
        error: allowed.length
          ? `productId phải là một trong: ${allowed.join(", ")}. Hỏi người dùng sản phẩm nào, đừng đoán.`
          : "Chưa có sản phẩm nào — Super Admin cần điền sản phẩm ở Cài đặt → Hồ sơ doanh nghiệp.",
      };
    }
    const platform = enumStr(args.platform, ["facebook", "google", "both"] as const) ?? "facebook";

    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    try {
      const r = await internalPost<{
        success?: boolean; error?: string;
        data?: { audienceSegments?: AudienceSegmentLike[]; campaignStrategy?: unknown };
        grounding?: { globalWarnings?: string[] } | null;
        groundingError?: string;
        lens?: string;
      }>(
        "/api/ai/audience-insight",
        {
          productId,
          ...(ownHit ? { company: ownHit.company } : {}),
          campaignObjective: str(args.campaignObjective),
          funnelStage: str(args.funnelStage),
          platform,
          adSetCount: 3,
        },
        ctx,
      );
      if (!r.success || !r.data) return { error: r.error ?? "Không phân tích được đối tượng." };

      const segments = cap(r.data.audienceSegments ?? []).rows.map((s) => ({
        segmentName: s.segmentName,
        priority: s.priority,
        funnelStage: s.funnelStage,
        demographics: s.demographics && {
          age: s.demographics.age, gender: s.demographics.gender, location: s.demographics.location,
        },
        painPoints: s.painPoints,
        messagingAngle: s.messagingAngle,
        estimatedCTR: s.estimatedCTR,
        whyThisSegment: s.whyThisSegment,
        recommendedTones: s.recommendedTones,
        // Chỉ trả bộ nhắm mục tiêu của nền tảng thật sự có mặt.
        facebookTargeting: s.facebookTargeting,
        googleTargeting: s.googleTargeting,
      }));

      // globalWarnings là chỗ hệ thống nói "điều AI khẳng định KHÔNG tra được
      // trong kho kiến thức sản phẩm". Bỏ qua nó là vứt đúng lớp kiểm chứng
      // sinh ra để chống bịa.
      const warnings = r.grounding?.globalWarnings;

      return {
        productId, platform,
        lens: r.lens,
        lensNote: r.lens ? `Mẻ này phân khúc theo góc nhìn "${r.lens}" (hệ thống bốc ngẫu nhiên mỗi lần để tránh lối mòn).` : undefined,
        segmentCount: segments.length,
        segments,
        campaignStrategy: r.data.campaignStrategy,
        groundingWarnings: warnings?.length ? warnings : undefined,
        groundingError: r.groundingError,
        note: "Đề xuất phân khúc — chưa tạo ad set nào. Người dùng tự dùng lại ở bước Đối tượng.",
      };
    } catch (e) {
      return { error: `Không phân tích được đối tượng: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 9: get_pmax_recommendations ─────────────────────

/** Ngày hợp lệ thì gắn vào query, không thì để route tự chọn mặc định. */
function optionalRange(args: Record<string, unknown>): string {
  const from = typeof args.from === "string" && ISO_DATE.test(args.from) ? args.from : null;
  const to = typeof args.to === "string" && ISO_DATE.test(args.to) ? args.to : null;
  return from && to && from <= to ? `&from=${from}&to=${to}` : "";
}

const getPmaxRecommendations: ToolDef = {
  declaration: {
    name: "get_pmax_recommendations",
    description:
      "Danh sách đề xuất của AI Advisor cho các chiến dịch Google Performance Max (PMax): nên mở rộng, tinh chỉnh search theme, làm mới creative hay giữ nguyên — kèm căn cứ, độ tin cậy, mức ngân sách đề xuất và guardrail. " +
      "Dùng khi người dùng hỏi 'PMax nên làm gì', 'campaign nào nên tăng ngân sách'.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", get enum() { return [...companyIds()] } },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];

    try {
      const r = await internalGet<{ success?: boolean; error?: string; data?: PMaxRecommendation[] }>(
        `/api/google/pmax/advisor?company=${company}${optionalRange(args)}`,
        ctx,
      );
      if (!r.success || !r.data) return { error: r.error ?? "Không lấy được đề xuất PMax." };
      const { rows, truncated, totalBeforeCap } = cap(r.data);
      return {
        company,
        scopeNote: note,
        count: totalBeforeCap,
        truncated,
        recommendations: rows.map((x) => ({
          campaignId: x.campaignId,
          campaignName: x.campaignName,
          assetGroupId: x.assetGroupId,
          searchCategoryLabel: x.searchCategoryLabel,
          type: x.type,
          priority: x.priority,
          title: x.title,
          reason: x.reason,
          evidence: x.evidence,
          confidencePct: x.confidencePct,
          expectedImpact: x.expectedImpact,
          guardrail: x.guardrail,
          reviewState: x.reviewState,
          budgetProposal: x.budgetProposal,
          budgetBlockedReason: x.budgetBlockedReason,
        })),
        note: "Đề xuất để người dùng tự xem và tự áp trong tab PMax — AdsBot không áp dụng gì.",
      };
    } catch (e) {
      return { error: `Không lấy được đề xuất PMax: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 10: get_pmax_diagnosis ──────────────────────────

const getPmaxDiagnosis: ToolDef = {
  declaration: {
    name: "get_pmax_diagnosis",
    description:
      "Chẩn đoán CHI TIẾT một chiến dịch PMax (hoặc một asset group trong đó): cái gì đang chạy tốt, cái gì đang kìm hiệu quả, nguyên nhân gốc, có an toàn để mở rộng không. " +
      "campaignId PHẢI lấy từ query_campaigns hoặc get_pmax_recommendations — KHÔNG tự bịa id.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", get enum() { return [...companyIds()] } },
        campaignId: { type: "string", description: "id chiến dịch PMax, lấy từ công cụ khác" },
        assetGroupId: { type: "string", description: "Bỏ trống = chẩn đoán cả chiến dịch" },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["company", "campaignId"],
    },
  },
  handler: async (args, ctx) => {
    const missing = missingParams(args, ["campaignId"]);
    if (missing.length > 0) {
      return { error: "Thiếu campaignId. Gọi get_pmax_recommendations hoặc query_campaigns để lấy id thật." };
    }
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    const campaignId = str(args.campaignId)!;
    const assetGroupId = str(args.assetGroupId);

    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    try {
      const q = `company=${company}&campaignId=${encodeURIComponent(campaignId)}`
        + (assetGroupId ? `&assetGroupId=${encodeURIComponent(assetGroupId)}` : "")
        + optionalRange(args);
      const r = await internalGet<{ success?: boolean; error?: string; data?: PMaxDiagnosis }>(
        `/api/google/pmax/diagnosis?${q}`, ctx,
      );
      if (!r.success || !r.data) return { error: r.error ?? "Không chẩn đoán được chiến dịch PMax này." };
      const d = r.data;
      return {
        company, scopeNote: note,
        entityType: d.entityType,
        entityId: d.entityId,
        whatsWorking: d.whatsWorking,
        whatsLimiting: d.whatsLimiting,
        mainContributor: d.mainContributor,
        safeToScale: d.safeToScale,
        needsProtection: d.needsProtection,
        rootCause: d.rootCause,
        confidenceNote: d.confidenceNote,
        // false = Gemini không dùng được, đây là bản suy từ luật. Nói ra để
        // người đọc biết mức tin cậy khác nhau.
        aiGenerated: d.aiGenerated,
        generatedAt: d.generatedAt,
      };
    } catch (e) {
      return { error: `Không chẩn đoán được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 11: suggest_rsa_rewrite ─────────────────────────

const suggestRsaRewrite: ToolDef = {
  declaration: {
    name: "suggest_rsa_rewrite",
    description:
      "Viết lại BẢN NHÁP headlines (và mô tả) của một quảng cáo tìm kiếm Google (RSA) đang chạy, nhắm vào đúng điểm yếu Ad Relevance hoặc Expected CTR. " +
      "Headlines gốc PHẢI do người dùng dán vào — nếu chưa có thì HỎI, không tự bịa ra quảng cáo. " +
      "Công cụ này KHÔNG ghi gì lên Google: người dùng tự áp trong ô sửa RSA.",
    parameters: {
      type: "object",
      properties: {
        headlines: {
          type: "array", items: { type: "string" },
          description: "Các headline hiện tại, do người dùng dán vào",
        },
        descriptions: {
          type: "array", items: { type: "string" },
          description: "Các mô tả hiện tại, do người dùng dán vào",
        },
        weakest: {
          type: "string", enum: ["AD_RELEVANCE", "EXPECTED_CTR"],
          description: "Thành phần đang yếu cần chữa",
        },
        keywords: {
          type: "array", items: { type: "string" },
          description: "Từ khoá ad group đang chạy, để bài viết bám đúng",
        },
      },
      required: ["headlines", "weakest"],
    },
  },
  handler: async (args, ctx) => {
    const headlines = strArray(args.headlines);
    if (headlines.length === 0) {
      return { error: "Thiếu headlines. Người dùng phải dán nội dung RSA hiện tại — không tự viết ra rồi tự sửa." };
    }
    const weakest = enumStr(args.weakest, ["AD_RELEVANCE", "EXPECTED_CTR"] as const);
    if (!weakest) return { error: "weakest phải là AD_RELEVANCE hoặc EXPECTED_CTR." };

    const overBudget = spendBudget(ctx);
    if (overBudget) return { error: overBudget };

    try {
      // descriptions/keywords: route đọc .length và .map NGOÀI try/catch, thiếu
      // là 500. Luôn gửi mảng, kể cả rỗng.
      const r = await internalPost<{
        success?: boolean; error?: string;
        data?: { headlines?: string[]; descriptions?: string[] };
        keywordsUsed?: string[];
      }>(
        "/api/google/toolkit/rsa/suggest",
        {
          headlines,
          descriptions: strArray(args.descriptions),
          weakest,
          keywords: strArray(args.keywords),
        },
        ctx,
      );
      if (!r.success || !r.data) return { error: r.error ?? "Không gợi ý được nội dung RSA." };
      return {
        weakest,
        original: { headlines },
        suggested: { headlines: r.data.headlines, descriptions: r.data.descriptions },
        keywordsUsed: r.keywordsUsed,
        note: "BẢN NHÁP — chưa ghi lên Google. Người dùng tự áp trong ô sửa RSA.",
      };
    } catch (e) {
      return { error: `Không gợi ý được RSA: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 12: measure_keyword_volume ──────────────────────

const measureKeywordVolume: ToolDef = {
  declaration: {
    name: "measure_keyword_volume",
    description:
      "Hỏi Google Keyword Planner lượng tìm kiếm THẬT mỗi tháng của một bộ từ khoá, kèm mức cạnh tranh và giá thầu đầu trang (VND). " +
      "Đây là số ĐO ĐƯỢC từ Google, không phải AI đoán. Tối đa 20 từ khoá mỗi lượt.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", get enum() { return [...companyIds()] } },
        keywords: { type: "array", items: { type: "string" }, description: "Tối đa 20 từ khoá" },
      },
      required: ["keywords"],
    },
  },
  handler: async (args, ctx) => {
    // Trần 20 là trần CHI PHÍ, không phải trần hiển thị: mỗi lượt gọi là một
    // lượt API Google thật.
    const keywords = strArray(args.keywords, 20);
    if (keywords.length === 0) {
      return { error: "Thiếu danh sách từ khoá. Hỏi người dùng muốn đo từ khoá nào." };
    }
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];

    const requestedCount = Array.isArray(args.keywords) ? args.keywords.length : 0;

    try {
      const r = await internalPost<{
        success?: boolean; error?: string;
        requested?: KeywordMetric[]; suggestions?: KeywordMetric[];
        summary?: unknown; note?: string;
      }>("/api/google/keyword-volume", { company, keywords }, ctx);
      if (!r.success) return { error: r.error ?? "Không đo được lượng tìm kiếm." };
      return {
        company,
        scopeNote: note,
        truncatedNote: requestedCount > keywords.length
          ? `Chỉ đo ${keywords.length}/${requestedCount} từ khoá (trần 20 mỗi lượt).`
          : undefined,
        keywords: cap(r.requested ?? []).rows,
        googleSuggestions: cap(r.suggestions ?? []).rows,
        summary: r.summary,
        // Google không trả số cho từ quá hiếm — KHÔNG được đọc thành "không ai tìm".
        note: r.note ?? undefined,
      };
    } catch (e) {
      return { error: `Không đo được lượng tìm kiếm: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 13: get_cpl_data ────────────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const getCplData: ToolDef = {
  declaration: {
    name: "get_cpl_data",
    description:
      "Bảng CPL (chi phí mỗi lead) theo từng chiến dịch Facebook trong MỘT THÁNG, đã gộp cả đơn offline, kèm phân loại tốt/trung bình/đắt theo ngưỡng thật của từng công ty. " +
      "Dùng khi người dùng hỏi CPL tháng nào đó, chiến dịch nào đang đắt lead.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Bỏ trống = tháng hiện tại" },
      },
    },
  },
  handler: async (args, ctx) => {
    const raw = typeof args.month === "string" ? args.month.trim() : "";
    const month = MONTH_RE.test(raw) ? raw : new Date().toISOString().slice(0, 7);
    const monthNote = MONTH_RE.test(raw) ? undefined : `Không nhận được tháng hợp lệ nên dùng tháng hiện tại (${month}).`;

    const { companies, note } = resolveCompanies(ctx.user, undefined);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };

    try {
      const r = await internalGet<{
        success?: boolean; error?: string;
        data?: Array<{ campaign_name?: string; company?: string | null; spend?: number; cpl_data?: CPLResult }>;
        thresholds?: unknown;
      }>(`/api/cpl?month=${month}`, ctx);
      if (!r.success || !r.data) return { error: r.error ?? "Không lấy được dữ liệu CPL." };

      // Route đã tự lọc theo quyền; lọc lại ở đây là lớp hai, cùng kiểu với
      // mọi tool khác trong tệp này.
      const mine = r.data.filter((x) =>
        companies.includes((x.company ?? "").toUpperCase() as string),
      );
      mine.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
      const { rows, truncated, totalBeforeCap } = cap(mine);

      return {
        month, monthNote, scopeNote: note, companies,
        campaignCount: totalBeforeCap,
        truncated,
        truncatedNote: truncated ? `Chỉ liệt kê ${MAX_ROWS} chiến dịch chi nhiều nhất trong tổng ${totalBeforeCap}.` : undefined,
        campaigns: rows.map((x) => ({
          campaign_name: x.campaign_name,
          company: x.company,
          spend: Math.round(x.spend ?? 0),
          // cpl = null nghĩa là CHƯA CÓ conversion, không phải 0đ/lead.
          cpl: x.cpl_data?.cpl === null || x.cpl_data?.cpl === undefined ? null : Math.round(x.cpl_data.cpl),
          level: x.cpl_data?.level,
          label: x.cpl_data?.label,
        })),
        thresholds: r.thresholds,
      };
    } catch (e) {
      return { error: `Không lấy được dữ liệu CPL: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 14: get_cross_platform_comparison ───────────────

const getCrossPlatformComparison: ToolDef = {
  declaration: {
    name: "get_cross_platform_comparison",
    description:
      "So sánh Facebook và Google 7 ngày gần nhất: chi tiêu, số chuyển đổi, CPL mỗi bên, kèm khuyến nghị dịch chuyển ngân sách tính bằng số học (không phải AI đoán). " +
      "Lưu ý trường `comparable`: false nghĩa là hai bên đang đếm chuyển đổi theo định nghĩa khác nhau, chưa so CPL trực tiếp được.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", get enum() { return [...companyIds()] }, description: "Bỏ trống = tất cả công ty người dùng được xem" },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const scope = companies.length === 1 ? companies[0] : "ALL";

    try {
      const r = await internalGet<{
        success?: boolean; error?: string;
        company?: string; period?: { from: string; to: string };
        data?: Record<string, unknown>;
      }>(`/api/analytics/cross-platform?company=${scope}`, ctx);
      if (!r.success || !r.data) return { error: r.error ?? "Không lấy được so sánh đa nền tảng." };
      return { scope, scopeNote: note, period: r.period, ...r.data };
    } catch (e) {
      return { error: `Không lấy được so sánh đa nền tảng: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool 15: get_ga4_overview ────────────────────────────

const getGa4Overview: ToolDef = {
  declaration: {
    name: "get_ga4_overview",
    description:
      "Số liệu Google Analytics 4 đang có trong hệ thống: tổng phiên, tổng chuyển đổi, và dữ liệu theo từng campaign (UTM). " +
      "Dùng khi người dùng hỏi về traffic/hành vi trên website chứ không phải số liệu trong trình quản lý quảng cáo.",
    parameters: { type: "object", properties: {} },
  },
  handler: async (_args, ctx) => {
    try {
      const r = await internalGet<{
        success?: boolean; error?: string;
        data?: {
          oauth?: { connected?: boolean };
          connections?: Array<{ propertyName?: string; propertyId?: string; mappedCompany?: string | null; status?: string }>;
          campaigns?: GA4CampaignData[];
          lastFetchedAt?: string | null;
          totalSessions?: number;
          totalConversions?: number;
        };
      }>("/api/ga4", ctx);
      if (!r.success || !r.data) return { error: r.error ?? "Không lấy được dữ liệu GA4." };
      const d = r.data;

      if (d.oauth?.connected === false || (d.connections ?? []).length === 0) {
        return { connected: false, note: "GA4 chưa được kết nối." };
      }

      const { rows, truncated, totalBeforeCap } = cap(d.campaigns ?? []);
      return {
        connected: true,
        connections: (d.connections ?? []).map((c) => ({
          propertyName: c.propertyName, propertyId: c.propertyId,
          mappedCompany: c.mappedCompany, status: c.status,
        })),
        totalSessions: d.totalSessions,
        totalConversions: d.totalConversions,
        // null = CHƯA kéo dữ liệu lần nào trong tiến trình hiện tại (cache nằm
        // trong bộ nhớ, mất sau mỗi lần khởi động lại) — không phải "không có số".
        lastFetchedAt: d.lastFetchedAt,
        lastFetchedNote: d.lastFetchedAt
          ? undefined
          : "Chưa kéo dữ liệu GA4 lần nào kể từ lần khởi động gần nhất — số bên dưới có thể rỗng. Vào Cài đặt → GA4 bấm lấy dữ liệu.",
        campaignCount: totalBeforeCap,
        truncated,
        campaigns: rows.map((c) => ({
          campaignName: c.campaignName, source: c.source, medium: c.medium,
          sessions: c.sessions, newUsers: c.newUsers,
          conversions: c.conversions, conversionRate: c.conversionRate,
          revenue: c.revenue, engagementRate: c.engagementRate, bounceRate: c.bounceRate,
        })),
      };
    } catch (e) {
      return { error: `Không lấy được dữ liệu GA4: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Registry ─────────────────────────────────────────────


// ── Tool: get_pmax_xray_actions (Đợt 10b) ────────────────
// Đọc X-quang PMax + "việc nên làm" (cùng nguồn với tab X-quang). CHỈ ĐỌC — AdsBot KHÔNG áp dụng; người dùng bấm
// "Áp dụng" trong tab X-quang (Kiểm trước → XAC NHAN → ghi → đọc lại → hoàn tác) hoặc bật "Tự động" cho loại việc ít rủi ro.
const getPmaxXrayActions: ToolDef = {
  declaration: {
    name: "get_pmax_xray_actions",
    description:
      "PMax X-quang: chi phí và đơn theo từng kênh (Search/YouTube/Display/Discover/Gmail/Maps) TÁCH đơn từ lượt bấm với đơn sau lượt xem (engaged-view), " +
      "lượt tìm của PMax theo ý định, tỉ lệ PMax ăn lượt tìm thương hiệu / trùng Search, và danh sách VIỆC NÊN LÀM có ưu tiên + số tiền đang chảy vào (phủ định, loại thương hiệu, loại vị trí, loại trang, tắt mở rộng URL). " +
      "Dùng khi hỏi 'PMax đang đốt tiền ở đâu', 'kênh nào ra đơn thật', 'nên làm gì với PMax', 'YouTube có hiệu quả không'.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", get enum() { return [...companyIds()] } },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    try {
      const qs = `company=${company}${optionalRange(args)}`;
      const [xr, ct] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/xray?${qs}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/controls?${qs}`, ctx),
      ]);
      if (!xr.success) return { error: xr.error ?? "Không đọc được X-quang PMax." };
      return {
        company, scopeNote: note, range: xr.range,
        totals: xr.account?.totals,
        channels: (xr.account?.channels ?? []).map((c: Record<string, unknown>) => ({ channel: c.label, cost: c.cost, costShare: c.costShare, conversionsFromClicks: c.convClick, conversionsAfterView: c.convEngaged, cpaFromClicks: c.cpaClick })),
        warnings: (xr.account?.warnings ?? []).map((w: { text: string }) => w.text),
        searchIntents: (xr.terms?.intents ?? []).map((i: Record<string, unknown>) => ({ intent: i.label, terms: i.terms, clicks: i.clicks, conversions: i.conversions })),
        brandShareOfSearchClicks: xr.cannibalization?.brandShare,
        recommendations: ct.success ? (ct.recommendations ?? []).map((r: Record<string, unknown>) => ({ priority: r.priority, title: r.title, why: r.why, moneyAtStake: r.moneyAtStake, actions: (r.proposalIds as string[] | undefined)?.length ?? 0, canAutomate: r.autoKind, manualSteps: r.manualSteps })) : [],
        howToApply: "Mở PMax Insights → tab X-quang → mục 'Việc nên làm' → chọn việc → Kiểm trước → gõ XAC NHAN → Áp dụng (hoàn tác được). Loại việc ít rủi ro có thể bật 'Tự động'. AdsBot không tự áp dụng.",
        link: "/google-pmax?tab=xray",
      };
    } catch (e) {
      return { error: `Không đọc được X-quang PMax: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool: get_pmax_experiments (Đợt 10c) ─────────────────
// Thí nghiệm loại trừ vùng (đo PMax/YouTube tạo đơn thêm thật hay không) + ngưỡng học + khách mới + mốc trước/sau.
// CHỈ ĐỌC — bật/kết thúc thí nghiệm, đổi chế độ khách mới đều do người dùng bấm ở tab Thí nghiệm (XAC NHAN).
const getPmaxExperiments: ToolDef = {
  declaration: {
    name: "get_pmax_experiments",
    description:
      "PMax thí nghiệm & tín hiệu: (1) thí nghiệm TẮT PMax ở một vùng để đo đơn PMax/YouTube có phải đơn thêm thật không — các phương án (Hà Nội / TP.HCM / nửa các tỉnh) với độ nhạy, chi phí tiết kiệm, thí nghiệm đang chạy và kết quả; " +
      "(2) chiến dịch PMax nào không đủ đơn/ngân sách để thoát 'đang học' và gợi ý gộp; (3) tỉ lệ khách mới/khách cũ và chế độ khách mới; (4) so trước/sau mốc đổi cài đặt. " +
      "Dùng khi hỏi 'YouTube có tạo đơn thật không', 'làm sao kiểm chứng PMax', 'thí nghiệm đang ra sao', 'vì sao PMax học mãi', 'PMax có tiêu vào khách cũ không'.",
    parameters: { type: "object", properties: { company: { type: "string", get enum() { return [...companyIds()] } } } },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    try {
      const [ex, sg] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/experiment?company=${company}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/signals?company=${company}`, ctx),
      ]);
      const running = ex.success ? (ex.experiments ?? []).find((e: { status: string }) => e.status === "running") : null;
      return {
        company, scopeNote: note,
        experiment: ex.success ? {
          kpiSource: ex.design?.kpi?.note,
          options: (ex.design?.candidates ?? []).map((c: Record<string, unknown>) => ({ option: c.label, provinces: c.holdoutNames, shareOfOrders: c.holdoutShare, pmaxClaimedOrdersPerWeek: c.pmaxClaimPerWeek, pmaxCostSavedPerWeek: c.pmaxCostPerWeek, expectedChangeIfGoogleRight: c.expectedEffect, minDetectableChange: c.mde, sensitiveEnough: c.sensitive, note: c.note })),
          running: running ? { label: running.label, start: running.start, plannedEnd: running.plannedEnd, result: running.lastResult?.text, verdict: running.lastResult?.verdict } : null,
          past: (ex.experiments ?? []).filter((e: { status: string }) => e.status === "ended").slice(0, 3).map((e: Record<string, any>) => ({ label: e.label, start: e.start, ended: e.endedAt, result: e.lastResult?.text })), // eslint-disable-line @typescript-eslint/no-explicit-any
        } : { error: ex.error },
        learning: sg.success ? { campaigns: (sg.learning?.checks ?? []).map((c: Record<string, unknown>) => ({ name: c.name, status: c.status, conversions30d: c.conv, clickConversions30d: c.convClick, budgetPerDay: c.budget, budgetNeeded: c.neededBudget, issues: c.issues })), merge: sg.learning?.merge?.text ?? null } : { error: sg.error },
        newCustomers: sg.success ? { campaigns: sg.newCustomer?.rows, note: sg.newCustomer?.note } : null,
        howToApply: "Mở PMax Insights → tab Thí nghiệm. Thí nghiệm: chọn phương án → Kiểm trước → gõ XAC NHAN → Bật (tool tự kết thúc đúng hẹn, trả tài khoản như cũ). Chế độ khách mới: Kiểm trước → XAC NHAN → hoàn tác được. AdsBot không tự bật.",
        link: "/google-pmax?tab=experiment",
      };
    } catch (e) {
      return { error: `Không đọc được thí nghiệm PMax: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool: get_pmax_assets (Đợt 10d) ──────────────────────
// Sức khoẻ asset PMax (thiếu gì, asset chữ yếu), search theme chưa khớp + gợi ý, PMax cũ nên gắn nhãn. CHỈ ĐỌC — thay
// asset / đổi theme / tạo asset group / gắn nhãn do người dùng bấm ở tab Asset (Kiểm trước → XAC NHAN → hoàn tác được).
const getPmaxAssets: ToolDef = {
  declaration: {
    name: "get_pmax_assets",
    description:
      "PMax asset & nhóm: từng asset group (ad strength, trạng thái, thiếu loại asset nào, asset bị từ chối, tiêu đề/mô tả YẾU theo tỉ lệ bấm), " +
      "search theme không khớp lượt tìm thật + gợi ý theme từ lượt tìm đã ra đơn, và PMax đã dừng lâu nên gắn nhãn dọn dẹp. " +
      "Dùng khi hỏi 'asset nào yếu', 'nên viết lại tiêu đề nào', 'search theme có ổn không', 'asset group thiếu gì', 'dọn chiến dịch PMax cũ'.",
    parameters: { type: "object", properties: { company: { type: "string", get enum() { return [...companyIds()] } } } },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    try {
      const [as, th, cl] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/assets?company=${company}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/themes?company=${company}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/pmax/cleanup?company=${company}`, ctx),
      ]);
      return {
        company, scopeNote: note,
        assetGroups: as.success ? (as.groups ?? []).map((g: Record<string, any>) => ({ name: g.name, campaign: g.campaignName, adStrength: g.adStrength, status: g.status, statusReasons: g.statusReasons, missing: (g.missing ?? []).map((m: Record<string, unknown>) => `${m.label} ${m.have}/${m.need}${m.required ? " (bắt buộc)" : ""}`), disapproved: (g.disapproved ?? []).length, weakTexts: (g.weak ?? []).map((w: Record<string, unknown>) => ({ text: w.text, why: w.why })) })) : { error: as.error }, // eslint-disable-line @typescript-eslint/no-explicit-any
        searchThemes: th.success ? (th.groups ?? []).map((g: Record<string, any>) => ({ assetGroup: g.name, themes: (g.themes ?? []).length, noMatchingSearches: (g.themes ?? []).filter((t: { offTopic: boolean }) => t.offTopic).map((t: { text: string }) => t.text).slice(0, 15), suggestions: (g.suggestions ?? []).slice(0, 10).map((s: Record<string, unknown>) => `${s.text} — ${s.why}`) })) : { error: th.error }, // eslint-disable-line @typescript-eslint/no-explicit-any
        oldPausedPmax: cl.success ? { total: (cl.campaigns ?? []).length, suggestLabel: (cl.campaigns ?? []).filter((c: { suggest: boolean }) => c.suggest).length, label: cl.label } : { error: cl.error },
        howToApply: "PMax Insights → tab Asset: chọn asset yếu → 'Viết bản thay' (Gemini, đã kiểm độ dài + luật Google) → Kiểm trước → XAC NHAN → Áp dụng (hoàn tác được). Theme: chọn theme chưa khớp để gỡ + gợi ý để thêm. Asset group mới được tạo ở trạng thái TẠM DỪNG. AdsBot không tự áp dụng.",
        link: "/google-pmax?tab=assets",
      };
    } catch (e) {
      return { error: `Không đọc được asset PMax: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool: get_search_xray_actions (Đợt 11) ───────────────
// X-quang Search (tiền theo ý định trong từng chiến dịch, mất hiển thị vì ngân sách/hạng) + việc nên làm + RSA yếu. CHỈ ĐỌC.
const getSearchXrayActions: ToolDef = {
  declaration: {
    name: "get_search_xray_actions",
    description:
      "Search X-quang: mỗi chiến dịch Search chi bao nhiêu cho lượt tìm THƯƠNG HIỆU vs lượt tìm CHUNG/MUA vs ĐỐI THỦ, CPA theo đơn Mua hàng từng nhóm, mất hiển thị vì ngân sách hay vì hạng, " +
      "cảnh báo chiến dịch thương hiệu bị lượt tìm chung ăn ngân sách, và VIỆC NÊN LÀM (tách thương hiệu/chung, thêm lượt tìm ra đơn làm từ khoá, phủ định đối thủ, từ khoá đốt tiền) + dòng quảng cáo RSA yếu. " +
      "Dùng khi hỏi 'Search đang tiêu tiền vào đâu', 'chiến dịch brand có ổn không', 'từ khoá nào nên thêm/dừng', 'quảng cáo Search nào yếu'.",
    parameters: { type: "object", properties: { company: { type: "string", get enum() { return [...companyIds()] } }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } } },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    try {
      const qs = `company=${company}${optionalRange(args)}`;
      const [xr, ct, rs] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/search/xray?${qs}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/search/controls?${qs}`, ctx),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        internalGet<any>(`/api/google/search/rsa?${qs}`, ctx),
      ]);
      if (!xr.success) return { error: xr.error ?? "Không đọc được X-quang Search." };
      return {
        company, scopeNote: note, range: xr.range, account: xr.account && { cost: xr.account.cost, purchaseOrders: xr.account.purchases, cpa: xr.account.cpa },
        campaigns: (xr.campaigns ?? []).map((c: Record<string, any>) => ({ name: c.name, status: c.status, cost: c.cost, purchaseOrders: c.purchases, cpa: c.cpa, lostImpressionShareBudget: c.lostBudget, lostImpressionShareRank: c.lostRank, brandShareOfCost: c.brandShareOfCost, byIntent: (c.intents ?? []).slice(0, 6).map((i: Record<string, unknown>) => ({ intent: i.label, cost: i.cost, purchaseOrders: i.purchases, cpa: i.cpa })) })), // eslint-disable-line @typescript-eslint/no-explicit-any
        warnings: (xr.warnings ?? []).map((w: { text: string }) => w.text),
        recommendations: ct.success ? (ct.recommendations ?? []).map((r: Record<string, unknown>) => ({ priority: r.priority, title: r.title, why: r.why, moneyAtStake: r.moneyAtStake })) : [],
        weakAdLines: rs.success ? (rs.ads ?? []).flatMap((a: Record<string, any>) => (a.weak ?? []).map((w: Record<string, unknown>) => ({ adGroup: a.adGroup, text: w.text, why: w.why }))).slice(0, 15) : [], // eslint-disable-line @typescript-eslint/no-explicit-any
        notes: xr.notes,
        howToApply: "Google Search → tab X-quang: 'Việc nên làm' → Kiểm trước → gõ XAC NHAN → Áp dụng (hoàn tác được). Tách thương hiệu/chung: tool dựng chiến dịch Chung ở trạng thái TẠM DỪNG → bạn bật → tool chuyển từ khoá chung. Tab Quảng cáo RSA: chọn dòng yếu → Gemini viết → Kiểm trước → XAC NHAN. AdsBot không tự áp dụng.",
        link: "/google-search?tab=xray",
      };
    } catch (e) {
      return { error: `Không đọc được X-quang Search: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

// ── Tool: get_meta_xray (Đợt 12) ─────────────────────────
// X-quang Meta: đơn từ lượt bấm vs chỉ xem, GA4 đối chiếu, sự kiện tối ưu, tần suất + việc nên làm. CHỈ ĐỌC.
const getMetaXray: ToolDef = {
  declaration: {
    name: "get_meta_xray",
    description:
      "Meta/Facebook X-quang: mỗi chiến dịch chi bao nhiêu, 'mua hàng' Meta báo TÁCH thành từ lượt bấm (7 ngày) và chỉ xem (1 ngày), CPA theo lượt bấm, sự kiện tối ưu, cài đặt ghi nhận, tần suất, " +
      "đơn GA4 theo utm_campaign để đối chiếu, và việc nên làm (mở phiên xử lý tạo nhóm mới chỉ tính lượt bấm / tối ưu Mua hàng, chuẩn hoá utm). " +
      "Dùng khi hỏi 'Facebook có ra đơn thật không', 'số Meta có đáng tin không', 'chiến dịch Facebook nào tốt/tệ', 'vì sao Meta báo nhiều đơn mà Odoo ít'.",
    parameters: { type: "object", properties: { company: { type: "string", get enum() { return [...companyIds()] } }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } } },
  },
  handler: async (args, ctx) => {
    const { companies, note } = resolveCompanies(ctx.user, args.company);
    if (companies.length === 0) return { error: "Người dùng không có quyền xem công ty nào." };
    const company = companies[0];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = await internalGet<any>(`/api/meta/xray?company=${company}${optionalRange(args)}`, ctx);
      if (!x.success) return { error: x.error ?? "Không đọc được X-quang Meta." };
      return {
        company, scopeNote: note, range: x.range, totals: x.totals, warnings: (x.warnings ?? []).map((w: { text: string }) => w.text),
        campaigns: (x.campaigns ?? []).slice(0, 25).map((c: Record<string, unknown>) => ({ name: c.name, spend: c.spend, metaPurchases: c.purchases, fromClicks: c.click, viewOnly: c.view, cpaFromClicks: c.cpaClick, optimizationEvent: c.optEventLabel, attribution: c.attribution, frequency: c.frequency, utm: c.utm, ga4Purchases: c.ga4Purchases, flags: c.flags })),
        recommendations: (x.recommendations ?? []).map((r: Record<string, unknown>) => ({ priority: r.priority, title: r.title, why: r.why })),
        howToApply: "Trang Meta X-quang → 'Việc nên làm' → Mở phiên xử lý chiến dịch → tool đề xuất tạo nhóm mới (tạm dừng) chỉ tính lượt bấm / tối ưu Mua hàng → Kiểm trước → xác nhận → hoàn tác được. Meta không cho sửa cài đặt ghi nhận của nhóm cũ. AdsBot không tự áp dụng.",
        link: "/meta-xray",
      };
    } catch (e) {
      return { error: `Không đọc được X-quang Meta: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
    }
  },
};

const TOOLS: Record<string, ToolDef> = {
  get_pmax_xray_actions: getPmaxXrayActions,
  get_pmax_experiments: getPmaxExperiments,
  get_pmax_assets: getPmaxAssets,
  get_search_xray_actions: getSearchXrayActions,
  get_meta_xray: getMetaXray,
  query_campaigns: queryCampaigns,
  get_spend_summary: getSpendSummary,
  list_improvements: listImprovements,
  get_policy_updates: getPolicyUpdates,
  generate_ad_creative: generateAdCreative,
  improve_ad_creative: improveAdCreative,
  compare_ad_creatives: compareAdCreatives,
  analyze_audience_segments: analyzeAudienceSegments,
  get_pmax_recommendations: getPmaxRecommendations,
  get_pmax_diagnosis: getPmaxDiagnosis,
  suggest_rsa_rewrite: suggestRsaRewrite,
  measure_keyword_volume: measureKeywordVolume,
  get_cpl_data: getCplData,
  get_cross_platform_comparison: getCrossPlatformComparison,
  get_ga4_overview: getGa4Overview,
};

export const TOOL_DECLARATIONS = Object.values(TOOLS).map((t) => t.declaration);

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { error: `Không có công cụ tên "${name}".` };
  try {
    return await tool.handler(args, ctx);
  } catch (e) {
    // Lỗi tool trả về cho model dưới dạng dữ liệu, để nó nói "không lấy được"
    // thay vì im lặng bịa một con số thay thế.
    return { error: e instanceof Error ? e.message : "Lỗi không rõ khi chạy công cụ" };
  }
}
