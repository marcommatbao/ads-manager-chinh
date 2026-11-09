import { makeT, type TFunction } from "@/lib/i18n/translate"
// Đợt 27 — sổ KÊNH QUẢNG CÁO dùng chung cho KPI (trần ngân sách theo kênh), P&L (chi phí thực theo kênh) và Chi phí kênh
// khác (khai tay). Tệp THUẦN — giao diện dùng được. Kênh gốc cố định; kênh thêm mới lưu ở data/ad-channels.json
// (lib/settings/ad-channels.ts). Mã kênh (key) sinh MỘT lần từ tên và không bao giờ đổi — số đã lưu gắn theo mã này,
// nên "ChatGPT / chatgpt / Chat GPT" chỉ là một kênh (lý do ban đầu danh sách bị khoá cứng).
export type ChannelSource = "api" | "manual"
export interface AdChannelDef {
  key: string
  /** Tên ngắn ở KPI / P&L ("Google", "ChatGPT"). */
  label: string
  /** Tên ở Chi phí kênh khác ("TikTok Ads"). */
  manualLabel: string
  /** api = tool tự lấy chi phí (Google, Facebook); manual = khai tay ở Chi phí kênh khác. */
  source: ChannelSource
  builtIn: boolean
  hidden?: boolean
}

export const BUILTIN_AD_CHANNELS: AdChannelDef[] = [
  { key: "google", label: "Google", manualLabel: "Google Ads", source: "api", builtIn: true },
  { key: "facebook", label: "Facebook", manualLabel: "Facebook Ads", source: "api", builtIn: true },
  { key: "tiktok", label: "TikTok", manualLabel: "TikTok Ads", source: "manual", builtIn: true },
  { key: "zalo", label: "Zalo", manualLabel: "Zalo Ads", source: "manual", builtIn: true },
]
/** "Kênh khác" — chỉ ở chi phí khai tay / P&L, không có trần KPI. */
export const OTHER_CHANNEL = { key: "other", label: "Kênh khác", manualLabel: "Kênh khác" } as const
export const RESERVED_CHANNEL_KEYS = [...BUILTIN_AD_CHANNELS.map((c) => c.key), OTHER_CHANNEL.key]
export const CHANNEL_KEY_RE = /^[a-z][a-z0-9_]{1,23}$/
export const MAX_CUSTOM_CHANNELS = 12

/** Tên → mã kênh: bỏ dấu, chữ thường, ký tự khác chữ/số → "_" ("Microsoft Ads" → "microsoft_ads", "Cốc Cốc" → "coc_coc"). */
export function slugifyChannel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase()
    .replace(/\bads?\b/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24)
}

/** Mã kênh có trần KPI (mọi kênh, kể cả kênh đã ẩn — số cũ vẫn giữ). */
export const budgetChannelKeys = (chs: AdChannelDef[]) => chs.map((c) => c.key)
/** Kênh hiện để NHẬP (bỏ kênh đã ẩn). */
export const visibleChannels = (chs: AdChannelDef[]) => chs.filter((c) => !c.hidden)
export const channelLabel = (chs: AdChannelDef[], key: string, t: TFunction = makeT("vi")) => key === OTHER_CHANNEL.key ? t("libcase.channel.other") : chs.find((c) => c.key === key)?.label ?? key
/** Tên kênh "Kênh khác" theo ngôn ngữ (cho chi phí khai tay / P&L). */
export const otherChannelLabel = (t: TFunction = makeT("vi")) => t("libcase.channel.other")
