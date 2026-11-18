// Shared data-truth contract for reporting and AI decisions.
// A numeric zero is valid only when the source call succeeded and measured zero.

export type DataTruthStatus = "real" | "stale" | "unavailable" | "estimated";

export interface DataTruth<T> {
  value: T | null;
  status: DataTruthStatus;
  source: string;
  fetchedAt: string | null;
  range: { from: string; to: string } | null;
  error: string | null;
  /** Optional age of a stale snapshot, in ISO format. */
  staleAt?: string | null;
}

export function real<T>(value: T, source: string, range: DataTruth<T>["range"], fetchedAt = new Date().toISOString()): DataTruth<T> {
  return { value, status: "real", source, fetchedAt, range, error: null };
}

export function unavailable<T>(source: string, error: string, range: DataTruth<T>["range"] = null, fetchedAt = new Date().toISOString()): DataTruth<T> {
  return { value: null, status: "unavailable", source, fetchedAt, range, error };
}

export function stale<T>(value: T, source: string, staleAt: string, range: DataTruth<T>["range"], fetchedAt = new Date().toISOString()): DataTruth<T> {
  return { value, status: "stale", source, fetchedAt, range, staleAt, error: null };
}

export function estimated<T>(value: T, source: string, range: DataTruth<T>["range"], error: string | null = null, fetchedAt = new Date().toISOString()): DataTruth<T> {
  return { value, status: "estimated", source, fetchedAt, range, error };
}

export function isUsable<T>(data: DataTruth<T>): data is DataTruth<T> & { value: T; status: "real" | "stale" | "estimated" } {
  return data.value !== null && data.status !== "unavailable";
}
