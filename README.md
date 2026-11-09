# AdsCommand — Ads Management Dashboard

Centralized dashboard to manage, analyze, and optimize Facebook Ads and Google Ads campaigns, powered by AI creative generation.

## Features

- **Multi-Platform Support** — Facebook Ads + Google Ads in one dashboard
- **Company Separation** — MBC / MBI data silos with role-based access
- **CPL Tracking** — Cost-per-lead with offline order integration
- **Budget Automation** — Daily 06:00 cron redistributes budgets based on performance
- **Alert Engine** — Real-time notifications for CPL spikes, budget depletion, etc.
- **AI Creative Studio** — Generate ad copy and audience targeting suggestions
- **Export Reports** — PDF and Excel reports
- **PWA Ready** — Add to Home Screen on mobile devices

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your values
cp .env.example .env.local

# 3. Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

See `.env.example` for all required keys. Main groups:

| Group | Variables |
|-------|----------|
| Meta (Facebook) Ads | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_ID`, `META_APP_SECRET` |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID_MBC`, `GOOGLE_ADS_CUSTOMER_ID_MBI`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |
| Telegram Alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Auth (JWT) | `AUTH_SECRET` (bắt buộc, ≥32 ký tự ngẫu nhiên — KHÔNG dùng giá trị mẫu trong `.env.example`), `NEXTAUTH_URL` |
| Đăng nhập | `ALLOWED_LOGIN_DOMAINS` (mặc định `matbao.com`), `ALLOWED_LOGIN_EMAILS` (ngoại lệ), `TRUSTED_PROXY_HOPS` (xem docs/VIBEHOST-PROXY-CHECK.md) |
| Cron | `CRON_SECRET` |
| AI | `GEMINI_API_KEY` |

## Google Ads Setup

### 1. Create OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Google Ads API**
3. Go to **APIs & Services → Credentials → Create OAuth Client ID**
4. Type: **Web application**
5. Redirect URI: `https://developers.google.com/oauthplayground`
6. Copy `Client ID` and `Client Secret` → paste into `.env.local`

### 2. Get Refresh Token

1. Open [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Click ⚙️ → check **Use your own OAuth credentials** → paste Client ID & Secret
3. In Step 1, enter scope: `https://www.googleapis.com/auth/adwords`
4. Click **Authorize APIs** → sign in with your Google Ads account
5. In Step 2, click **Exchange authorization code for tokens**
6. Copy `refresh_token` → paste into `GOOGLE_ADS_REFRESH_TOKEN`

### 3. Get Developer Token

1. Go to [Google Ads](https://ads.google.com/) → **Tools & Settings → API Center**
2. Copy your **Developer Token** → paste into `GOOGLE_ADS_DEVELOPER_TOKEN`
3. Set `GOOGLE_ADS_CUSTOMER_ID_MBC` and `GOOGLE_ADS_CUSTOMER_ID_MBI` to your account IDs (without dashes)
4. If using MCC, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to your MCC account ID

### 4. Check Token Expiry

Google refresh tokens can become invalid if:
- User revokes access
- Password changed
- Token unused for 6 months
- Max 50 tokens per client ID reached

**How to check:**
```bash
# Test with curl (replace values)
curl "https://oauth2.googleapis.com/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=YOUR_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"

# ✅ Success: returns {"access_token": "...", "expires_in": 3600, ...}
# ❌ Expired: returns {"error": "invalid_grant", ...}
```

If expired, repeat Step 2 above to get a new refresh token.

## Cron Jobs (Vercel)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/budget-redistribute",
      "schedule": "0 23 * * *"
    }
  ]
}
```

> Note: `0 23 * * *` UTC = 06:00 UTC+7 (Vietnam)

Set `CRON_SECRET` in Vercel Environment Variables to match `.env.local`.

## Tech Stack

- **Next.js 16** (App Router)
- **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Zustand** (state management)
- **SWR** (data fetching & revalidation)
- **Recharts** (charts)
- **@react-pdf/renderer** + **ExcelJS** (exports)
- **Google Generative AI** (Gemini)

## Deployment

```bash
# Build production
npm run build

# Start production server
npm start
```

Or deploy directly to [Vercel](https://vercel.com).
