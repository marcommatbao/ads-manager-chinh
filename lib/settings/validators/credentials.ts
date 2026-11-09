// Credential helpers — masking and placeholder detection.
// Never log or expose raw credential values.

/**
 * Mask a secret for display: keep first 4 + last 4 chars.
 * Very short values → "****" entirely.
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  const v = String(value);
  if (v.length <= 8) return "****";
  return v.slice(0, 4) + "****" + v.slice(-4);
}

/**
 * Returns true if the value looks like a masked placeholder (contains ****).
 * Use this to skip overwriting a real credential when the client echoes back
 * the masked display value unchanged.
 */
export function isMaskedPlaceholder(value: string | undefined | null): boolean {
  return typeof value === "string" && value.includes("****");
}
