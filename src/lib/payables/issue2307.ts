// Feature flag: HACIEN issuing BIR 2307 to suppliers (withholding agent).
// OFF by default — HACIEN is not a withholding agent until RDO confirms.
// Turn on in Settings → Features, or set PAYABLES_2307_ENABLED=true.
// Env wins when set to "1" / "true" / "yes" / "on".

import { getSettingsSnapshot } from "../settings";

/** Sync check from env only (useful in unit tests without DB). */
export function payables2307EnabledFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean | null {
  const raw = (env.PAYABLES_2307_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}

/** Effective flag: env override if set, else Settings.features.payables2307Enabled (default false). */
export async function isPayables2307Enabled(): Promise<boolean> {
  const fromEnv = payables2307EnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.payables2307Enabled === true;
}
