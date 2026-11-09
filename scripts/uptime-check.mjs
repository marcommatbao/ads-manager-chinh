#!/usr/bin/env node
// ============================================================
// P5 — Kiểm nhịp sống app TỪ BÊN NGOÀI container
// ============================================================
// VÌ SAO LÀ MỘT SCRIPT RỜI, KHÔNG PHẢI MỘT CRON TRONG APP:
// `app/api/cron/job-health-monitor` nằm TRONG container. Container chết thì
// nó chết theo — đúng lúc cần nó nhất thì nó không còn. Ngày 21/09 container
// đã dừng thật và không ai được báo. Phép kiểm phải sống ở nơi khác.
//
// Tệp này cố ý KHÔNG import gì từ repo và không cần `npm install`: chỉ cần
// Node là chạy được ở bất cứ đâu — máy khác, workspace khác, cron hệ thống,
// CI. Dán đi đâu cũng chạy.
//
// CHẠY:
//   HEALTH_URL=https://ads-manager.mk.dev.matbao.ai/api/health \
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
//   node scripts/uptime-check.mjs
//
// Biến tuỳ chọn:
//   FAIL_THRESHOLD  số lần hỏng LIÊN TIẾP mới báo động (mặc định 3)
//   TIMEOUT_MS      chờ tối đa mỗi lượt (mặc định 15000)
//   STATE_FILE      nơi nhớ số lần hỏng liên tiếp (mặc định ./.uptime-state.json)
//
// Mã thoát: 0 = app sống, 1 = app có vấn đề, 2 = script bị gọi sai.
// ============================================================

import fs from "node:fs";

const HEALTH_URL = process.env.HEALTH_URL;
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const THRESHOLD = Math.max(1, Number(process.env.FAIL_THRESHOLD ?? 3) || 3);
const TIMEOUT_MS = Math.max(1000, Number(process.env.TIMEOUT_MS ?? 15000) || 15000);
const STATE_FILE = process.env.STATE_FILE ?? "./.uptime-state.json";

if (!HEALTH_URL) {
  console.error("Thiếu HEALTH_URL. Xem hướng dẫn ở đầu tệp.");
  process.exit(2);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); }
  catch { return { consecutiveFailures: 0, alerted: false, lastOkAt: null }; }
}
function writeState(s) {
  // Ghi ĐỒNG BỘ: script này thường chạy rồi thoát ngay, ghi bất đồng bộ không
  // await là mất trạng thái — đúng lỗi đã gặp ở lib/apply-undo-log.
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
  catch (e) { console.error("Không ghi được state:", e.message); }
}

async function telegram(text) {
  if (!BOT || !CHAT) {
    console.error("Không gửi được cảnh báo: thiếu TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) { console.error("Telegram trả", res.status); return false; }
    return true;
  } catch (e) { console.error("Gửi Telegram hỏng:", e.message); return false; }
}

/** Một lượt đo. Trả { ok, detail, uptimeSec }. */
async function probe() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    // Phải thấy đúng dấu hiệu của CHÍNH tiến trình app. Trang lỗi của Traefik
    // cũng trả 200 được — nếu chỉ xét mã HTTP thì app chết mà vẫn báo xanh.
    if (!body || body.ok !== true || typeof body.uptimeSec !== "number") {
      return { ok: false, detail: "Phản hồi 200 nhưng không phải app (có thể là trang của proxy)" };
    }
    return { ok: true, detail: "ok", uptimeSec: body.uptimeSec };
  } catch (e) {
    return { ok: false, detail: e.name === "AbortError" ? `không phản hồi trong ${TIMEOUT_MS / 1000}s` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const state = readState();
const r = await probe();
const now = new Date().toISOString();

if (r.ok) {
  // Vừa hồi phục sau khi đã báo động → báo lại một lần, rồi im.
  if (state.alerted) {
    await telegram(`✅ *AdsCommand đã sống lại*\n· Địa chỉ: ${HEALTH_URL}\n· Lúc: ${now}\n· Tiến trình chạy được: ${r.uptimeSec}s`);
  }
  writeState({ consecutiveFailures: 0, alerted: false, lastOkAt: now });
  console.log(`[${now}] OK — uptime ${r.uptimeSec}s`);
  process.exit(0);
}

const fails = (state.consecutiveFailures ?? 0) + 1;
console.error(`[${now}] HỎNG (${fails}/${THRESHOLD}) — ${r.detail}`);

// Chỉ báo động khi hỏng LIÊN TIẾP đủ ngưỡng, và chỉ báo MỘT lần cho mỗi đợt.
// Bắn mỗi lượt là con đường ngắn nhất tới việc người ta tắt chuông — đã có
// tiền lệ 144 thẻ/ngày ở dự án khác.
let alerted = state.alerted ?? false;
if (fails >= THRESHOLD && !alerted) {
  alerted = await telegram(
    `🚨 *AdsCommand không phản hồi*\n` +
    `· Địa chỉ: ${HEALTH_URL}\n` +
    `· Lý do: ${r.detail}\n` +
    `· Hỏng liên tiếp: ${fails} lượt\n` +
    `· Lần cuối còn sống: ${state.lastOkAt ?? "không rõ"}\n\n` +
    `Kiểm container trên ops.matbao.ai.`
  );
}
writeState({ consecutiveFailures: fails, alerted, lastOkAt: state.lastOkAt ?? null });
process.exit(1);
