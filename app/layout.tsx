import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { getCurrentUser } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "AdsCommand — Ads Management Dashboard",
  description:
    "Centralized dashboard to manage, analyze, and optimize Facebook Ads and Google Ads campaigns powered by AI creative generation.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read user server-side so SessionProvider has the correct role immediately,
  // without depending on the /api/auth/session client fetch (which can be 403'd
  // by Traefik IP-allowlist middleware before it reaches Next.js).
  const initialUser = await getCurrentUser();
  // Song ngữ (#7135): ngôn ngữ từ cookie `lang`, mặc định vi (DEFAULT_LOCALE cho bản khách).
  const locale = await getLocale();

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <I18nProvider locale={locale}>
          <SessionProvider initialUser={initialUser}>
            {children}
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
