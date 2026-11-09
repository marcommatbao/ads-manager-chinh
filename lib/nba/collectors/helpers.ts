// ============================================================
// NBA collectors — shared helpers
// ============================================================

import { companyIds } from "@/lib/companies/registry";
import type { Campaign } from "@/types/ads.types";
import type { NbaCompany, NbaPlatform } from "../types";
import { isCompany } from "@/lib/companies/registry";

/** Suy công ty: ưu tiên field, fallback prefix tên. null nếu không xác định. */
export function detectCompany(c: Campaign): NbaCompany | null {
  if (isCompany(c.company)) return c.company;
  const n = (c.name ?? "").toUpperCase();
  if (n.includes("MBI")) return "MBI";
  if (n.includes("MBC")) return "MBC";
  // Đợt 23: bản cài CHỈ MỘT công ty (khách) → mọi chiến dịch thuộc công ty đó. Bản Mắt Bão (2 công ty): như cũ.
  const ids = companyIds();
  return ids.length === 1 ? ids[0] : null;
}

export function platformOf(c: Campaign): NbaPlatform {
  return c.platform === "google" ? "google" : "facebook";
}

export function isActive(c: Campaign): boolean {
  return c.status === "ACTIVE";
}
