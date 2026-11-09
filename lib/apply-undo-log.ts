// ============================================================
// Nhật ký hoàn tác cho Improvements → Apply
// ------------------------------------------------------------
// VÌ SAO CÓ TỆP NÀY: nút "Apply tất cả HIGH" ghi thẳng vào tài khoản quảng cáo
// đang tiêu tiền — tạm dừng từ khoá, đổi ngân sách, đổi Target CPA, đổi giá
// thầu. Giao diện lâu nay hứa "Có thể Undo sau khi apply", trong khi
// /api/improvements/apply trả đúng 501 cho mọi yêu cầu undo:
//
//   "Chức năng Undo chưa được hỗ trợ cho hành động này."
//
// Backend thành thật; giao diện thì không. Và đó là loại sai nguy hiểm nhất —
// người ta bấm chính vì tin rằng lỡ tay còn gỡ được.
//
// Lý do gốc ghi ngay trong mã cũ: "applying an improvement doesn't currently
// record the pre-mutation value anywhere, so there's nothing to reverse to."
// Tệp này ghi lại giá trị đó.
//
// NGUYÊN TẮC: chỉ ghi nhật ký SAU KHI Google xác nhận ghi thành công. Ghi
// trước rồi lệnh hỏng sẽ để lại một bản "hoàn tác" cho thay đổi chưa từng xảy
// ra — hoàn tác nó là tự tay làm hỏng một thứ đang đúng.
// ============================================================

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

const LOG_FILE = path.join(process.cwd(), "data", "apply-undo-log.json");

/** Giữ 30 ngày. Quá đó thì giá trị cũ không còn đáng khôi phục — tài khoản đã
 *  đi xa khỏi trạng thái đó rồi. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface UndoEntry {
  id: string;
  improvementId: string;
  company: string;
  action: string;
  /** Tài nguyên đã bị sửa trên Google Ads. */
  resourceName: string;
  /** Mô tả ngắn để hiện cho người dùng, ví dụ tên chiến dịch/từ khoá. */
  label?: string;
  /** Giá trị TRƯỚC khi sửa — thứ duy nhất khiến hoàn tác có nghĩa. */
  before: Record<string, unknown>;
  /** Giá trị đã ghi đè lên. Giữ để đối chiếu: nếu giá trị hiện tại KHÁC cái
   *  này thì đã có người sửa tay sau đó, hoàn tác sẽ xoá mất việc của họ. */
  after: Record<string, unknown>;
  appliedAt: string;
  undoneAt?: string;
}

function readAll(): UndoEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    return Array.isArray(raw) ? (raw as UndoEntry[]) : [];
  } catch {
    // Nhật ký hỏng KHÔNG được làm hỏng lượt apply — mất khả năng hoàn tác còn
    // hơn chặn người dùng làm việc.
    return [];
  }
}

function writeAll(rows: UndoEntry[]): void {
  // PHẢI dùng bản SYNC. `writeFileAtomic` là hàm async; gọi nó trong một hàm
  // `void` không await nghĩa là `recordApply()` trả về TRƯỚC KHI nhật ký nằm
  // trên đĩa. Ba hệ quả, đo được ngày 24/09 khi dựng bộ thử cho P4b:
  //
  //  1. Đọc lại ngay sau khi ghi trả về dữ liệu CŨ — `findUndoable()` gọi sát
  //     sau `recordApply()` có thể không thấy bản ghi vừa tạo. Đây là cách lỗi
  //     lộ ra: nhật ký báo 0 dòng trong khi lượt ghi đã thành công.
  //  2. Tiến trình thoát hoặc container restart trong khoảng đó là MẤT hẳn bản
  //     ghi hoàn tác — cho một thay đổi đã thực sự xảy ra trên tài khoản. Đúng
  //     cái tình huống tệ nhất mà tệp này sinh ra để tránh.
  //  3. Mất cập nhật: hai lượt `recordApply` gần nhau cùng `readAll()` ra mảng
  //     cũ rồi cái sau ghi đè cái trước.
  //
  // Cả module này vốn đã đồng bộ (`readAll` dùng `fs.readFileSync`), nên bản
  // sync mới là bản khớp — `writeFileAtomicSync` tồn tại đúng cho trường hợp
  // "caller đang dùng fs.writeFileSync".
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(LOG_FILE, JSON.stringify(rows, null, 2));
}

/** Ghi lại một thay đổi ĐÃ ĐƯỢC GOOGLE XÁC NHẬN. */
export function recordApply(entry: Omit<UndoEntry, "id" | "appliedAt">): void {
  try {
    const now = Date.now();
    const rows = readAll().filter((r) => now - Date.parse(r.appliedAt) < KEEP_MS);
    rows.push({
      ...entry,
      id: `undo_${now}_${Math.random().toString(36).slice(2, 8)}`,
      appliedAt: new Date(now).toISOString(),
    });
    writeAll(rows);
  } catch (err) {
    // Không ném: thay đổi đã ghi lên Google rồi, ném ở đây chỉ khiến giao diện
    // báo thất bại cho một việc đã thành công.
    console.error("[apply-undo-log] không ghi được nhật ký:", err);
  }
}

/** Bản ghi còn hoàn tác được của một improvement. */
export function findUndoable(improvementId: string): UndoEntry | null {
  const rows = readAll();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].improvementId === improvementId && !rows[i].undoneAt) return rows[i];
  }
  return null;
}

export function markUndone(id: string): void {
  try {
    const rows = readAll();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    row.undoneAt = new Date().toISOString();
    writeAll(rows);
  } catch (err) {
    console.error("[apply-undo-log] không đánh dấu được đã hoàn tác:", err);
  }
}

/** Danh sách gần đây, mới nhất trước — để màn hình hiện "vừa đổi gì". */
export function recentApplies(limit = 50): UndoEntry[] {
  return readAll().slice(-limit).reverse();
}
