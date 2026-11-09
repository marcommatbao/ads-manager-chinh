// ============================================================
// Page ID / Pixel ID của từng công ty — ĐỌC TỪ BIẾN MÔI TRƯỜNG.
// ------------------------------------------------------------
// VÌ SAO KHÔNG ĐỂ TRONG MÃ NỮA (đổi 17/09/2026, chuẩn bị đưa repo lên công khai
// để Vibe Host build được):
//
// Bốn ID này trước đây nằm hardcode ở 4 chỗ trong creative/page.tsx. Chúng
// KHÔNG phải khoá bí mật — Page ID nhìn thấy trên chính trang Facebook, Pixel
// ID nằm trong mã nguồn website — nhưng để nguyên trong một repo CÔNG KHAI kèm
// nhãn "đây là pixel của Mắt Bão" thì ai cũng bắn được sự kiện giả vào pixel,
// làm nhiễu dữ liệu tối ưu của Facebook. Không mất tiền trực tiếp, nhưng làm
// hỏng chất lượng quảng cáo.
//
// Dùng tiền tố NEXT_PUBLIC_ vì các trang dùng chúng là client component: pixel
// phải nằm ở phía trình duyệt mới hoạt động được. Nghĩa là giá trị vẫn đi vào
// gói client — ĐÚNG NHƯ HIỆN NAY, không tệ hơn. Điều thay đổi là chúng không
// còn nằm trong repo.
//
// Thiếu biến → trả chuỗi rỗng, giao diện hiện "chưa cấu hình". CỐ Ý không để
// giá trị thật làm fallback: làm vậy thì giá trị vẫn nằm trong repo, tức không
// giải quyết được gì.
// ============================================================

import { allCompanyDefs, companyDef, companyIds, publicIdFromConfig } from "@/lib/companies/registry";

export type MetaCompany = string;

/** Các công ty có fanpage/pixel Meta để chạy campaign = công ty CHẠY QUẢNG CÁO của bản cài (SALE_AI chỉ có pixel + GA4).
 *  Đợt 21 (làm sạch MBC/MBI): trước đây ghim ["MBC","MBI"] → bản cài khách có ô chọn Trang / Pixel RỖNG và
 *  metaAccountsConfigured() = false. Bản Mắt Bão: vẫn đúng ["MBC","MBI"] (đối chứng tests/case/dot21-golden.test.ts). */
export const metaPageCompanies = (): MetaCompany[] => companyIds();
/** Mọi công ty của bản cài, kể cả công ty không chạy quảng cáo (bản Mắt Bão: MBC, MBI, SALE_AI). */
export const allMetaCompanies = (): MetaCompany[] => allCompanyDefs().map((c) => c.id);
/** Hậu tố biến môi trường của công ty (bản Mắt Bão: trùng mã công ty). */
const suf = (company: MetaCompany): string => companyDef(company)?.envSuffix ?? company;

export interface MetaAccountIds {
  pageId: string;
  pixelId: string;
}

