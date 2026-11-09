"use client";
// Đợt 21a — nạp danh sách công ty của BẢN CÀI vào sổ công ty phía trình duyệt (lib/companies/registry).
// Bản Mắt Bão: cấu hình = mặc định → không đổi gì, không vẽ lại. Bản cài khác: khi nạp xong cấu hình khác mặc định thì
// vẽ lại cây con (key) để bộ chọn công ty / nhãn đọc đúng danh sách mới.
import { useEffect, useState } from "react";
import { companiesConfig, setCompaniesConfig, setPublicIds } from "@/lib/companies/registry";
import type { CompaniesConfig } from "@/lib/companies/defaults";
import { setSetupFlags, type SetupFlags } from "@/lib/setup/client";

export function CompaniesBoot({ children }: { children: React.ReactNode }) {
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/companies", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { config?: CompaniesConfig; publicIds?: Record<string, string>; setup?: SetupFlags } | null) => {
        if (alive) setSetupFlags(j?.setup);
        if (!alive || !j?.config?.companies?.length) return;
        if (j.publicIds) setPublicIds(j.publicIds);
        // Đợt 21 A3b: so với cấu hình ĐANG CÓ (máy chủ đã nạp sẵn qua script ở app/(dashboard)/layout.tsx) — trùng thì không vẽ lại.
        if (JSON.stringify(j.config) === JSON.stringify(companiesConfig())) return;
        setCompaniesConfig(j.config);
        setGen((g) => g + 1);
      })
      .catch(() => { /* giữ mặc định */ });
    return () => { alive = false };
  }, []);
  return <div key={gen} className="contents">{children}</div>;
}
