"use client";

// ============================================================
// Đợt 7b — hook đọc gợi ý từ Sổ kinh nghiệm cho màn tạo chiến dịch
// ============================================================
// CHỈ ĐỌC (GET /api/playbook/suggest). Lỗi đọc KHÔNG được chặn tạo chiến dịch
// — nơi gọi tự hiện ghi chú nhỏ và coi như không có gợi ý nào.
//
// Import type-only từ lib/playbook/suggest (module đó đụng fs qua store.ts) —
// component client chỉ lấy KIỂU Suggestions, không kéo runtime của module đó
// vào bundle trình duyệt.

import useSWR from "swr";
import type { Suggestions } from "@/lib/playbook/suggest";

const fetcher = async (url: string): Promise<Suggestions> => {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.success) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as Suggestions;
};

export interface UsePlaybookSuggestResult {
  suggestions: Suggestions | null;
  loading: boolean;
  /** null = không lỗi. Có giá trị thì nơi gọi PHẢI hiện ghi chú nhỏ, không chặn gì. */
  error: string | null;
}

export function usePlaybookSuggest(
  company: string,
  platform: "facebook" | "google",
  product: string,
): UsePlaybookSuggestResult {
  const key = product
    ? `/api/playbook/suggest?company=${company}&platform=${platform}&product=${encodeURIComponent(product)}`
    : null;
  const { data, error, isLoading } = useSWR<Suggestions>(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return {
    suggestions: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