// Viết `process.env.TÊN_ĐẦY_ĐỦ` dạng TĨNH — đừng rút gọn thành vòng lặp hay
// template string.
//
// ĐO THẬT 17/09/2026, và kết quả NGƯỢC với điều tôi tưởng: tài liệu của Next bản
// đang cài (node_modules/next/dist/docs/01-app/02-guides/environment-variables.md,
// mục "dynamic lookups will not be inlined") nói `process.env[varName]` KHÔNG
// được nội suy. Tôi tưởng bản đầu của tệp này — dùng đúng kiểu đó — đã hỏng trên
// trình duyệt. Build cả hai bản rồi soi gói client: **cả hai đều nội suy đủ**
// (cùng 7 tệp trong .next/static). Ở cấu hình build này Next thay cả cụm
// `process.env`, nên truy cập động vẫn ra giá trị.
//
// Vẫn giữ bảng tĩnh, vì ba lý do KHÔNG liên quan đến lỗi:
//   1. Đây là cách tài liệu Next khuyến nghị → không phụ thuộc vào một hành vi
//      mà tài liệu đã nói trước là đừng dựa vào.
//   2. Bảng này là danh sách tường minh các biến cần có LÚC BUILD, phải khớp
//      với khối ARG trong Dockerfile.
//   3. Thêm công ty mới thì thấy ngay phải thêm 7 dòng.
//
// ĐIỀU CÓ THẬT và quan trọng hơn: mọi biến ở đây được nội suy LÚC BUILD, nên
// đổi giá trị ở runtime KHÔNG có tác dụng với phía client — phải đặt biến ở
// build rồi build lại (Coolify: cờ is_buildtime).
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_META_PAGE_ID_MBC:            process.env.NEXT_PUBLIC_META_PAGE_ID_MBC,
  NEXT_PUBLIC_META_PAGE_ID_MBI:            process.env.NEXT_PUBLIC_META_PAGE_ID_MBI,
  NEXT_PUBLIC_META_PAGE_ID_SALE_AI:        process.env.NEXT_PUBLIC_META_PAGE_ID_SALE_AI,

  NEXT_PUBLIC_META_PIXEL_ID_MBC:           process.env.NEXT_PUBLIC_META_PIXEL_ID_MBC,
  NEXT_PUBLIC_META_PIXEL_ID_MBI:           process.env.NEXT_PUBLIC_META_PIXEL_ID_MBI,
  NEXT_PUBLIC_META_PIXEL_ID_SALE_AI:       process.env.NEXT_PUBLIC_META_PIXEL_ID_SALE_AI,

  NEXT_PUBLIC_META_PAGE_LABEL_MBC:         process.env.NEXT_PUBLIC_META_PAGE_LABEL_MBC,
  NEXT_PUBLIC_META_PAGE_LABEL_MBI:         process.env.NEXT_PUBLIC_META_PAGE_LABEL_MBI,
  NEXT_PUBLIC_META_PAGE_LABEL_SALE_AI:     process.env.NEXT_PUBLIC_META_PAGE_LABEL_SALE_AI,

  NEXT_PUBLIC_META_PIXEL_LABEL_MBC:        process.env.NEXT_PUBLIC_META_PIXEL_LABEL_MBC,
  NEXT_PUBLIC_META_PIXEL_LABEL_MBI:        process.env.NEXT_PUBLIC_META_PIXEL_LABEL_MBI,
  NEXT_PUBLIC_META_PIXEL_LABEL_SALE_AI:    process.env.NEXT_PUBLIC_META_PIXEL_LABEL_SALE_AI,

  NEXT_PUBLIC_GA4_PROPERTY_ID_MBC:         process.env.NEXT_PUBLIC_GA4_PROPERTY_ID_MBC,
  NEXT_PUBLIC_GA4_PROPERTY_ID_MBI:         process.env.NEXT_PUBLIC_GA4_PROPERTY_ID_MBI,
  NEXT_PUBLIC_GA4_PROPERTY_ID_SALE_AI:     process.env.NEXT_PUBLIC_GA4_PROPERTY_ID_SALE_AI,

  NEXT_PUBLIC_GA4_STREAM_ID_MBC:           process.env.NEXT_PUBLIC_GA4_STREAM_ID_MBC,
  NEXT_PUBLIC_GA4_STREAM_ID_MBI:           process.env.NEXT_PUBLIC_GA4_STREAM_ID_MBI,
  NEXT_PUBLIC_GA4_STREAM_ID_SALE_AI:       process.env.NEXT_PUBLIC_GA4_STREAM_ID_SALE_AI,

  NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBC:      process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBC,
  NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBI:      process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBI,
  NEXT_PUBLIC_GA4_MEASUREMENT_ID_SALE_AI:  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID_SALE_AI,
};

/** Đọc một biến NEXT_PUBLIC_* từ bảng tĩnh ở trên; thiếu thì rỗng (không đoán). */
function env(name: string): string {
  // Đợt 21 A4: ở MÁY CHỦ đọc biến LÚC CHẠY (mã dán ở Cài đặt → API Keys có hiệu lực ngay; bản Mắt Bão: cùng giá trị như cũ).
  if (typeof window === "undefined") {
    const live = process.env[name];
    if (typeof live === "string" && live.trim()) return live.trim();
  }
  // Trình duyệt: ưu tiên mã máy chủ chèn sẵn (boot-script, cùng nguồn biến lúc chạy với máy chủ → không lệch khi hydrate),
  // rồi mới tới giá trị dán sẵn lúc build.
  if (typeof window !== "undefined") {
    const injected = publicIdFromConfig(name);
    if (injected) return injected;
  }
  const raw = PUBLIC_ENV[name];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return publicIdFromConfig(name) ?? "";
}


