// Phase 4 #4: CSV import (Items catalog) — SERVER-ONLY feature flag.
//
// The pure helpers live in import-shared.ts (client-safe, no server
// imports). This module adds only the async flag check, which reads
// Settings via getSettingsSnapshot (server-only).

import { getSettingsSnapshot } from "../settings";
import { itemsImportEnabledFromEnv } from "./import-shared";

export * from "./import-shared";

/** Effective flag: env override if set, else Settings.features.itemsImportEnabled (default false). */
export async function isItemsImportEnabled(): Promise<boolean> {
  const fromEnv = itemsImportEnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.itemsImportEnabled === true;
}
