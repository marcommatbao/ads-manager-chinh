// ============================================================
// AdsCommand — TypeScript Interfaces
// ============================================================

import type { GA4CampaignData } from "../lib/ga4-client";

// Platform
export type Platform = 'facebook' | 'google' | 'all'
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

// Core metrics shared across platforms
export interface CampaignMetrics {
  impressions: number
  clicks: number
  spend: number
  ctr: number         // Click-through rate (%)
  cpc: number         // Cost per click
  cpm: number         // Cost per 1000 impressions
  roas: number        // Return on ad spend
  conversions: number
  revenue: number
  reach?: number      // Unique people reached (Meta only)
  frequency?: number  // Avg times seen (Meta only)
  // Google only. null/undefined = Google KHÔNG trả số cho chiến dịch này
  // (Search/PMax không có chỉ số reach) → giao diện phải hiện "—", không hiện 0.
  uniqueUsers?: number | null
  // Meta only — như cột Ads Manager. "Giá trị kết quả" = action_values của ĐÚNG loại kết quả chiến dịch đang tối ưu;
  // "ROAS kết quả" = giá trị kết quả / chi tiêu. null = Meta không có giá trị cho loại kết quả đó → hiện "—".
  resultValue?: number | null
  resultRoas?: number | null
}

// Campaign object
export interface Campaign {
  id: string
  name: string
  platform: Platform
  status: CampaignStatus
  objective: string
  dailyBudget: number
  totalBudget: number
  startDate: string
  endDate: string | null
  metrics: CampaignMetrics
  // Company & account info (used for MBC/MBI grouping)
  company?: string | null
  accountId?: string
  accountName?: string
  // Analytics
  ga4?: GA4CampaignData
  ga4Source?: string
}

// GA4 Multi-Property
export interface GA4PropertyMapping {
  id:           string
  propertyId:   string        // "properties/123456789"
  propertyName: string        // "MBC Website"
  measurementId:string        // "G-XXXXXXXXXX"
  accessToken:  string
  refreshToken: string
  expiresAt?:   number
  status:       "CONNECTED" | "EXPIRED" | "ERROR" | "NOT_CONNECTED"
  mappedCompany: string /* mã công ty hoặc "ALL" */ | null
}

// Dashboard summary
export interface DashboardSummary {
  totalSpend: number
  totalRevenue: number
  avgROAS: number
  avgCTR: number
  totalImpressions: number
  totalClicks: number
  activeCampaigns: number
  periodLabel: string   // e.g. "Last 7 days"
}

// Date range filter
export interface DateRange {
  from: string   // ISO date string
  to: string
}

// AI Creative
export interface AdCreative {
  id: string
  platform: Platform
  headline: string
  primaryText: string
  description: string
  cta: string
  format: 'feed' | 'story' | 'search' | 'display'
  score?: number       // 1-10 AI-rated performance prediction
  reason?: string      // explanation of the score
}

// Report
export interface ReportData {
  date: string
  platform: Platform
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
}
