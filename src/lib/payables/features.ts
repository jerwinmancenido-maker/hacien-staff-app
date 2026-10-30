// Feature flag for Part 6 payables pages. OFF by default.
// Turn on in Settings → Features (Admin), or set PAYABLES_ENABLED=true in env
// for staging. Env wins when set to "1" / "true" / "yes".

import { getSettingsSnapshot } from "../settings";

/** Sync check from env only (useful in unit tests without DB). */
export function payablesEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean | null {
  const raw = (env.PAYABLES_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}

/** Effective flag: env override if set, else Settings.features.payablesEnabled (default false). */
export async function isPayablesEnabled(): Promise<boolean> {
  const fromEnv = payablesEnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.payablesEnabled === true;
}
