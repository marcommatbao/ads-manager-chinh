// Việc trong hộp được cron dựng sẵn thành câu tiếng Việt (data/inbox.json) → dịch lúc ĐỌC cho giao diện (route /api/inbox).
// Chỉ dịch được các việc do chính build.ts viết câu (Meta gộp, bản tách Search, lỗi đo lường gộp, phiên xử lý đo 7/14 ngày) +
// nhãn tiền / nhãn nút cố định. Việc lấy nguyên văn từ X-quang PMax / Search / Meta, Sức khoẻ tổng quan, NBA giữ câu gốc (xem báo cáo).
import type { TFunction } from "@/lib/i18n/translate"
import { localizeText } from "./template"
import type { InboxItem } from "./build"

const GROUPS = ["libcase.w.pat.inbox.", "libcase.w.pat.write."]
const L = (s: string, t: TFunction) => localizeText(s, GROUPS, t)

export function localizeItem<T extends InboxItem>(it: T, t: TFunction): T {
  return {
    ...it,
    title: L(it.title, t),
    why: L(it.why, t),
    moneyLabel: it.moneyLabel == null ? it.moneyLabel : L(it.moneyLabel, t),
    hrefLabel: L(it.hrefLabel, t),
    ...(it.children ? { children: it.children.map((c) => ({ ...c, detail: L(c.detail, t) })) } : {}),
  } as T
}
