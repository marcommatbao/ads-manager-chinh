// Google-only persistence/provenance. Keep the legacy encrypted file shape and
// startup's env-first policy; metadata is derived here, never accepted from callers.
import fs from "node:fs";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { isFromSettings, patchFromSettings, setByInfra } from "./env-origin";

export type GoogleSettings = {
  developerToken?: string; clientId?: string; clientSecret?: string; refreshToken?: string;
  customerIdMBC?: string; customerIdMBI?: string; loginCustomerId?: string;
  customerIds?: Record<string, string>;
};
const secrets = ["developerToken", "clientSecret", "refreshToken"] as const;
const fields = {
  developerToken: "GOOGLE_ADS_DEVELOPER_TOKEN", clientId: "GOOGLE_ADS_CLIENT_ID",
  clientSecret: "GOOGLE_ADS_CLIENT_SECRET", refreshToken: "GOOGLE_ADS_REFRESH_TOKEN",
  customerIdMBC: "GOOGLE_ADS_CUSTOMER_ID_MBC", customerIdMBI: "GOOGLE_ADS_CUSTOMER_ID_MBI",
  loginCustomerId: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
} as const;

export function readGoogleCredentials(file: string): GoogleSettings {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid settings");
  const saved = decryptFields(parsed, secrets);
  // Keep both historical spellings readable without a file migration.
  saved.customerIdMBC ??= saved.customerIdMbc;
  saved.customerIdMBI ??= saved.customerIdMbi;
  for (const field of Object.keys(fields)) {
    if (saved[field] !== undefined && typeof saved[field] !== "string") throw new Error("Invalid settings field");
  }
  if (saved.customerIds !== undefined && (!saved.customerIds || typeof saved.customerIds !== "object" || Array.isArray(saved.customerIds)
    || Object.values(saved.customerIds).some((v) => typeof v !== "string"))) throw new Error("Invalid company settings");
  return saved;
}

function entries(saved: GoogleSettings, suffixOf: (co: string) => string) {
  const result: { field: string; name: string; value: string | undefined }[] = Object.entries(fields).map(([field, name]) => ({ field, name, value: saved[field as keyof typeof fields]?.trim() }));
  // Match startup: legacy fields win over customerIds when both are nonempty.
  for (const [co, value] of Object.entries(saved.customerIds ?? {})) {
    const name = `GOOGLE_ADS_CUSTOMER_ID_${suffixOf(co)}`;
    const legacy = result.find((e) => e.name === name);
    if (legacy?.value) continue;
    if (legacy) legacy.value = value.trim();
    else result.push({ field: `customerIds.${co}`, name, value: value.trim() });
  }
  return result;
}

export function googleCredentialProvenance(file: string, suffixOf: (co: string) => string) {
  let saved: GoogleSettings = {};
  let storage: "readable" | "missing" | "unreadable" = "readable";
  try { saved = readGoogleCredentials(file); if (!fs.existsSync(file)) storage = "missing"; }
  catch { storage = "unreadable"; }
  const details = entries(saved, suffixOf).map(({ field, name, value }) => {
    const runtime = process.env[name];
    const origin = runtime ? (isFromSettings(name) ? "settings" : "env") : "unset";
    const persisted = typeof value === "string" && !!value;
    return { field, origin, persisted, matchesSaved: persisted ? runtime === value : null,
      restartConflict: persisted && setByInfra(name) && runtime !== value };
  });
  return {
    policy: "env-first" as const, originBasis: "env-origin-markers" as const, restartVerified: false, storage, fields: details,
    persisted: storage === "readable" && details.some((f) => f.persisted),
    effective: storage === "readable" && details.some((f) => f.persisted) && details.filter((f) => f.persisted).every((f) => f.matchesSaved),
    restartConflict: details.some((f) => f.restartConflict),
    // A prediction under the same env/key/path, not evidence of a runtime restart.
    restart: storage === "unreadable" ? "unknown" : details.some((f) => f.restartConflict) ? "env-conflict" : "same-env-key-storage-required",
    auth: "not-tested" as const,
  };
}
export type GoogleCredentialProvenance = ReturnType<typeof googleCredentialProvenance>;

export async function saveGoogleCredentials(file: string, patch: GoogleSettings, suffixOf: (co: string) => string) {
  return withFileLock(file, async () => {
    const existing = readGoogleCredentials(file); // Fail closed; never replace unreadable secrets.
    const merged = { ...existing, ...patch,
      ...(patch.customerIds ? { customerIds: { ...existing.customerIds, ...patch.customerIds } } : {}) };
    writeFileAtomicSync(file, JSON.stringify(encryptFields(merged, secrets), null, 2));
    // No runtime mutation until encryption and atomic replacement both succeed.
    for (const { name, value } of entries(merged, suffixOf)) {
      if (value) patchFromSettings(name, value);
      else if (isFromSettings(name) && !setByInfra(name)) delete process.env[name];
    }
    return googleCredentialProvenance(file, suffixOf);
  });
}
