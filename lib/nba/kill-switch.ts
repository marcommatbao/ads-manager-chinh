// ============================================================
// P8 — Công tắc tắt khẩn cấp cho NBA auto-apply
// ============================================================
// VÌ SAO PHẢI CÓ TRƯỚC KHI BẬT AUTO-APPLY:
//
// Cách duy nhất để dừng auto-apply hiện nay là đổi biến môi trường
// `NBA_AUTO_APPLY` rồi DEPLOY LẠI. Đo ngày 24/09: một lượt deploy mất khoảng
// 90 giây tính từ lúc bấm. Trong khoảng đó hệ thống vẫn đang tự tăng ngân sách
// trên tài khoản đang tiêu tiền thật, và người muốn dừng nó thì đang ngồi chờ
// một cái build chạy.
//
// Đó không phải công tắc khẩn cấp. Đó là một yêu cầu thay đổi.
//
// Tệp này là công tắc thật: ghi một tệp cờ, có hiệu lực ngay LƯỢT SAU, không
// cần deploy, không cần khởi động lại. `data/` đã xác nhận có volume bền
// (P0, 24/09) nên cờ sống qua cả restart.
//
// BA NGUYÊN TẮC:
//
// 1. MẶC ĐỊNH LÀ CHO CHẠY, nhưng đọc hỏng thì DỪNG.
//    Không đọc được tệp cờ nghĩa là không biết trạng thái. Với một hệ thống
//    tự tiêu tiền thì "không biết" phải quy về "dừng", không phải "chạy tiếp".
//    Đây là chỗ duy nhất trong repo cố tình chọn fail-closed.
//
// 2. Tắt được theo TỪNG loại hành động, không chỉ tắt tổng. Một loại hành vi
//    xấu không nên buộc phải tắt tất cả.
//
// 3. GHI LẠI AI TẮT VÀ VÌ SAO. Một công tắc không có vết là thứ sẽ có người
//    bật lại mà không ai biết tại sao nó từng bị tắt.
// ============================================================

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

const FLAG_FILE = path.join(process.cwd(), "data", "nba-kill-switch.json");

export interface KillSwitchState {
  /** true = CHẶN toàn bộ auto-apply. */
  stopAll: boolean;
  /** reasonCode bị chặn riêng, ví dụ ["SCALE_WINNER"]. */
  stoppedReasonCodes: string[];
  updatedAt: string;
  updatedBy: string;
  reason: string;
}

const DEFAULT_STATE: KillSwitchState = {
  stopAll: false,
  stoppedReasonCodes: [],
  updatedAt: "",
  updatedBy: "",
  reason: "",
};

export interface KillSwitchRead {
  state: KillSwitchState;
  /**
   * Đọc được tệp cờ hay không. `false` nghĩa là KHÔNG BIẾT trạng thái —
   * chỗ gọi phải coi như đang tắt. Xem nguyên tắc 1 ở đầu tệp.
   */
  readable: boolean;
  error?: string;
}

export function readKillSwitch(): KillSwitchRead {
  try {
    if (!fs.existsSync(FLAG_FILE)) {
      // Chưa từng có tệp = chưa ai tắt bao giờ. Đây là trạng thái bình thường,
      // KHÔNG phải lỗi đọc.
      return { state: { ...DEFAULT_STATE }, readable: true };
    }
    const raw = JSON.parse(fs.readFileSync(FLAG_FILE, "utf-8")) as Partial<KillSwitchState>;
    return {
      readable: true,
      state: {
        stopAll: raw.stopAll === true,
        stoppedReasonCodes: Array.isArray(raw.stoppedReasonCodes) ? raw.stoppedReasonCodes.map(String) : [],
        updatedAt: String(raw.updatedAt ?? ""),
        updatedBy: String(raw.updatedBy ?? ""),
        reason: String(raw.reason ?? ""),
      },
    };
  } catch (err) {
    // Tệp hỏng / không đọc được → KHÔNG BIẾT. Trả readable=false để chỗ gọi
    // dừng lại. Cố đoán "chắc là đang bật" ở đây là đúng kiểu sai đắt nhất.
    return {
      readable: false,
      state: { ...DEFAULT_STATE, stopAll: true },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface BlockDecision {
  blocked: boolean;
  /** Câu nói rõ vì sao bị chặn — đi thẳng vào báo cáo, không nuốt. */
  reason: string | null;
}

/** Một hành động có bị công tắc chặn không. */
export function isBlocked(reasonCode: string): BlockDecision {
  const r = readKillSwitch();

  if (!r.readable) {
    return {
      blocked: true,
      reason: `Không đọc được trạng thái công tắc khẩn cấp (${r.error ?? "lỗi không rõ"}) — `
            + `DỪNG auto-apply cho chắc. Không biết công tắc đang bật hay tắt thì không được phép tự tiêu tiền.`,
    };
  }
  if (r.state.stopAll) {
    return {
      blocked: true,
      reason: `Công tắc khẩn cấp đang BẬT (tắt toàn bộ auto-apply)`
            + `${r.state.updatedBy ? ` — do ${r.state.updatedBy}` : ""}`
            + `${r.state.reason ? `: ${r.state.reason}` : ""}.`,
    };
  }
  if (r.state.stoppedReasonCodes.includes(reasonCode)) {
    return {
      blocked: true,
      reason: `Loại hành động "${reasonCode}" đang bị tắt riêng`
            + `${r.state.updatedBy ? ` — do ${r.state.updatedBy}` : ""}`
            + `${r.state.reason ? `: ${r.state.reason}` : ""}.`,
    };
  }
  return { blocked: false, reason: null };
}

/** Bật/tắt công tắc. Ghi ĐỒNG BỘ để có hiệu lực ngay lượt sau. */
export function setKillSwitch(next: {
  stopAll?: boolean;
  stoppedReasonCodes?: string[];
  updatedBy: string;
  reason: string;
}): KillSwitchState {
  const cur = readKillSwitch().state;
  const state: KillSwitchState = {
    stopAll: next.stopAll ?? cur.stopAll,
    stoppedReasonCodes: next.stoppedReasonCodes ?? cur.stoppedReasonCodes,
    updatedAt: new Date().toISOString(),
    updatedBy: next.updatedBy,
    reason: next.reason,
  };
  const dir = path.dirname(FLAG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Ghi đồng bộ, KHÔNG dùng bản async: công tắc phải nằm trên đĩa trước khi
  // hàm này trả về. Bản async không await từng làm mất bản ghi hoàn tác
  // (xem lib/apply-undo-log.ts) — không lặp lại ở chỗ nguy hiểm hơn.
  writeFileAtomicSync(FLAG_FILE, JSON.stringify(state, null, 2));
  return state;
}
