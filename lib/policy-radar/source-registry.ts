// ─────────────────────────────────────────────
// Policy Radar — Official source registry
// `autoFetchable` reflects a hands-on check (2026-07-16): Google's
// support.google.com pages render server-side and parse cleanly.
// Meta's facebook.com/business/help + help.instagram.com pages returned
// only an empty JS shell — automated ingestion for Meta is not reliable
// yet without a headless-browser fetcher, so those sources are curated
// by hand until that's built.
// ─────────────────────────────────────────────

import type { PolicyRadarSourceHealth } from "./types";

export const POLICY_RADAR_SOURCES: PolicyRadarSourceHealth[] = [
  {
    id: "google_ads_policy_help",
    platform: "google_ads",
    label: "Google Ads Advertising Policies Help",
    url: "https://support.google.com/adspolicy",
    sourceType: "official_policy",
    autoFetchable: true,
    note: "Renders server-side, parses cleanly via fetch.",
    lastCuratedAt: "2026-07-16",
  },
  {
    id: "google_ads_dev_blog",
    platform: "google_ads",
    label: "Google Ads Developer Blog",
    url: "https://ads-developers.googleblog.com/",
    feedUrl: "https://ads-developers.googleblog.com/feeds/posts/default",
    sourceType: "official_announcement",
    autoFetchable: true,
    note: "Atom feed (đo 2026-08-20: 25 entry, có title + published thật). Trước đây băm cả trang nên mọi mục đều mang tiêu đề 'Nội dung trang thay đổi'.",
    lastCuratedAt: "2026-08-20",
  },
  {
    id: "google_ads_commerce_blog",
    platform: "google_ads",
    label: "Google Ads & Commerce Blog",
    url: "https://blog.google/products/ads-commerce/",
    feedUrl: "https://blog.google/products/ads-commerce/rss/",
    sourceType: "official_announcement",
    autoFetchable: true,
    note: "RSS (đo 2026-08-20: 20 item có pubDate). Kênh thông báo sản phẩm — AI Max, PMax, Merchant Center. Lẫn một ít bài tiêu dùng nên prompt được phép đánh dấu bài không liên quan tới người chạy quảng cáo.",
    lastCuratedAt: "2026-08-20",
  },
  {
    id: "meta_advertising_standards",
    platform: "meta",
    label: "Meta Advertising Standards (Transparency Center)",
    url: "https://transparency.meta.com/policies/ad-standards/",
    sourceType: "official_policy",
    autoFetchable: false,
    note: "Fetch returned an empty JS-rendered shell — needs a headless-browser fetcher, curated by hand for now.",
    lastCuratedAt: "2026-07-16",
  },
  {
    id: "meta_business_help",
    platform: "meta",
    label: "Meta Business Help Center — Advertising Standards",
    url: "https://www.facebook.com/business/help/117271728356988",
    sourceType: "official_help",
    autoFetchable: false,
    note: "Fetch returned an empty JS-rendered shell — needs a headless-browser fetcher, curated by hand for now.",
    lastCuratedAt: "2026-07-16",
  },
];
