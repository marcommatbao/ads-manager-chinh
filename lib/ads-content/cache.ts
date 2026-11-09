// ============================================================
// Ads Content — In-Memory TTL Cache
// ============================================================
// Ad-level Meta/Google Ads calls are rate-limited and non-trivial in
// cost. The Ads Content page has an explicit Refresh action (no
// auto-polling), so a short TTL is enough to absorb re-renders /
// re-fetches from filter changes that don't touch month or company.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

/** TTL ngắn dành riêng cho kết quả KHÔNG trọn vẹn (có warnings).
 *
 *  Vì sao phải tách: một trục trặc thoáng qua của Meta từng bị cache nguyên
 *  5 phút cùng danh sách RỖNG — và vì trang này chỉ làm mới bằng nút Refresh,
 *  người dùng bấm Refresh mấy lần cũng chỉ nhận lại đúng cái rỗng đã cache,
 *  không có cách nào thoát ra ngoài việc ngồi đợi. Đúng ca 10/09/2026.
 *
 *  Nhưng cũng không bỏ cache hẳn cho nhánh lỗi: nếu Meta hỏng kéo dài thì mỗi
 *  lượt vào trang lại nện thêm một loạt lệnh gọi, đốt hạn mức vô ích. 30 giây
 *  là đủ để Refresh có tác dụng thật mà vẫn chặn được việc gọi dồn dập. */
const PARTIAL_TTL_MS = 30 * 1000;

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, options?: { partial?: boolean }): void {
  const ttl = options?.partial ? PARTIAL_TTL_MS : TTL_MS;
  store.set(key, { value, expiresAt: Date.now() + ttl });
}
