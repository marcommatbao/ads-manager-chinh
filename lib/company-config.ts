import type { Campaign } from "@/types/ads.types";
import { metaAccountIds, ga4Ids } from "@/lib/meta-accounts";

// ============================================================
// Cấu hình công ty. Nhãn / domain / màu giữ trong mã (đều là thông tin công
// khai: matbao.net, matbao.in, sale.ai.vn là website đang chạy).
//
// Toàn bộ ID tích hợp (GA4 property/stream/measurement, Facebook Pixel) đọc từ
// biến môi trường — xem lib/meta-accounts.ts. Đổi 17/09/2026 khi chuẩn bị đưa
// repo lên công khai. Thiếu biến → chuỗi rỗng, giao diện hiện "chưa cấu hình".
// ============================================================

export interface CompanyConfigEntry { label: string; domain: string; color: string; ga4: ReturnType<typeof ga4Ids>; facebook: { pixelId: string } }
// Đợt 21a: kiểu theo mã công ty (bản cài khác có thể không có dòng ở đây → nơi dùng phải xử lý thiếu).
// ga4/facebook là getter: đọc mã LÚC DÙNG, không chụp một lần lúc nạp module (trình duyệt nạp module trước khi có mã chèn sẵn).
export const COMPANY_CONFIG: Record<string, CompanyConfigEntry> = {
  MBC: {
    label: "MBC",
    domain: "matbao.net",
    color: "blue", // tailwind name, không phải hex — tiện dùng trực tiếp ở UI
    get ga4() { return ga4Ids("MBC"); },
    get facebook() { return { pixelId: metaAccountIds("MBC").pixelId }; },
  },

  MBI: {
    label: "MBI",
    domain: "matbao.in",
    color: "indigo",
    get ga4() { return ga4Ids("MBI"); },
    get facebook() { return { pixelId: metaAccountIds("MBI").pixelId }; },
  },

  SALE_AI: {
    label: "Sale.AI",
    domain: "sale.ai.vn",
    color: "emerald",
    get ga4() { return ga4Ids("SALE_AI"); },
    get facebook() { return { pixelId: metaAccountIds("SALE_AI").pixelId }; },
  },
};

export function normalizeCompanyKey(company: string | null | undefined): string | null {
  if (!company) return null;
  const MAP: Record<string, string> = {
    "MBC": "MBC",
    "MBI": "MBI",
    "Sale.AI": "SALE_AI",
    "SALE_AI": "SALE_AI",
    "saleai": "SALE_AI",
  };
  return MAP[company] ?? null;
}

export function getGA4ConfigForCampaign(campaign: Campaign) {
  const companyKey = normalizeCompanyKey(campaign.company);
  if (!companyKey) return null;
  return COMPANY_CONFIG[companyKey]?.ga4 ?? null;
}

export function getFBPixelForCampaign(campaign: Campaign): string | null {
  const companyKey = normalizeCompanyKey(campaign.company);
  if (!companyKey) return null;
  return COMPANY_CONFIG[companyKey]?.facebook?.pixelId ?? null;
}
