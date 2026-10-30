// Feature flag for Part 7b Books (read-only registers). OFF by default.
// Turn on in Settings → Features (Admin), or set BOOKS_ENABLED=true in env
// for staging. Env wins when set to "1" / "true" / "yes".

import { getSettingsSnapshot } from "../settings";

/** Sync check from env only (useful in unit tests without DB). */
export function booksEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean | null {
  const raw = (env.BOOKS_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}

/** Effective flag: env override if set, else Settings.features.booksEnabled (default false). */
export async function isBooksEnabled(): Promise<boolean> {
  const fromEnv = booksEnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.booksEnabled === true;
}
