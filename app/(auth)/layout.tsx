// Auth layout — no sidebar/header (login/register pages)
import { companiesBootScript } from "@/lib/companies/boot-script";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Đợt 25: tên tổ chức của bản cài trên trang đăng nhập / đổi mật khẩu (lib/companies/brand-text.ts). Không kèm mã công khai.
  const boot = companiesBootScript({ publicIds: false });
  return (
    <>
      {boot && <script dangerouslySetInnerHTML={{ __html: boot }} />}
      {children}
    </>
  );
}
