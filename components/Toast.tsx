"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { X, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type ToastVariant = "error" | "success" | "info";

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  duration?: number; // ms, default 5000
}

// ─────────────────────────────────────────────
// Single Toast item
// ─────────────────────────────────────────────
const VARIANT_STYLES: Record<ToastVariant, string> = {
  error:   "border-red-200 bg-white text-red-700",
  success: "border-green-200 bg-white text-green-700",
  info:    "border-blue-200 bg-white text-blue-700",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const variant = toast.variant ?? "info";
  const Icon = variant === "error"
    ? AlertCircle
    : variant === "success"
    ? CheckCircle
    : RefreshCw;

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.duration ?? 5000);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={cn(
        "animate-slide-in flex w-[360px] items-start gap-3 rounded-xl border p-4 shadow-lg",
        VARIANT_STYLES[variant]
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs opacity-80 leading-snug">{toast.description}</p>
        )}
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-1.5 text-xs font-semibold underline underline-offset-2 hover:opacity-70"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Toast Container (renders all active toasts)
// ─────────────────────────────────────────────
export function ToastContainer({ toasts, onDismiss }: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Toast state — shared through a provider
//
// This used to be plain component-local state: every caller of useToast()
// got its own independent list, and only a caller that ALSO rendered
// <ToastContainer> could ever show anything. Five call sites did not —
// CampaignTable (pause/resume + bulk), EditBudgetModal, EditRsaModal,
// toolkit/dayparting and competitors — so every confirmation *and* every
// error they raised on real Google/Meta writes was rendered nowhere. The
// user clicked "Tạm dừng", the API returned 403, and the screen said
// nothing at all.
//
// The state now lives in one provider mounted by AppShell, which renders
// the single container. useToast() reads it from context, so a component
// no longer has to host its own container to be heard. The local-state
// fallback below keeps the hook usable outside the provider (e.g. the
// login screen) instead of throwing.
// ─────────────────────────────────────────────

export interface ToastApi {
  toasts: ToastMessage[];
  toast: (msg: Omit<ToastMessage, "id">) => string;
  dismiss: (id: string) => void;
}

function useToastState(): ToastApi {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (msg: Omit<ToastMessage, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { ...msg, id }]);
      return id;
    },
    []
  );

  return { toasts, toast, dismiss };
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Mount once, high enough that it outlives the components raising toasts —
 * a modal that closes right after a successful save must not take its own
 * confirmation down with it.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const api = useToastState();
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={api.toasts} onDismiss={api.dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  const local = useToastState();
  return ctx ?? local;
}
