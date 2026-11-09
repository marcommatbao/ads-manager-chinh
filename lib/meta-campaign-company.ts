// ─────────────────────────────────────────────
// Công ty của một campaign Facebook — hỏi Meta bằng ID, không tin tên client gửi.
//
// Ba route ghi targeting thật (audience/apply, expand, optimize-placement) kiểm
// quyền bằng `detectCompany(campaignName)` với `campaignName` lấy thẳng từ thân
// request. Nhưng hành động thì nhắm theo `campaignId`, cũng từ thân request. Hai
// thứ đó không buộc phải khớp nhau: gửi ID của campaign MBC kèm tên "MBI - ..."
// là qua được chốt rồi ghi vào tài khoản MBC.
//
// Chốt phải dựa trên chính thứ mà hành động nhắm tới. Nên: lấy ID, hỏi Meta tên
// thật, rồi mới suy ra công ty.
//
// Cache ngắn vì đây nằm trên đường bấm nút của người dùng, và tên campaign gần
// như không đổi. Cache theo tên đọc được, không cache kết quả cho/không-cho —
// quyền là của người, tên là của campaign, đừng trộn hai thứ vào một khóa.
// ─────────────────────────────────────────────
import { detectCompany } from "./company-detect";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const META_BASE = META_GRAPH_BASE;
const TTL_MS = 5 * 60_000;

const cache = new Map<string, { name: string; expiresAt: number }>();

/**
 * Tên thật của campaign theo Meta. Ném lỗi nếu không đọc được — KHÔNG trả chuỗi
 * rỗng, vì `detectCompany("")` trả về một công ty mặc định và như vậy là biến
 * "không xác minh được" thành "đã xác minh, thuộc công ty này".
 */
export async function fetchMetaCampaignName(campaignId: string): Promise<string> {
  const hit = cache.get(campaignId);
  if (hit && hit.expiresAt > Date.now()) return hit.name;

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN chưa cấu hình");

  const res = await fetch(`${META_BASE}/${encodeURIComponent(campaignId)}?fields=name&access_token=${token}`);
  const data = (await res.json()) as { name?: string; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "Graph API trả lỗi khi đọc tên campaign");
  if (!data.name) throw new Error("Không đọc được tên campaign từ Meta");

  cache.set(campaignId, { name: data.name, expiresAt: Date.now() + TTL_MS });
  return data.name;
}

export interface CompanyCheck {
  allowed: boolean;
  company: string | null;
  /** Tên thật theo Meta — dùng để ghi lưu vết, đừng ghi lại tên client gửi. */
  verifiedName: string | null;
  error: string | null;
}

/** Xác minh người này có quyền với campaign này, dựa trên dữ liệu phía Meta. */
export async function verifyMetaCampaignAccess(
  campaignId: string,
  canAccess: (company: string) => boolean,
): Promise<CompanyCheck> {
  if (!campaignId) {
    return { allowed: false, company: null, verifiedName: null, error: "Thiếu campaignId" };
  }
  let name: string;
  try {
    name = await fetchMetaCampaignName(campaignId);
  } catch (err) {
    // Không xác minh được thì TỪ CHỐI. Đây là đường ghi thật lên tài khoản
    // quảng cáo; "không biết" phải xử như "không được", không phải như "được".
    return {
      allowed: false, company: null, verifiedName: null,
      error: `Không xác minh được campaign này thuộc công ty nào: ${err instanceof Error ? err.message : "lỗi không xác định"}`,
    };
  }
  const company = detectCompany(name) as string;
  return {
    allowed: canAccess(company),
    company,
    verifiedName: name,
    error: canAccess(company) ? null : "Không có quyền với công ty của campaign này",
  };
}

// ─────────────────────────────────────────────
// Audit 30/09: các route đổi trạng thái / ngân sách Meta suy ra công ty từ TÊN của chính id được gửi lên. Nhóm quảng
// cáo / quảng cáo do app tạo đặt tên theo phân khúc ("Nu 25-45 HCM"), không có chữ "MBI" → detectCompany trả MBC
// → admin_mbc tạm dừng / đổi ngân sách được nhóm của MBI. Phải tìm CHIẾN DỊCH CHA rồi mới suy ra công ty.
// ─────────────────────────────────────────────
export type MetaNodeKind = "campaign" | "child"
export interface MetaNodeOwner { kind: MetaNodeKind; name: string; campaignName: string; campaignId?: string; dailyBudget?: string; status?: string }
type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/**
 * Nhóm quảng cáo / quảng cáo trả `campaign{name}`; chiến dịch thì Meta báo lỗi "nonexisting field (campaign)" → hỏi lại
 * `objective` (trường chỉ chiến dịch có). Không xác định được → ném lỗi (người gọi phải TỪ CHỐI, không đoán).
 */
export async function resolveMetaNodeOwner(id: string, token: string, opts: { withBudget?: boolean; withStatus?: boolean; fetchImpl?: FetchLike } = {}): Promise<MetaNodeOwner> {
  if (!/^\d{5,25}$/.test(id)) throw new Error("Mã đối tượng Meta không hợp lệ")
  const get = opts.fetchImpl ?? ((u: string) => fetch(u))
  const budget = (opts.withBudget ? ",daily_budget" : "") + (opts.withStatus ? ",status" : "")
  const url = (fields: string) => `${META_GRAPH_BASE}/${id}?fields=${fields}&access_token=${encodeURIComponent(token)}`
  type R = { name?: string; daily_budget?: string; status?: string; objective?: string; campaign?: { id?: string; name?: string }; error?: { message?: string } }
  const r1 = await get(url(`name${budget},campaign{id,name}`))
  const d1 = (await r1.json()) as R
  if (r1.ok && !d1.error && d1.campaign?.name) return { kind: "child", name: String(d1.name ?? ""), campaignName: d1.campaign.name, campaignId: d1.campaign.id ? String(d1.campaign.id) : undefined, dailyBudget: d1.daily_budget, status: d1.status }
  const r2 = await get(url(`name${budget},objective`))
  const d2 = (await r2.json()) as R
  if (r2.ok && !d2.error && d2.objective) return { kind: "campaign", name: String(d2.name ?? ""), campaignName: String(d2.name ?? ""), dailyBudget: d2.daily_budget, status: d2.status }
  throw new Error(d2.error?.message ?? d1.error?.message ?? "Không xác định được chiến dịch chứa đối tượng này")
}
