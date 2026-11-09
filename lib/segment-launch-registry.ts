// ============================================================
// A3.1 — Sổ nối phân khúc ↔ ad set đã chạy
// ------------------------------------------------------------
// Đây là mắt xích DUY NHẤT không thể lấy lại được sau này.
//
// Luồng launch vẫn dựng `segmentAdSetMap` trong lúc tạo ad set rồi vứt đi khi
// hàm kết thúc. Nghĩa là mỗi lần launch trôi qua là mất vĩnh viễn thông tin
// "phân khúc nào đã trở thành ad set nào" — Meta chỉ giữ ad set, không giữ ý
// định đằng sau nó.
//
// Vì sao KHÔNG suy ngược được từ Meta:
//  - Tên ad set = tên phân khúc, nhưng AI sinh tên MỚI mỗi lần chạy nên tên
//    không phải khoá bền.
//  - Bộ sở thích có trong targeting, nhưng nó nói "nhắm ai", không nói "vì sao
//    nhắm" — mất căn cứ A1, mất sản phẩm, mất người bấm, mất thời điểm.
//  - Ad set bị sửa tay trên Meta sau đó thì dấu vết ý định gốc biến mất hẳn.
//
// Nên file này ghi ngay tại thời điểm launch. Nó KHÔNG tính toán gì, KHÔNG gọi
// API nào — chỉ lưu lại sự thật đang có trong tay, để các phase sau (nối kết
// quả kinh doanh) còn cái mà nối.
//
// Ghi hỏng KHÔNG được làm hỏng launch: campaign đã tạo thật trên Meta rồi, một
// lỗi ghi sổ không được phép biến lượt launch thành công thành lỗi.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { log } from "@/lib/logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "segment-launch-registry.json");
/** Trần bản ghi. Mỗi lượt launch vài dòng, 5000 đủ dùng rất lâu. */
const MAX_RECORDS = 5000;

export interface SegmentLaunchRecord {
  /** Khoá ổn định do TA đặt, không phụ thuộc tên AI sinh ra. */
  id: string;
  launchedAt: string;
  launchedBy: string;
  platform: "facebook";
  company: string;
  productId: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  /** Tên phân khúc lúc launch — AI sẽ sinh tên khác ở lần sau, nên đây là ảnh
   *  chụp tại thời điểm đó, KHÔNG dùng làm khoá nối. */
  segmentName: string;
  funnelStage: string;
  /** Sở thích THẬT đã gửi lên Meta (id + tên). Khoá nối bền nhất hiện có. */
  interests: Array<{ id: string; name: string }>;
  ageMin: number | null;
  ageMax: number | null;
  locations: string[];
  /** Có bị hạ cấp targeting không — ad set bị hạ cấp KHÔNG so sánh được với ad
   *  set giữ nguyên targeting, nên phải đánh dấu ngay từ đầu. */
  targetingDowngraded: boolean;
  /** utm_campaign thật sự gắn vào link — mắt xích để nối sang Odoo sau này. */
  utmCampaign: string | null;
}

export async function readRegistry(): Promise<SegmentLaunchRecord[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as SegmentLaunchRecord[];
  } catch {
    return [];
  }
}

/** Ghi một lô bản ghi. Không bao giờ ném — xem chú thích đầu file. */
export async function recordSegmentLaunch(records: SegmentLaunchRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await withFileLock(FILE, async () => {
      const all = await readRegistry();
      all.unshift(...records);
      await writeFileAtomic(FILE, JSON.stringify(all.slice(0, MAX_RECORDS), null, 2));
    });
    log.info("segment_registry", `Ghi ${records.length} liên kết phân khúc ↔ ad set`, {
      campaign: records[0]?.campaignName,
    });
  } catch (err) {
    log.warn("segment_registry", "Không ghi được sổ nối phân khúc", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Tra lịch sử theo id sở thích — phân khúc nào từng dùng sở thích này. */
export async function findLaunchesByInterest(interestId: string): Promise<SegmentLaunchRecord[]> {
  const all = await readRegistry();
  return all.filter((r) => r.interests.some((i) => i.id === interestId));
}
