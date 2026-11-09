"use client";

// ─────────────────────────────────────────────
// ErrorBoundary — catches React render errors
// ─────────────────────────────────────────────
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";

function ErrorFallback({ message, onReset }: { message?: string; onReset: () => void }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <div className="flex justify-center mb-3">
        <AlertTriangle className="h-8 w-8 text-red-400" />
      </div>
      <p className="text-sm font-semibold text-red-800">{t("panels.error.title")}</p>
      <p className="text-xs text-red-600 mt-1 mb-4">
        {message ?? t("panels.error.unknown")}
      </p>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        {t("panels.error.retry")}
      </button>
    </div>
  );
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, info);
    this.props.onError?.(error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return <ErrorFallback message={this.state.error?.message} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}
