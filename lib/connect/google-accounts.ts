// ============================================================
// Chế độ cổng: liệt kê tài khoản Google Ads mà tài khoản Google vừa kết nối vào được, để khách TÍCH CHỌN thay vì gõ mã.
// listAccessibleCustomers (REST, không cần mã tài khoản) → đọc tên từng tài khoản; tài khoản quản lý (MCC) thì mở rộng
// các tài khoản con (customer_client, tối đa 2 cấp) và nhớ MCC làm login-customer-id cho từng tài khoản con.
// Lỗi từng tài khoản được trả NGUYÊN (vd project chưa đủ mức truy cập) — không che, không hiện 0.
// ============================================================
import { getGatewayToken } from "./gateway"
import { gatewayGoogleCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"

export interface GoogleAccountRow {
  customerId: string
  name: string
  status: string
  currency: string
  /** MCC đứng trên (login-customer-id). Không có = khách vào thẳng tài khoản này. */
  loginCustomerId?: string
  viaName?: string
}

export interface GoogleAccountsResult {
  accounts: GoogleAccountRow[]
  /** Tài khoản không đọc được + lý do (vd thiếu quyền) — hiện cho khách biết, không bỏ qua im lặng. */
  errors: { customerId: string; message: string }[]
}

const MAX_TOP = 20
const MAX_CLIENTS = 200
const ADS_API = "https://googleads.googleapis.com/v23"

export async function listAccessibleCustomerIds(): Promise<string[]> {
  const token = await getGatewayToken("google")
  const res = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  })
  const data = (await res.json().catch(() => ({}))) as { resourceNames?: string[]; error?: { message?: string } }
  if (!res.ok) throw new Error(data.error?.message ?? `Google trả lỗi ${res.status} khi liệt kê tài khoản`)
  return (data.resourceNames ?? []).map((r) => r.replace("customers/", ""))
}

type Row = Record<string, Record<string, unknown> | undefined>

/** Thư viện trả trạng thái dạng SỐ (enum CustomerStatus) — đổi ra tên để giao diện so "ENABLED" và hiện chữ (lỗi 26/10: hiện "· 2"). */
const CUSTOMER_STATUS: Record<number, string> = { 0: "UNSPECIFIED", 1: "UNKNOWN", 2: "ENABLED", 3: "CANCELED", 4: "SUSPENDED", 5: "CLOSED" }
export function customerStatusName(v: unknown): string {
  if (typeof v === "number") return CUSTOMER_STATUS[v] ?? String(v)
  return v == null ? "" : String(v)
}

export async function listGoogleAccounts(): Promise<GoogleAccountsResult> {
  const ids = (await listAccessibleCustomerIds()).slice(0, MAX_TOP)
  const out = new Map<string, GoogleAccountRow>()
  const errors: GoogleAccountsResult["errors"] = []

  for (const id of ids) {
    try {
      const rows = (await gatewayGoogleCustomer(id).query(
        "SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.currency_code FROM customer LIMIT 1",
      )) as Row[]
      const c = rows[0]?.customer ?? {}
      const name = String(c.descriptive_name ?? id)
      if (!c.manager) {
        out.set(id, { customerId: id, name, status: customerStatusName(c.status), currency: String(c.currency_code ?? "") })
        continue
      }
      // Tài khoản quản lý (MCC): không chạy quảng cáo → mở rộng tài khoản con, nhớ MCC làm login-customer-id.
      const clients = (await gatewayGoogleCustomer(id, id).query(
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.currency_code, customer_client.level FROM customer_client WHERE customer_client.level <= 2 AND customer_client.manager = FALSE LIMIT " + MAX_CLIENTS,
      )) as Row[]
      for (const r of clients) {
        const cc = r.customer_client ?? {}
        const cid = String(cc.id ?? "")
        if (!cid || out.has(cid)) continue // vào thẳng được thì giữ bản vào thẳng
        out.set(cid, { customerId: cid, name: String(cc.descriptive_name ?? cid), status: customerStatusName(cc.status), currency: String(cc.currency_code ?? ""), loginCustomerId: id, viaName: name })
      }
    } catch (e) {
      errors.push({ customerId: id, message: googleAdsErrorMessage(e) })
    }
  }
  return { accounts: [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "vi")), errors }
}

/** Chi tiêu 7 ngày của một tài khoản đã chọn — để khách thấy đúng tài khoản ngay sau khi kết nối. */
export async function previewGoogleAccount(customerId: string, loginCustomerId?: string): Promise<{ name: string; currency: string; cost: number; clicks: number; impressions: number }> {
  const rows = (await gatewayGoogleCustomer(customerId, loginCustomerId).query(
    "SELECT customer.descriptive_name, customer.currency_code, metrics.cost_micros, metrics.clicks, metrics.impressions FROM customer WHERE segments.date DURING LAST_7_DAYS",
  )) as Row[]
  let cost = 0, clicks = 0, impressions = 0, name = customerId, currency = ""
  for (const r of rows) {
    name = String(r.customer?.descriptive_name ?? name)
    currency = String(r.customer?.currency_code ?? currency)
    cost += Number(r.metrics?.cost_micros ?? 0) / 1_000_000
    clicks += Number(r.metrics?.clicks ?? 0)
    impressions += Number(r.metrics?.impressions ?? 0)
  }
  return { name, currency, cost: Math.round(cost), clicks, impressions }
}
