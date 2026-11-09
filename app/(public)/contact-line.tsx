import type { PublicInfo } from "@/lib/public-info";

/** Thiếu PUBLIC_CONTACT_EMAIL thì hiện cảnh báo rõ ràng — Google bắt chính sách có cách liên hệ, không được bịa email. */
export function ContactLine({ info }: { info: PublicInfo }) {
  return (
    <div className="space-y-1">
      <p>{info.orgName}{info.orgAddress ? ` — ${info.orgAddress}` : ""}</p>
      {info.contactEmail ? (
        <p>Email: <a href={`mailto:${info.contactEmail}`} className="font-medium text-orange-600 underline">{info.contactEmail}</a></p>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Contact email is not configured yet (administrator: set PUBLIC_CONTACT_EMAIL).
        </p>
      )}
    </div>
  );
}
