// Gộp các khu từ điển. Thêm khu mới: tạo vi/<khu>.ts + en/<khu>.ts (en kiểu Translation<typeof vi>) rồi thêm vào đây.
import type { Locale } from "../config"
import { common as viCommon } from "./vi/common"
import { common as enCommon } from "./en/common"
import { auth as viAuth } from "./vi/auth"
import { auth as enAuth } from "./en/auth"
import { shell as viShell } from "./vi/shell"
import { shell as enShell } from "./en/shell"
import { connect as viConnect } from "./vi/connect"
import { connect as enConnect } from "./en/connect"
import { setup as viSetup } from "./vi/setup"
import { setup as enSetup } from "./en/setup"
import { campaigns as viCampaigns } from "./vi/campaigns"
import { campaigns as enCampaigns } from "./en/campaigns"
import { settings as viSettings } from "./vi/settings"
import { settings as enSettings } from "./en/settings"
import { overview as viOverview } from "./vi/overview"
import { overview as enOverview } from "./en/overview"
import { google as viGoogle } from "./vi/google"
import { google as enGoogle } from "./en/google"
import { meta as viMeta } from "./vi/meta"
import { meta as enMeta } from "./en/meta"
import { creative as viCreative } from "./vi/creative"
import { creative as enCreative } from "./en/creative"
import { panels as viPanels } from "./vi/panels"
import { panels as enPanels } from "./en/panels"
import { libgoogle as viLibgoogle } from "./vi/libgoogle"
import { libgoogle as enLibgoogle } from "./en/libgoogle"
import { libmeta as viLibmeta } from "./vi/libmeta"
import { libmeta as enLibmeta } from "./en/libmeta"
import { libcase as viLibcase } from "./vi/libcase"
import { libcase as enLibcase } from "./en/libcase"

export const vi = { ...viCommon, ...viAuth, ...viShell, ...viConnect, ...viSetup, ...viCampaigns, ...viSettings, ...viOverview, ...viGoogle, ...viMeta, ...viCreative, ...viPanels, ...viLibgoogle, ...viLibmeta, ...viLibcase } as const
export type MessageKey = keyof typeof vi
export const en: Record<MessageKey, string> = { ...enCommon, ...enAuth, ...enShell, ...enConnect, ...enSetup, ...enCampaigns, ...enSettings, ...enOverview, ...enGoogle, ...enMeta, ...enCreative, ...enPanels, ...enLibgoogle, ...enLibmeta, ...enLibcase }

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { vi, en }
