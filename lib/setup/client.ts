"use client";
// Đợt 21 A6 — cờ trình thiết lập phía trình duyệt (nạp cùng /api/companies trong CompaniesBoot). Mặc định TẮT (bản Mắt Bão).
import { useSyncExternalStore } from "react";

export interface SetupFlags { enabled: boolean; pending: boolean }
let flags: SetupFlags = { enabled: false, pending: false };
const listeners = new Set<() => void>();

export function setSetupFlags(f: Partial<SetupFlags> | null | undefined) {
  const next = { enabled: !!f?.enabled, pending: !!f?.pending };
  if (next.enabled === flags.enabled && next.pending === flags.pending) return;
  flags = next;
  listeners.forEach((l) => l());
}
export function useSetupFlags(): SetupFlags {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => flags, () => flags);
}
