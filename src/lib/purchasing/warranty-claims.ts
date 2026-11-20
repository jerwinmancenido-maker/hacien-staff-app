// Phase 3 #8b: supplier warranty claims — SERVER-ONLY feature flag.
//
// The pure rules (statuses, labels, transitions, serial helpers, env
// check) live in warranty-claims-shared.ts, which is client-safe and
// has no server imports. This module re-exports them for existing
// server-side importers and adds only the async flag check, which
// reads Settings via getSettingsSnapshot (server-only: settings ->
// db/Prisma). Client components must import the pure parts from
// warranty-claims-shared, never from here.

import { getSettingsSnapshot } from "../settings";
import { warrantyClaimsEnabledFromEnv } from "./warranty-claims-shared";

export * from "./warranty-claims-shared";

/** Effective flag: env override if set, else Settings.features.warrantyClaimsEnabled (default false). */
export async function isWarrantyClaimsEnabled(): Promise<boolean> {
  const fromEnv = warrantyClaimsEnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.warrantyClaimsEnabled === true;
}
