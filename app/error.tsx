"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import type { Metadata } from "next";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">
          <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Đã xảy ra lỗi</h1>
        <p className="text-slate-500 text-sm mb-2">
          {error.message || "Có lỗi không mong muốn xảy ra trong ứng dụng."}
        </p>
        {error.digest && (
          <p className="text-slate-400 text-xs mb-6 font-mono">ID: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Thử lại
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Home className="h-4 w-4" />
            Về Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
