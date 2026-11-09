"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Page tạm ẩn — bỏ redirect để khôi phục, xem git history cho code gốc
export default function CplPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