export function metaAccountIds(company: MetaCompany): MetaAccountIds {
  return {
    pageId:  env(`NEXT_PUBLIC_META_PAGE_ID_${suf(company)}`),
    pixelId: env(`NEXT_PUBLIC_META_PIXEL_ID_${suf(company)}`),
  };
}

/** Pixel mặc định theo công ty. Rỗng = chưa cấu hình. */
export function defaultPixelId(company: string): string {
  return allMetaCompanies().includes(company as MetaCompany)
    ? metaAccountIds(company as MetaCompany).pixelId
    : "";
}

/** Page ID theo công ty, dạng bản đồ — thay cho hằng PAGE_IDS cũ. */
export function pageIdsByCompany(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of metaPageCompanies()) {
    const id = metaAccountIds(c).pageId;
    if (id) out[c] = id;
  }
  return out;
}

/** Page ID → Pixel ID, để tự chọn pixel khi đổi fanpage. */
export function pagePixelMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of metaPageCompanies()) {
    const { pageId, pixelId } = metaAccountIds(c);
    if (pageId && pixelId) out[pageId] = pixelId;
  }
  return out;
}

/** Danh sách pixel cho ô chọn. Nhãn lấy từ env để tên site cũng không nằm trong mã. */
export function pixelOptions(): Array<{ id: string; label: string }> {
  const opts: Array<{ id: string; label: string }> = [];
  for (const c of metaPageCompanies()) {
    const { pixelId } = metaAccountIds(c);
    if (!pixelId) continue;
    const label = env(`NEXT_PUBLIC_META_PIXEL_LABEL_${suf(c)}`) || c;
    opts.push({ id: pixelId, label: `${label} — ${pixelId}` });
  }
  return opts;
}

/** true = chưa cấu hình đủ để chạy phần khởi chạy campaign Meta. */
export function metaAccountsConfigured(): boolean {
  return pixelOptions().length > 0;
}

/** Tên hiển thị của fanpage. Lấy từ env để tên công ty/site cũng không nằm trong mã. */
export function pageLabel(company: MetaCompany): string {
  return env(`NEXT_PUBLIC_META_PAGE_LABEL_${suf(company)}`) || company;
}

/** Danh sách fanpage đã biết — thay cho hằng FALLBACK_PAGES / PAGE_IDS cũ. */
export function knownPages(): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const c of metaPageCompanies()) {
    const id = metaAccountIds(c).pageId;
    if (id) out.push({ id, name: pageLabel(c) });
  }
  return out;
}

/**
 * GA4 Measurement ID theo công ty. Cùng lý do như Pixel ID: không phải khoá
 * (nằm trong mã nguồn website) nhưng không nên nằm trong repo công khai.
 */
export function ga4MeasurementId(company: MetaCompany): string {
  return env(`NEXT_PUBLIC_GA4_MEASUREMENT_ID_${suf(company)}`);
}

export interface Ga4Ids {
  propertyId: string;   // dạng "properties/123456789" (API GA4 yêu cầu tiền tố này)
  streamId: string;
  measurementId: string;
}

/**
 * Bộ ID GA4 của một công ty. Cũng ra biến môi trường (đổi 17/09/2026): property
 * ID + stream ID không cho ai đọc được số liệu (vẫn cần OAuth) nhưng là cấu
 * hình nội bộ, và để trong repo công khai thì lộ luôn công ty này đo bao nhiêu
 * site, site nào.
 *
 * Nhận cả hai cách ghi property ID: "123456789" hoặc "properties/123456789" —
 * tự thêm tiền tố nếu thiếu, vì giao diện GA4 hiển thị số trần và người cấu
 * hình rất dễ dán đúng số đó.
 */
export function ga4Ids(company: MetaCompany): Ga4Ids {
  const rawProp = env(`NEXT_PUBLIC_GA4_PROPERTY_ID_${suf(company)}`);
  const propertyId = !rawProp ? "" : /^properties\//.test(rawProp) ? rawProp : `properties/${rawProp}`;
  return {
    propertyId,
    streamId: env(`NEXT_PUBLIC_GA4_STREAM_ID_${suf(company)}`),
    measurementId: ga4MeasurementId(company),
  };
}
