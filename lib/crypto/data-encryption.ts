// ============================================================
// Field-level encryption at rest for credentials stored in data/*.json.
//
// Whole-file encryption was considered and rejected: meta-settings.json
// and google-settings.json each mix real secrets (refreshToken,
// accessToken, appSecret, developerToken, clientSecret) with non-secret
// operational fields (adAccountId, customerId, appId/clientId — displayed
// in the Settings UI, read by non-privileged code paths) that don't need
// decryption to use. Field-level keeps the decryption key needed by fewer
// code paths and avoids paying the decrypt cost on every read of a file
// that's mostly non-sensitive data.
//
// AES-256-GCM via Node's built-in crypto module — no new dependency.
// ============================================================

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // recommended for GCM

export interface EncryptedField {
  __enc: true;
  iv: string;   // base64
  tag: string;  // base64, GCM auth tag
  data: string; // base64, ciphertext
}

export class MissingEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingEncryptionKeyError";
  }
}

let cachedKey: Buffer | null = null;

/**
 * Loads and validates DATA_ENCRYPTION_KEY. Throws — deliberately, not a
 * silent plaintext fallback — if the key is missing or the wrong length.
 * Callers that must never crash boot over this (none currently; see
 * instrumentation.ts's explicit fail-fast check) should catch explicitly,
 * not rely on this function returning a safe default.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new MissingEncryptionKeyError(
      "DATA_ENCRYPTION_KEY not set — cannot encrypt/decrypt credentials at rest. " +
      "Generate one with: openssl rand -base64 32"
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new MissingEncryptionKeyError("DATA_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== 32) {
    throw new MissingEncryptionKeyError(
      `DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
      "Generate one with: openssl rand -base64 32"
    );
  }

  cachedKey = key;
  return key;
}

/** Throws if DATA_ENCRYPTION_KEY is missing/invalid — call once at boot to fail fast. */
export function assertEncryptionKeyConfigured(): void {
  getKey();
}

export function encryptField(plaintext: string): EncryptedField {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: true,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

/** Throws on auth-tag mismatch (wrong key or tampered/corrupted data). */
export function decryptField(field: EncryptedField): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(field.iv, "base64"));
  decipher.setAuthTag(Buffer.from(field.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(field.data, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__enc === true
  );
}

/**
 * Encrypts the named string fields of obj in place (returns a new object).
 * Leaves already-encrypted fields untouched (idempotent) and skips
 * empty/absent fields — nothing to encrypt.
 */
export function encryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly (keyof T)[]
): T {
  const out: T = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0 && !isEncryptedField(value)) {
      (out as Record<string, unknown>)[field as string] = encryptField(value);
    }
  }
  return out;
}

/**
 * Decrypts the named fields of obj in place (returns a new object).
 * Leaves plain strings (not-yet-migrated data, or non-secret fields)
 * untouched — safe to call on partially-migrated files.
 */
export function decryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly (keyof T)[]
): T {
  const out: T = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (isEncryptedField(value)) {
      (out as Record<string, unknown>)[field as string] = decryptField(value);
    }
  }
  return out;
}
