// ============================================================
// GET /api/attribution/by-product?month=YYYY-MM&company=MBC|MBI
// Chi phí quảng cáo (Meta + Google) gom theo sản phẩm.
//
// Trả về 2 chiều dữ liệu từ CÙNG một nguồn mapping
// (lib/ad-product-mapping.ts):
//   • products[]    — gom theo nhóm doanh thu Odoo (revenueKey)
//                     → để bảng "Hiệu suất theo sản phẩm" có Chi phí QC/ROAS/CPO.
//   • adProducts[]  — gom theo sản phẩm quảng cáo granular (TÊN MIỀN, VIBE,
//                     SALE AI, ELASTIC CLOUD, ...) → khu vực "Chi phí Quảng Cáo
//                     Từng Sản Phẩm".
// Spend không khớp rule nào → "Khác / chưa phân loại" (minh bạch, không giấu).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { gatherCampaigns } from "@/lib/nba/gather";
import { getGroupsForCompany } from "@/lib/odoo-product-categories";
import { adProductsForCompany, matchAdProduct, type Company } from "@/lib/ad-product-mapping";
import { friendlyError } from "@/lib/not-configured";

// ── Month → date range ───────────────────────────────────────

function monthBounds(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const now = new Date();
  const y   = m ? Number(m[1]) : now.getFullYear();
  const mo  = m ? Number(m[2]) : now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${y}-${pad(mo)}-01`;
  const daysInMonth = new Date(y, mo, 0).getDate();
  const to   = `${y}-${pad(mo)}-${pad(daysInMonth)}`;
  return { from, to };
}

// ── Response shapes ───────────────────────────────────────────

/** Gom theo nhóm doanh thu Odoo (revenueKey) — dùng cho bảng Hiệu suất. */
export interface ProductAttribution {
  key: string;
  label: string;
  icon: string;
  metaSpend: number;
  googleSpend: number;
  totalSpend: number;
}

/** 1 chiến dịch góp chi phí vào 1 ad product (để hiển thị drill-down). */
export interface AdProductCampaign {
  name: string;
  spend: number;
}

/** Gom theo sản phẩm quảng cáo granular — dùng cho khu vực Chi phí QC từng SP. */
export interface AdProductSpend {
  key: string;
  label: string;
  icon: string;
  metaSpend: number;
  googleSpend: number;
  totalSpend: number;
  /** Tên các chiến dịch đã gom vào sản phẩm này, sắp giảm dần theo chi phí. */
  campaigns: AdProductCampaign[];
}

type SpendSplit = { metaSpend: number; googleSpend: number; totalSpend: number };

export interface AttributionResponse {
  month: string;
  company: string;
  products: ProductAttribution[];
  adProducts: AdProductSpend[];
  /** Campaign THẬT SỰ chưa phân loại (không khớp rule nào) — cảnh báo vàng. */
  unattributed: SpendSplit;
  /** Campaign thương hiệu/sự kiện: đã phân loại nhưng sản phẩm không có doanh thu (revenueKey=null) — thông tin trung tính. */
  brandAwareness: SpendSplit;
  totalSpend: number;
  /** Chỉ có mặt khi gatherCampaigns/mapping lỗi — payload vẫn all-zero (HTTP 200)
   *  nhưng caller cần phân biệt "thật sự chưa có spend" với "backend lỗi". */
  error?: string;
}

// ── Cache (5 min) ─────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { data: unknown; exp: number }>();

// ── Handler ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month   = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const company = (searchParams.get("company") ?? "MBC") as Company;

  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  // bump version khi đổi logic mapping để cache cũ không che số mới
  // v5: Matbao-Sign tách khỏi revenueKey "cts" (không còn gộp vào "Chữ ký số")
  // v6: (đã revert) Matbao-Sign có revenueKey riêng "matbao-sign" — sai, xem v7
  // v7: revert v6 — type_id=11 "matbaoSign" là tag kênh đặt đơn, không phải sản
  //     phẩm; Matbao-Sign về lại revenueKey: null (cost-only), không đoán bừa
  const cacheKey = `attr-by-product:v7:${company}:${month}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return NextResponse.json(cached.data);
  }

  try {
    const { from, to } = monthBounds(month);
    const campaigns = await gatherCampaigns({ from, to });

    // Accumulators
    const revenueAcc  = new Map<string, { meta: number; google: number }>();   // theo revenueKey
    const adAcc       = new Map<string, { meta: number; google: number }>();    // theo ad product key
    const adCampaigns = new Map<string, Map<string, number>>();                 // ad product key → tên chiến dịch → spend
    const brand       = { meta: 0, google: 0 };   // đã phân loại nhưng SP không có doanh thu (revenueKey=null)
    const unmatched   = { meta: 0, google: 0 };   // không khớp rule nào (thật sự chưa phân loại)

    const addTo = (m: Map<string, { meta: number; google: number }>, key: string, isGoogle: boolean, spend: number) => {
      const e = m.get(key) ?? { meta: 0, google: 0 };
      if (isGoogle) e.google += spend; else e.meta += spend;
      m.set(key, e);
    };

    const addCampaign = (key: string, name: string, spend: number) => {
      const m = adCampaigns.get(key) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + spend);
      adCampaigns.set(key, m);
    };

    for (const c of campaigns) {
      if (c.company !== company) continue;
      const spend = c.metrics?.spend ?? 0;
      if (spend <= 0) continue;

      const isGoogle = c.platform === "google";
      const product  = matchAdProduct(c.name, company);

      if (product) {
        addTo(adAcc, product.key, isGoogle, spend);
        addCampaign(product.key, c.name, spend);
        if (product.revenueKey) addTo(revenueAcc, product.revenueKey, isGoogle, spend);
        else { if (isGoogle) brand.google += spend; else brand.meta += spend; }
      } else {
        addTo(adAcc, "__other__", isGoogle, spend);
        addCampaign("__other__", c.name, spend);
        if (isGoogle) unmatched.google += spend; else unmatched.meta += spend;
      }
    }

    const campaignsFor = (key: string): AdProductCampaign[] =>
      [...(adCampaigns.get(key) ?? new Map<string, number>())]
        .map(([name, spend]) => ({ name, spend: Math.round(spend) }))
        .sort((a, b) => b.spend - a.spend);

    // 1. products[] theo nhóm doanh thu Odoo (giữ thứ tự khai báo)
    const groups = getGroupsForCompany(company);
    const products: ProductAttribution[] = groups.map(g => {
      const e = revenueAcc.get(g.key) ?? { meta: 0, google: 0 };
      return {
        key: g.key, label: g.label, icon: g.icon,
        metaSpend: Math.round(e.meta),
        googleSpend: Math.round(e.google),
        totalSpend: Math.round(e.meta + e.google),
      };
    });

    // 2. adProducts[] theo sản phẩm quảng cáo granular (giữ thứ tự khai báo)
    const adProducts: AdProductSpend[] = adProductsForCompany(company).map(p => {
      const e = adAcc.get(p.key) ?? { meta: 0, google: 0 };
      return {
        key: p.key, label: p.label, icon: p.icon,
        metaSpend: Math.round(e.meta),
        googleSpend: Math.round(e.google),
        totalSpend: Math.round(e.meta + e.google),
        campaigns: campaignsFor(p.key),
      };
    });
    // dòng "Khác / chưa phân loại" nếu có spend không khớp rule nào
    const otherEntry = adAcc.get("__other__");
    if (otherEntry && otherEntry.meta + otherEntry.google > 0) {
      adProducts.push({
        key: "__other__", label: "Khác / chưa phân loại", icon: "❓",
        metaSpend: Math.round(otherEntry.meta),
        googleSpend: Math.round(otherEntry.google),
        totalSpend: Math.round(otherEntry.meta + otherEntry.google),
        campaigns: campaignsFor("__other__"),
      });
    }

    const totalSpend = adProducts.reduce((s, p) => s + p.totalSpend, 0);

    const result: AttributionResponse = {
      month, company,
      products,
      adProducts,
      unattributed: {
        metaSpend: Math.round(unmatched.meta),
        googleSpend: Math.round(unmatched.google),
        totalSpend: Math.round(unmatched.meta + unmatched.google),
      },
      brandAwareness: {
        metaSpend: Math.round(brand.meta),
        googleSpend: Math.round(brand.google),
        totalSpend: Math.round(brand.meta + brand.google),
      },
      totalSpend,
    };

    cache.set(cacheKey, { data: result, exp: Date.now() + CACHE_TTL });
    return NextResponse.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[attribution/by-product] error:", msg);
    // Trả rỗng khi lỗi (không chặn KPI tab), nhưng kèm `error` để caller phân
    // biệt được với "tháng này thật sự chưa có spend" (xem AttributionResponse.error).
    const groups = getGroupsForCompany(company);
    return NextResponse.json({
      month, company,
      products: groups.map(g => ({ key: g.key, label: g.label, icon: g.icon, metaSpend: 0, googleSpend: 0, totalSpend: 0 })),
      adProducts: adProductsForCompany(company).map(p => ({ key: p.key, label: p.label, icon: p.icon, metaSpend: 0, googleSpend: 0, totalSpend: 0, campaigns: [] })),
      unattributed: { metaSpend: 0, googleSpend: 0, totalSpend: 0 },
      brandAwareness: { metaSpend: 0, googleSpend: 0, totalSpend: 0 },
      totalSpend: 0,
      error: friendlyError(msg),
    } satisfies AttributionResponse);
  }
}
