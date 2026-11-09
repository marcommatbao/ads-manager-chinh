// ============================================================
// Job Health Alerts — dedup state for job-health-monitor
//
// Không lưu MỌI lần kiểm (job này tự chạy 10 phút/lần), chỉ lưu trạng thái
// XẤU/TỐT gần nhất của từng job + lần cuối đã gửi thẻ Teams — để:
//   1. Chỉ báo NGAY khi một job vừa chuyển từ tốt sang xấu.
//   2. Trong lúc còn xấu, chỉ NHẮC LẠI mỗi REMIND_INTERVAL_MS, không phải
//      mỗi 10 phút — báo dồn dập rồi bị tắt chuông là mất luôn lần cần thật.
//   3. Báo một lần khi job HỒI PHỤC, để người nhận biết sự cố đã qua chứ
//      không phải đoán im lặng.
// ============================================================

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { JobId } from "./jobs/types";

const STORE_PATH = path.join(process.cwd(), "data", "job-health-alerts.json");
const REMIND_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2h

interface JobAlertState {
  wasBad: boolean;
  lastAlertAt: string | null; // ISO — lần gần nhất đã thật sự gửi thẻ Teams (kể cả nhắc lại)
}

interface Store {
  updatedAt: string;
  jobs: Partial<Record<JobId, JobAlertState>>;
  /** Trạng thái báo cho KẾT NỐI ngoài — xem decideConnectorAlert(). */
  connectors?: { signature: string; wasBad: boolean; lastAlertAt: string | null };
}

function readStore(): Store {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Store;
    }
  } catch { /* ignore — coi như chưa từng báo */ }
  return { updatedAt: new Date().toISOString(), jobs: {} };
}

function writeStore(store: Store): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    writeFileAtomicSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    // Đây là hệ thống CANH SỰ CỐ, không phải hệ thống chống spam — ghi hỏng
    // thì lần kiểm sau có thể báo lại sớm hơn dự kiến (coi như chưa báo).
    // Báo dư còn hơn im, nhất là khi lý do ghi hỏng rất có thể lại chính là
    // đĩa đầy — đúng nguyên nhân gốc của sự cố 17/09/2026 lần này được dựng
    // ra để bắt.
    console.error(
      `[job-health-alerts] Không ghi được ${STORE_PATH}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export interface AlertDecision {
  shouldSend: boolean;
  /** true = job vừa hết xấu — gửi thẻ "đã ổn lại" thay vì thẻ sự cố. */
  isRecovery: boolean;
}

/** Quyết định có gửi thẻ Teams cho job này ở lần kiểm hiện tại không, dựa
 *  trên trạng thái đã lưu từ lần kiểm trước — xem quy tắc ở đầu file. */
export function decideAlert(jobId: JobId, isBadNow: boolean): AlertDecision {
  const store = readStore();
  const prev = store.jobs[jobId] ?? { wasBad: false, lastAlertAt: null };

  let shouldSend = false;
  let isRecovery = false;

  if (isBadNow && !prev.wasBad) {
    shouldSend = true; // vừa chuyển xấu
  } else if (isBadNow && prev.wasBad) {
    const lastMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : 0;
    shouldSend = Date.now() - lastMs >= REMIND_INTERVAL_MS; // nhắc lại định kỳ
  } else if (!isBadNow && prev.wasBad) {
    shouldSend = true; // vừa hồi phục
    isRecovery = true;
  }

  if (shouldSend) {
    store.jobs[jobId] = { wasBad: isBadNow, lastAlertAt: new Date().toISOString() };
    store.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  return { shouldSend, isRecovery };
}


// ── Kết nối ngoài ────────────────────────────────────────────
//
// Phần canh kết nối trong job-health-monitor KHÔNG hề dùng chống lặp như
// phần canh job: nó gửi một thẻ Teams ở MỌI lượt chạy khi còn kết nối hỏng.
// Cron chạy 10 phút/lần nên đó là ~144 thẻ mỗi ngày cho cùng một nội dung.
// Người dùng tắt chuông, rồi lần hỏng thật sau đó cũng không ai thấy.
//
// Khoá theo "chữ ký" = danh sách kết nối đang hỏng đã sắp xếp. Đổi danh sách
// (hỏng thêm cái mới, hoặc một cái đã lành) thì coi như sự cố khác và báo
// ngay, thay vì im cho hết 2 tiếng nhắc lại.

export interface ConnectorAlertDecision {
  shouldSend: boolean;
  /** true = vừa hết hỏng hoàn toàn — gửi thẻ "đã ổn lại". */
  isRecovery: boolean;
}

export function decideConnectorAlert(signature: string, isBadNow: boolean): ConnectorAlertDecision {
  const store = readStore();
  const prev = store.connectors ?? { signature: "", wasBad: false, lastAlertAt: null };

  let shouldSend = false;
  let isRecovery = false;

  if (isBadNow && !prev.wasBad) {
    shouldSend = true;                       // vừa chuyển xấu
  } else if (isBadNow && prev.signature !== signature) {
    shouldSend = true;                       // danh sách hỏng đổi → sự cố khác
  } else if (isBadNow) {
    const lastMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : 0;
    shouldSend = Date.now() - lastMs >= REMIND_INTERVAL_MS;   // nhắc lại mỗi 2h
  } else if (prev.wasBad) {
    shouldSend = true;                       // vừa hồi phục
    isRecovery = true;
  }

  if (shouldSend) {
    store.connectors = {
      signature,
      wasBad: isBadNow,
      lastAlertAt: new Date().toISOString(),
    };
    store.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  return { shouldSend, isRecovery };
}
