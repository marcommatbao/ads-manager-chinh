"use client";

import { createContext, useContext, useState, useEffect } from "react";
import type { Role } from "@/lib/permissions";

// ─────────────────────────────────────────────
// Session Context (Client-side)
// ─────────────────────────────────────────────

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companies: string[];
}

interface SessionContextType {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function SessionProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser?: SessionUser | null;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(!initialUser);

  const refresh = async () => {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const json = await res.json();
        setUser(json.authenticated ? json.user : null);
      }
      // if API is unreachable (403/network), keep the server-provided initialUser
    } catch {
      // keep initialUser on failure
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  };

  useEffect(() => {
    if (!initialUser) refresh();
    else setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
