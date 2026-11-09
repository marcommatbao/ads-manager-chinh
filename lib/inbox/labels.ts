import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// Đợt 15a — Nhãn hiển thị dùng chung cho hộp "Việc nên làm hôm nay"
// ============================================================
// Tách riêng khỏi build.ts/store.ts để trang CLIENT (app/(dashboard)/viec-hom-nay)
// import được nhãn mà KHÔNG kéo theo "fs" của store.ts vào bundle trình duyệt.
// build.ts/store.ts re-export lại từ đây — hành vi không đổi cho các chỗ đã
// import KIND_LABEL/SOURCE_LABEL/STATUS_LABEL từ hai file đó.
import type { InboxKind, InboxSource } from "./build"
import type { InboxStatus } from "./store"

export const KIND_LABEL: Record<InboxKind, string> = { 1: "① Số đo sai", 2: "② Lãng phí rõ", 3: "③ Cơ hội" }
export const SOURCE_LABEL: Record<InboxSource, string> = { pmax: "PMax", search: "Search", meta: "Meta", health: "Đo lường & sức khoẻ", case: "Phiên xử lý", nba: "NBA (Meta)" }
export const STATUS_LABEL: Record<InboxStatus, string> = { new: "Mới", seen: "Đã xem", snoozed: "Hoãn", done: "Đã làm", dismissed: "Bỏ qua" }

// Nhãn theo ngôn ngữ (giao diện/API gọi kèm t; hằng số bên trên giữ tiếng Việt cho cron/Teams).
export const kindLabel = (k: InboxKind, t: TFunction = makeT("vi")): string => t(`libcase.inbox.kind.${k}` as never)
export const sourceLabel = (k: InboxSource, t: TFunction = makeT("vi")): string => (k in SOURCE_LABEL ? t(`libcase.inbox.source.${k}` as never) : String(k))
export const statusLabel = (k: InboxStatus, t: TFunction = makeT("vi")): string => (k in STATUS_LABEL ? t(`libcase.inbox.status.${k}` as never) : String(k))
