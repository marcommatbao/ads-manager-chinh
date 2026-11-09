// Chính sách quyền riêng tư công khai — nội dung khớp đúng những gì mã đang làm (kiểm 15/10/2026):
// scope adwords + analytics.readonly, token mã hoá AES-256-GCM, một số chỉ số gửi Gemini, ghi lên Google Ads chỉ khi
// người dùng bấm (tự động hoá mặc định chỉ MÔ PHỎNG — dry_run). Đổi hành vi dữ liệu thì PHẢI sửa trang này cùng lúc.
import type { Metadata } from "next";
import { publicInfo } from "@/lib/public-info";
import { ContactLine } from "../contact-line";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Privacy Policy — ${publicInfo().appName}` };
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-xl font-semibold text-slate-900">{children}</h2>;
}

export default function PrivacyPage() {
  const info = publicInfo();
  const app = info.appName;
  return (
    <article className="space-y-4 leading-relaxed">
      <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="text-sm text-slate-500">Last updated: {info.policyUpdated}</p>
      <p>
        This policy explains how {app} (“the app”), operated by {info.orgName} (“we”, “us”),
        accesses, uses, stores and shares data, including data received from Google APIs.
      </p>

      <H>1. Who uses the app</H>
      <p>
        {app} is an internal tool. Only staff accounts created by an administrator of {info.orgName} can sign in. The
        advertising and analytics accounts connected to the app belong to {info.orgName}.
      </p>

      <H>2. Data we access</H>
      <p><strong>Google Ads</strong> (OAuth scope <code className="break-all">https://www.googleapis.com/auth/adwords</code>): account names and IDs,
        campaigns, ad groups, ads, assets, keywords, search terms, budgets, bidding settings, conversion actions, policy
        status, and performance metrics such as spend, impressions, clicks and conversions.</p>
      <p><strong>Google Analytics 4</strong> (OAuth scope <code className="break-all">https://www.googleapis.com/auth/analytics.readonly</code>, read-only):
        property and data-stream identifiers and aggregated report metrics such as sessions, users and conversions by
        source, medium and campaign. We do not access data about individual website visitors.</p>
      <p><strong>Meta (Facebook) Ads</strong>, through the Meta Marketing API: campaigns, ad sets, ads, creatives, pixels and
        performance insights of the connected ad account.</p>
      <p><strong>App account data</strong>: the name, work email address and role of each staff user, and a log of the
        actions they take in the app.</p>

      <H>3. How we use the data</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>To show performance reports and dashboards to authorized staff.</li>
        <li>To detect problems (for example wasted spend or budget pacing issues) and suggest improvements.</li>
        <li>To create or change Google Ads campaigns, budgets, bids, keywords, assets and status <strong>only when a
          signed-in user starts and confirms the change</strong>. Rule-based automation runs in simulation mode by default — it proposes changes but does not apply
          them — and only an administrator can switch it to apply changes. Every change made through the app is recorded in an
          activity log.</li>
      </ul>
      <p>We do not use data received from Google APIs for advertising, to build user profiles, or to train
        general-purpose AI models.</p>

      <H>4. AI processing</H>
      <p>
        To generate analyses and ad copy suggestions, the app sends selected campaign information (such as campaign
        names, ad text and performance metrics) to the Google Gemini API. OAuth tokens and passwords are never sent. The
        results are shown only to authorized staff of {info.orgName}.
      </p>

      <H>5. Storage and security</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>OAuth refresh tokens and other API secrets are encrypted at rest with AES-256-GCM on the server operated by {info.orgName}.</li>
        <li>Report data is cached on the same server to keep the app fast. Tokens are never sent to the browser.</li>
        <li>All traffic uses HTTPS. Access inside the app is controlled by user roles, and only administrators can connect or replace account credentials.</li>
      </ul>

      <H>6. Sharing</H>
      <p>
        We do not sell or rent any data. We do not share data received from Google APIs with third parties, except: (a)
        service providers that run the app for us (server hosting, and the Google Gemini API as described in section 4),
        or (b) when required by law.
      </p>

      <H>7. Google API Services User Data Policy</H>
      <p>
        {app}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-orange-600 underline" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <H>8. Retention and deletion</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>Cached report data is kept only as long as needed to provide the app&apos;s features.</li>
        <li>You can revoke the app&apos;s access to your Google account at any time at{" "}
          <a href="https://myaccount.google.com/permissions" className="text-orange-600 underline" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
          An administrator can also remove the stored credentials in the app settings.</li>
        <li>To ask us to delete data we hold, contact us using the details below. We will delete it within 30 days.</li>
      </ul>

      <H>9. Children</H>
      <p>The app is a business tool and is not directed at children under 16.</p>

      <H>10. Changes to this policy</H>
      <p>We will update the date at the top of this page when this policy changes.</p>

      <H>11. Contact</H>
      <ContactLine info={info} />
    </article>
  );
}
