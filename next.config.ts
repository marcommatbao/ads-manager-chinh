import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Prevent XSS via browser reflection
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Control referrer information leakage
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Force HTTPS for 1 year (enable only after verifying HTTPS is stable)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Content Security Policy — tightened for this SPA
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline for hydration
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https://generativelanguage.googleapis.com https://graph.facebook.com https://googleads.googleapis.com",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep Google Ads + gRPC packages as native CJS externals (they use
  // native addons and large dependency trees not compatible with webpack bundling).
  serverExternalPackages: [
    "google-ads-api",
    "google-auth-library",
    "gaxios",
    "google-gax",
    "google-ads-node",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
