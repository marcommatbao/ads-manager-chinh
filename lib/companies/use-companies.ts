"use client";
// Đợt 21 A2 — giao diện vẽ lại khi CompaniesBoot nạp cấu hình bản cài (mô-đun, danh sách công ty) từ /api/companies.
import { useSyncExternalStore } from "react";
import { companiesVersion, subscribeCompanies } from "./registry";

export function useCompaniesVersion(): number {
  return useSyncExternalStore(subscribeCompanies, companiesVersion, () => 0);
}
