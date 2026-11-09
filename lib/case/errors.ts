// Lỗi nghiệp vụ của "Xử lý chiến dịch" — tách khỏi service.ts để các thư viện thu thập bằng chứng dùng được mà không vòng import.
import type { TFunction, Vars } from "@/lib/i18n/translate"
import type { MessageKey } from "@/lib/i18n/messages"

/** Lỗi nghiệp vụ hiện cho người dùng. `message` luôn là bản tiếng Việt (log, cron, MCP); `i18n` (nếu có) để route dịch theo ngôn ngữ người gọi. */
export class CaseError extends Error {
  constructor(message: string, public status = 400, public i18n?: { key: MessageKey; vars?: Vars }) { super(message) }
  localized(t: TFunction): string { return this.i18n ? t(this.i18n.key, this.i18n.vars) : this.message }
}
