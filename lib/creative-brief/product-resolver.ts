// ============================================================
// Creative Brief — Product Resolver
// Reads PRODUCTS_KB + Google catalog for USPs, pain points,
// proof points, search intents. Validates company silo.
// ============================================================

import { PRODUCTS_KB } from "@/lib/products-knowledge";
import { MBC_PRODUCT_CATALOG, MBI_PRODUCT_CATALOG } from "@/lib/google-creative-engine";
import type { BriefCompany, BriefFunnelStage, PainPoint, ProofPoint, ProductKey } from "./types";

// Products owned by each company (matches _constants.ts PRODUCTS_BY_COMPANY)
const MBC_PRODUCTS = new Set<ProductKey>([
  "ten-mien", "hosting", "vibe-hosting", "google-workspace", "microsoft-365",
  "email-dn", "ssl", "sale-ai", "custom",
]);
const MBI_PRODUCTS = new Set<ProductKey>([
  "hoa-don-dien-tu", "chu-ky-so", "hop-dong-dien-tu",
  "hoa-don-ecom", "khoa-hoc-thue", "custom",
]);

// Map creative brief product key → PRODUCTS_KB key
const KB_KEY_MAP: Partial<Record<ProductKey, string>> = {
  "ten-mien":       "ten-mien",
  "hosting":        "hosting",
  "vibe-hosting":   "vibe-hosting",
  "google-workspace":"google-workspace",
  "microsoft-365":  "microsoft-365",
  "chu-ky-so":      "chu-ky-so",
  "hoa-don-dien-tu":"hoa-don-dien-tu",
  "khoa-hoc-thue":  "khoa-hoc-thue",
  "sale-ai":        "sale-ai",
};

// Map to google-creative-engine catalog key
const CATALOG_KEY_MAP: Partial<Record<ProductKey, string>> = {
  "ten-mien":        "DOMAIN",
  "hosting":         "HOSTING",
  // Chưa có mục riêng trong catalog Google — dùng tạm HOSTING để không rơi vào
  // nhánh "không có sản phẩm". Cần mục riêng thì phải bổ sung ở catalog trước.
  "vibe-hosting":    "HOSTING",
  "email-dn":        "EMAIL_BUSINESS",
  "microsoft-365":   "MICROSOFT_365",
  "google-workspace":"GOOGLE_WORKSPACE",
  "ssl":             "SSL",
  "sale-ai":         "SALE_AI",
  "hoa-don-dien-tu": "HOA_DON_DIEN_TU",
  "chu-ky-so":       "CHU_KY_SO",
  "hop-dong-dien-tu":"HOP_DONG_DIEN_TU",
  "hoa-don-ecom":    "HOA_DON_ECOM",
};

export interface ResolvedProduct {
  key:          ProductKey;
  displayName:  string;
  category:     string;
  company:      BriefCompany;
  usps:         string[];          // ranked: top USPs for this funnel stage first
  painPoints:   PainPoint[];
  proofPoints:  ProofPoint[];
  searchIntents: string[];
  competitorWeaknesses: string[];  // for whitespace copy angles
}

function validateCompanySilo(company: BriefCompany, product: ProductKey): void {
  if (product === "custom") return;
  const ownedByMbc = MBC_PRODUCTS.has(product);
  const ownedByMbi = MBI_PRODUCTS.has(product);
  if (company === "MBC" && !ownedByMbc) {
    throw new Error(`Product "${product}" does not belong to MBC. MBC products: ${[...MBC_PRODUCTS].join(", ")}`);
  }
  if (company === "MBI" && !ownedByMbi) {
    throw new Error(`Product "${product}" does not belong to MBI. MBI products: ${[...MBI_PRODUCTS].join(", ")}`);
  }
}

function rankUspsByFunnel(usps: string[], funnelStage: BriefFunnelStage): string[] {
  // TOFU: brand/awareness USPs first; BOFU: differentiator/price USPs first
  if (funnelStage === "top") {
    // move mentions of "hỗ trợ", "dễ dùng", "nhanh" to front
    return [...usps].sort((a, b) => {
      const aAware = /hỗ trợ|dễ|nhanh|đơn giản/i.test(a) ? -1 : 1;
      const bAware = /hỗ trợ|dễ|nhanh|đơn giản/i.test(b) ? -1 : 1;
      return aAware - bAware;
    });
  }
  if (funnelStage === "bottom") {
    // move price/offer/guarantee USPs to front
    return [...usps].sort((a, b) => {
      const aConv = /giá|ưu đãi|cam kết|tiết kiệm|chỉ từ|miễn phí/i.test(a) ? -1 : 1;
      const bConv = /giá|ưu đãi|cam kết|tiết kiệm|chỉ từ|miễn phí/i.test(b) ? -1 : 1;
      return aConv - bConv;
    });
  }
  return usps; // mid: keep original order
}

export function resolveProduct(
  company: BriefCompany,
  product: ProductKey,
  funnelStage: BriefFunnelStage,
): ResolvedProduct {
  validateCompanySilo(company, product);

  const kbKey  = KB_KEY_MAP[product];
  const catKey = CATALOG_KEY_MAP[product];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kb   = kbKey ? (PRODUCTS_KB as Record<string, any>)[kbKey] : null;
  const catalog = catKey
    ? (company === "MBC" ? MBC_PRODUCT_CATALOG : MBI_PRODUCT_CATALOG)[catKey]
    : null;

  const displayName: string = kb?.name ?? catalog?.name ?? product;
  const category:    string = kb?.category ?? catalog?.id ?? "Product";

  // USPs: merge KB uniqueSellingPoints + catalog usp, deduplicate
  const rawUsps: string[] = [
    ...(kb?.uniqueSellingPoints ?? []),
    ...(catalog?.usp ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i);
  const usps = rankUspsByFunnel(rawUsps, funnelStage);

  // Pain points: KB personas + catalog, deduplicate, classify severity
  const kbPains: string[] = kb?.targetAudience?.primaryPersonas
    ?.flatMap((p: { painPoints?: string[] }) => p.painPoints ?? []) ?? [];
  const catPains: string[] = catalog?.painPoints ?? [];
  const allPains = [...new Set([...kbPains, ...catPains])];

  const painPoints: PainPoint[] = allPains.map(text => ({
    text,
    severity: /không biết|sợ|mất|ngừng|downtime|lỗi|phức tạp/i.test(text) ? "critical" : "moderate",
    source: kbPains.includes(text) ? "product-kb" : "segment",
  }));

  // Proof points from customer questions and offers
  const proofPoints: ProofPoint[] = [
    ...(kb?.topOffers?.map((o: string) => ({ type: "stat" as const, text: o })) ?? []),
    ...(kb?.realCustomerQuestions?.slice(0, 2).map(
      (q: { copyAngle?: string }) => ({ type: "social" as const, text: q.copyAngle ?? "" })
    ).filter((p: ProofPoint) => p.text) ?? []),
  ];

  // Search intents: catalog first (more precise), then from KB pain points
  const searchIntents: string[] = [
    ...(catalog?.searchIntents ?? []),
  ].slice(0, 6);

  // Competitor weaknesses for whitespace angles
  const competitorWeaknesses: string[] = kb?.competitors
    ?.flatMap((c: { weaknesses?: string[] }) => c.weaknesses ?? [])
    .slice(0, 4) ?? [];

  return {
    key: product,
    displayName,
    category,
    company,
    usps,
    painPoints,
    proofPoints,
    searchIntents,
    competitorWeaknesses,
  };
}
