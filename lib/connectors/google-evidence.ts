// Server-only health identity. Process-local HMAC key deliberately forces a
// recheck after restart; neither credentials nor this marker belong in APIs.
import { createHmac, randomBytes } from "node:crypto";
import { gatewayConfig } from "@/lib/connect/gateway";
import { readConnect } from "@/lib/connect/store";
import { isFromSettings } from "@/lib/settings/env-origin";

const key = randomBytes(32);
export function googleEvidenceBinding(): string {
  const gateway = gatewayConfig();
  const names = Object.keys(process.env).filter(name =>
    name.startsWith("GOOGLE_ADS_CUSTOMER_ID_") || name === "GOOGLE_ADS_LOGIN_CUSTOMER_ID"
    || name === "GOOGLE_ADS_DEVELOPER_TOKEN"
    || (!gateway && ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"].includes(name)),
  ).sort();
  const connection = gateway ? readConnect().google : undefined;
  const scope = {
    env: names.map(name => [name, process.env[name], isFromSettings(name) ? "settings" : "env"]),
    gateway,
    connection: connection ? { id: connection.connectionId, accounts: connection.accounts.map(a =>
      [a.company, a.customerId, a.loginCustomerId ?? ""]).sort() } : null,
  };
  return createHmac("sha256", key).update(JSON.stringify(scope)).digest("hex");
}

export function freshEvidenceTime(value: string | null | undefined, now = Date.now()): boolean {
  const time = value ? Date.parse(value) : NaN;
  const age = now - time;
  return Number.isFinite(age) && age >= 0 && age < 3_600_000;
}
