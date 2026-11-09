// ============================================================
// Trộn mục nhắm mới vào targeting của adset.
// ------------------------------------------------------------
// Tách hẳn ra file riêng vì đây là đoạn mã ĐỤNG TIỀN THẬT: kết quả của nó được
// PUSH thẳng lên adset đang chạy. Nằm ở lib thì chạy thử được bằng script
// thường, không cần token Meta, nên còn có đường kiểm trước khi đẩy đi.
//
// Bài học cầm sẵn: một lần đặt SAI TÊN TRƯỜNG khi gọi API bên thứ ba đã đốt
// $19 trong im lặng (sự cố Apify 20/08/2026). Ở đây trường sai không chỉ tốn
// tiền mà còn nhắm sai người: nhét một "Hành vi" vào ô `interests` thì Meta
// hoặc báo lỗi, hoặc tệ hơn là nhận rồi nhắm sang tệp khác hẳn.
// ============================================================

/**
 * Các ô CON hợp lệ bên trong một phần tử flexible_spec.
 *
 * Danh sách này CỐ Ý HẸP. Meta còn nhiều loại khác (relationship_statuses,
 * education_statuses…) nhưng chúng nằm ở TẦNG TRÊN của targeting chứ không
 * nằm trong flexible_spec — nhét vào đây là sai chỗ. Không chắc thì không
 * thêm: mục nhắm bị bỏ qua chỉ là mất một gợi ý, nhắm sai là mất tiền.
 */
export const FLEXIBLE_SPEC_BUCKETS = [
  "interests",
  "behaviors",
  "life_events",
  "industries",
  "income",
  "family_statuses",
  "work_positions",
  "work_employers",
  "education_majors",
  "education_schools",
] as const;

export type TargetingBucket = (typeof FLEXIBLE_SPEC_BUCKETS)[number];

/** Nhãn tiếng Việt cho người đọc, không dùng để gọi API. */
export const BUCKET_LABEL: Record<TargetingBucket, string> = {
  interests:         "Sở thích",
  behaviors:         "Hành vi",
  life_events:       "Sự kiện trong đời",
  industries:        "Ngành nghề",
  income:            "Thu nhập",
  family_statuses:   "Tình trạng gia đình",
  work_positions:    "Chức danh",
  work_employers:    "Nơi làm việc",
  education_majors:  "Ngành học",
  education_schools: "Trường học",
};

export function isSupportedBucket(value: string | undefined | null): value is TargetingBucket {
  return !!value && (FLEXIBLE_SPEC_BUCKETS as readonly string[]).includes(value);
}

export interface TargetingItem {
  id: string;
  name: string;
  /** Ô con sẽ ghi vào. Thiếu thì coi là "interests" — hành vi cũ của app. */
  bucket?: string;
}

export interface MergeResult {
  /** Targeting mới, đã sẵn sàng gửi lên Meta. */
  targeting: Record<string, unknown>;
  /** Mục thật sự được thêm, nhóm theo ô. */
  added: Array<{ bucket: TargetingBucket; items: TargetingItem[] }>;
  /** Mục bị bỏ qua kèm lý do — để nói thẳng, không âm thầm nuốt. */
  skipped: Array<{ item: TargetingItem; reason: string }>;
}

/**
 * Trộn `items` vào `currentTargeting.flexible_spec[0]`, mỗi mục vào ĐÚNG ô của
 * nó. Không đụng tới các phần tử flexible_spec khác, không đụng tới các khoá
 * khác trong targeting (tuổi, khu vực, placement…).
 */
export function mergeIntoFlexibleSpec(
  currentTargeting: Record<string, unknown>,
  items: TargetingItem[],
): MergeResult {
  const skipped: MergeResult["skipped"] = [];

  // Gom theo ô, bỏ mục không hợp lệ.
  const byBucket = new Map<TargetingBucket, TargetingItem[]>();
  for (const item of items) {
    const bucket = item.bucket ?? "interests";
    if (!item.id) {
      skipped.push({ item, reason: "thiếu ID Meta" });
      continue;
    }
    if (!isSupportedBucket(bucket)) {
      skipped.push({ item, reason: `loại "${bucket}" không ghi được vào flexible_spec` });
      continue;
    }
    const list = byBucket.get(bucket) ?? [];
    list.push(item);
    byBucket.set(bucket, list);
  }

  const existingSpec =
    (currentTargeting.flexible_spec as Array<Record<string, unknown>> | undefined) ?? [];
  const firstSpec: Record<string, unknown> = { ...(existingSpec[0] ?? {}) };

  const added: MergeResult["added"] = [];

  for (const [bucket, list] of byBucket) {
    const existing = (firstSpec[bucket] as Array<{ id: string; name?: string }> | undefined) ?? [];
    const existingIds = new Set(existing.map(e => String(e.id)));

    const fresh = list.filter(i => {
      if (existingIds.has(String(i.id))) {
        skipped.push({ item: i, reason: "adset đã nhắm mục này rồi" });
        return false;
      }
      return true;
    });

    if (fresh.length === 0) continue;

    // Gửi lên Meta chỉ cần id + name. Không mang theo trường lạ (path, reason,
    // audienceSize…) — trường lạ trong targeting spec là cách nhanh nhất để
    // Meta trả về lỗi khó hiểu.
    firstSpec[bucket] = [
      ...existing,
      ...fresh.map(i => ({ id: String(i.id), name: i.name })),
    ];
    added.push({ bucket, items: fresh });
  }

  const newFlexibleSpec = [firstSpec, ...existingSpec.slice(1)];

  return {
    targeting: { ...currentTargeting, flexible_spec: newFlexibleSpec },
    added,
    skipped,
  };
}
