#!/usr/bin/env node
// ============================================================
// Chặn mốc ngày GAQL không hợp lệ quay lại.
// ------------------------------------------------------------
// Toán tử DURING của Google Ads chỉ nhận đúng 12 chuỗi. Viết sai một chuỗi thì
// truy vấn hỏng 100%, mà mọi chỗ gọi đều bọc try/catch nên nó hỏng IM LẶNG —
// hiện ra như "không có dữ liệu". Đã dính 3 giá trị sai ở 6 chỗ cùng lúc
// (LAST_3_DAYS, LAST_60_DAYS, LAST_90_DAYS), phát hiện 16/09/2026.
//
// Script này đọc danh sách hợp lệ TỪ CHÍNH SDK đang cài, không chép tay — SDK
// nâng cấp thì danh sách tự đi theo.
//
// Chạy: node scripts/check-gaql-dates.mjs
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SDK_TYPES = "node_modules/google-ads-api/build/src/types.d.ts";
const ROOTS = ["lib", "app", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "certs", "public"]);
// Bỏ qua chính nó: câu báo lỗi của script có chữ "DURING".
const SELF = "scripts/check-gaql-dates.mjs";

function validConstants() {
  const src = readFileSync(SDK_TYPES, "utf8");
  const m = src.match(/export type DateConstant\s*=\s*([^;]+);/);
  if (!m) {
    console.error(`✗ Không đọc được type DateConstant từ ${SDK_TYPES}.`);
    console.error("  SDK có thể đã đổi cấu trúc — sửa script này trước khi tin kết quả.");
    process.exit(2);
  }
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if ([".ts", ".tsx", ".mjs"].includes(extname(full))) yield full;
  }
}

const valid = validConstants();
const problems = [];

for (const root of ROOTS) {
  let ok = true;
  try { statSync(root); } catch { ok = false; }
  if (!ok) continue;
  for (const file of walk(root)) {
    if (file.replace(/\\/g, "/").endsWith(SELF)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      const trimmed = line.trim();
      // Bỏ qua dòng chú thích: tài liệu được phép nhắc tên mốc để giải thích.
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
      // Bắt `DURING <CHỮ_IN_HOA>` dài ≥3 ký tự. Bỏ qua dạng nội suy
      // `DURING ${...}` — chỗ đó đã đi qua helper, helper có test riêng.
      for (const m of line.matchAll(/DURING\s+([A-Z][A-Z0-9_]{2,})/g)) {
        if (!valid.has(m[1])) {
          problems.push({ file, line: i + 1, literal: m[1], text: line.trim() });
        }
      }
    });
  }
}

if (problems.length === 0) {
  console.log(`✓ Không có mốc DURING nào sai (đối chiếu ${valid.size} giá trị của SDK).`);
  process.exit(0);
}

console.error(`✗ Tìm thấy ${problems.length} mốc DURING KHÔNG hợp lệ:\n`);
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  →  ${p.literal}`);
  console.error(`      ${p.text}`);
}
console.error(`\nGoogle chỉ nhận ${valid.size} giá trị: ${[...valid].sort().join(", ")}`);
console.error("Cần khoảng ngày khác? Dùng dateClauseForDays() ở lib/google-date-range.ts —");
console.error("nó tự dựng BETWEEN với ngày tường minh.");
process.exit(1);
