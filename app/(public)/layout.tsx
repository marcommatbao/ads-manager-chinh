// Trang công khai (/about, /privacy) — không sidebar, không cần đăng nhập. Viết tiếng Anh vì người duyệt
// OAuth của Google đọc trang này (15/10/2026). Câu chữ cần BA rà trước khi nộp.
import Link from "next/link";
import { Zap } from "lucide-react";
import { publicInfo } from "@/lib/public-info";

export const dynamic = "force-dynamic";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const info = publicInfo();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4">
          <Link href="/about" className="flex shrink-0 items-center gap-2 font-bold text-slate-800">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-white"><Zap className="h-4 w-4" /></span>
            {info.appName}
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-sm sm:gap-4">
            <Link href="/about" className="hover:text-slate-900">About</Link>
            <Link href="/privacy" className="hover:text-slate-900">Privacy<span className="hidden sm:inline"> Policy</span></Link>
            <Link href="/login" className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-slate-500">
          <span>© 2026 {info.orgName}. {info.appName} is operated by {info.orgName}.</span>
          <span className="flex gap-3">
            <Link href="/about" className="hover:text-slate-800">About</Link>
            <Link href="/privacy" className="hover:text-slate-800">Privacy Policy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
