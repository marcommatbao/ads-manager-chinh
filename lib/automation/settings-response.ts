import type { TFunction } from "@/lib/i18n/translate";

/** Never surface raw proxy HTML or JSON parser diagnostics to the operator. */
export async function readAutomationJson<T>(response: Response, t: TFunction, kind: "settings" | "pending"): Promise<T> {
  const message = t(kind === "settings" ? "creative.settingsAutomation.err.loadSettings" : "creative.settingsAutomation.err.loadPending", { status: response.status });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(message); }
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as T;
}
