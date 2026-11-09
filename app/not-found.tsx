import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Trang không tìm thấy | AdsCommand",
};

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-slate-200 leading-none mb-4">404</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Trang không tồn tại</h1>
        <p className="text-slate-500 text-sm mb-8">
          Trang bạn đang tìm kiếm đã bị di chuyển, xóa hoặc chưa tồn tại.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-600 transition-colors"
          >
            <Home className="h-4 w-4" />
            Về Dashboard
          </Link>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Campaigns
          </Link>
        </div>
      </div>
    </div>
  );
}
