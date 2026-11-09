// Trang chủ công khai — Google OAuth verification yêu cầu trang chủ mô tả app và dẫn tới chính sách quyền riêng tư.
import type { Metadata } from "next";
import Link from "next/link";
import { publicInfo } from "@/lib/public-info";
import { ContactLine } from "../contact-line";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { appName } = publicInfo();
  return { title: `${appName} — Advertising management`, description: `${appName} helps marketing teams monitor and manage their own Google Ads, Meta Ads and Google Analytics 4 accounts.` };
}

export default function AboutPage() {
  const info = publicInfo();
  return (
    <article className="space-y-8 leading-relaxed">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold text-slate-900">{info.appName}</h1>
        <p className="text-lg text-slate-600">
          {info.appName} is an internal advertising management tool operated by {info.orgName}. It helps the
          marketing team monitor performance, find problems and manage campaigns across the organization&apos;s own
          Google Ads, Meta (Facebook) Ads and Google Analytics 4 accounts from one place.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">What the app does</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Performance dashboards</strong> — spend, clicks, impressions, conversions and cost per result for Google Ads and Meta Ads campaigns, combined with Google Analytics 4 traffic.</li>
          <li><strong>Campaign diagnostics</strong> — detects wasted spend, budget pacing issues, low-quality keywords, ad fatigue and policy problems, and explains the reason for each finding.</li>
          <li><strong>Recommendations and AI assistance</strong> — suggests next steps and drafts ad copy based on campaign performance.</li>
          <li><strong>Campaign management</strong> — authorized staff can create Google Ads Search and Performance Max campaigns and change budgets, bids, keywords, assets and campaign status. Every change is started and confirmed by a signed-in user and is recorded in an activity log.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Who can use it</h2>
        <p>
          Access is limited to staff accounts created by an administrator of {info.orgName}. There is no public
          sign-up. An administrator connects the organization&apos;s advertising accounts once, using Google&apos;s
          standard OAuth consent screen (Google Ads and read-only Google Analytics access).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">How we handle Google user data</h2>
        <p>
          Data received from Google APIs is used only to provide the features above to the organization that connected
          its accounts. We do not sell it, use it for advertising, or share it with third parties except as described in
          our <Link href="/privacy" className="font-medium text-orange-600 underline">Privacy Policy</Link>. You can revoke
          access at any time from your Google Account at{" "}
          <a href="https://myaccount.google.com/permissions" className="text-orange-600 underline" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
        <ContactLine info={info} />
      </section>
    </article>
  );
}
