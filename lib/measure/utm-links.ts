// ============================================================
// Bảng link chuẩn utm + luật kiểm liên kết quảng cáo Facebook
// ============================================================
// Quy ước của user (chốt 27/09): link nhập TAY theo quy định riêng để dễ kiểm
// soát — utm_source=facebook_ads, utm_medium=cpc_fb, utm_campaign theo SẢN
// PHẨM / trang (vd "hop-dong-dien-tu", "hoa-don-dien-tu-sitelink"). Tool KHÔNG
// tự đặt tên, chỉ so với bảng link chuẩn user nhập và gợi ý đúng link đó.
//
// Hệ quả phải nói ra ở giao diện: một utm_campaign dùng chung cho nhiều chiến
// dịch → doanh thu Odoo đọc theo SẢN PHẨM, không chia được cho từng chiến dịch.
//
// Meta không cho sửa nội dung quảng cáo đã chạy (thay nội dung = duyệt lại),
// nên luật này chỉ PHÁT HIỆN + giao việc (user chốt hướng 1, 27/09).

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { DEFAULT_LINKS, type StandardLink } from "./utm-rules"

export * from "./utm-rules"

const FILE = path.join(process.cwd(), "data", "utm-standard-links.json")

export function readStandardLinks(): { links: StandardLink[]; updatedBy: string | null; updatedAt: string | null; isDefault: boolean } {
  try {
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, "utf-8")) as { links?: StandardLink[]; updatedBy?: string; updatedAt?: string }
      // Tệp cũ chưa có cột công ty → coi là MBI (bảng đầu tiên user gửi là link matbao.in).
      if (Array.isArray(j.links)) return { links: j.links.map((l) => ({ ...l, company: l.company ?? "MBI", platform: l.platform ?? "facebook" })), updatedBy: j.updatedBy ?? null, updatedAt: j.updatedAt ?? null, isDefault: false }
    }
  } catch (err) {
    console.error("[utm-links] không đọc được bảng link chuẩn:", err)
  }
  return { links: DEFAULT_LINKS, updatedBy: null, updatedAt: null, isDefault: true }
}

export function writeStandardLinks(links: StandardLink[], actor: string): void {
  const dir = path.dirname(FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify({ links: links.map((l) => ({ company: l.company, platform: l.platform, label: l.label.trim(), url: l.url.trim() })), updatedBy: actor, updatedAt: new Date().toISOString() }, null, 2))
}

