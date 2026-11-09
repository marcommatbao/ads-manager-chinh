// ============================================================
// Chế độ cổng — Meta: liệt kê tài sản mà khách đã chia sẻ cho ứng dụng Mắt Bão trên hộp thoại Facebook Login for Business
// (tài khoản quảng cáo, Trang, Pixel) để khách TÍCH CHỌN thay vì gõ mã. Token lấy thẳng từ cổng (không qua process.env).
// Lỗi Meta trả NGUYÊN câu của Meta — không che, không hiện 0.
// ============================================================
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"
import { getGatewayToken } from "./gateway"

export interface MetaAdAccountRow { id: string; name: string; currency: string; status: number; business?: string }
export interface MetaNamedRow { id: string; name: string }

const MAX_PAGES = 5

async function graphList<T>(path: string, token: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = `${META_GRAPH_BASE}${path}${path.includes("?") ? "&" : "?"}limit=100`
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" })
    const d = (await res.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message?: string } }
    if (!res.ok || d.error) throw new Error(d.error?.message ?? `Meta trả lỗi ${res.status}`)
    out.push(...(d.data ?? []))
    url = d.paging?.next ?? null
  }
  return out
}

/** Trạng thái tài khoản quảng cáo Meta: 1 = đang hoạt động; còn lại hiện cho khách biết (vd 2 = vô hiệu, 3 = nợ). */
export const AD_ACCOUNT_STATUS: Record<number, string> = { 1: "", 2: "bị vô hiệu hoá", 3: "chưa thanh toán", 7: "đang xét duyệt rủi ro", 9: "trong thời gian ân hạn", 100: "chờ đóng", 101: "đã đóng" }

export async function listMetaAdAccounts(token?: string): Promise<MetaAdAccountRow[]> {
  const t = token ?? await getGatewayToken("meta")
  const rows = await graphList<{ account_id?: string; name?: string; currency?: string; account_status?: number; business?: { name?: string } }>(
    "/me/adaccounts?fields=account_id,name,currency,account_status,business{name}", t)
  return rows
    .filter((r) => r.account_id)
    .map((r) => ({ id: String(r.account_id), name: r.name ?? String(r.account_id), currency: r.currency ?? "", status: Number(r.account_status ?? 0), ...(r.business?.name ? { business: r.business.name } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"))
}

export async function listMetaPages(token?: string): Promise<MetaNamedRow[]> {
  const t = token ?? await getGatewayToken("meta")
  const rows = await graphList<{ id?: string; name?: string }>("/me/accounts?fields=id,name", t)
  return rows.filter((r) => r.id).map((r) => ({ id: String(r.id), name: r.name ?? String(r.id) }))
}

export async function listMetaPixels(adAccountId: string, token?: string): Promise<MetaNamedRow[]> {
  if (!/^\d{1,30}$/.test(adAccountId)) throw new Error("Mã tài khoản quảng cáo không hợp lệ")
  const t = token ?? await getGatewayToken("meta")
  const rows = await graphList<{ id?: string; name?: string }>(`/act_${adAccountId}/adspixels?fields=id,name`, t)
  return rows.filter((r) => r.id).map((r) => ({ id: String(r.id), name: r.name ?? String(r.id) }))
}

/** Chi tiêu 7 ngày của tài khoản đã chọn — để khách thấy đúng tài khoản ngay sau khi kết nối. */
export async function previewMetaAccount(adAccountId: string, token?: string): Promise<{ spend: number; clicks: number; impressions: number }> {
  if (!/^\d{1,30}$/.test(adAccountId)) throw new Error("Mã tài khoản quảng cáo không hợp lệ")
  const t = token ?? await getGatewayToken("meta")
  const rows = await graphList<{ spend?: string; clicks?: string; impressions?: string }>(`/act_${adAccountId}/insights?date_preset=last_7d&fields=spend,clicks,impressions`, t)
  const r = rows[0] ?? {}
  return { spend: Math.round(Number(r.spend ?? 0)), clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0) }
}
