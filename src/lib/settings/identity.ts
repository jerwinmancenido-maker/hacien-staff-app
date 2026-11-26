// Derived company-identity helpers (Company Profile, plan §3).
//
// Every screen/CSV surface reads company identity from the settings
// snapshot through these helpers — never from a literal — so the strings
// cannot disagree with Settings → Company Profile. The helpers are pure:
// callers pass the snapshot (or its sections) they already loaded via
// getSettingsSnapshot().

import { DEFAULT_SETTINGS } from "./defaults";
import type { Settings } from "./schema";

/**
 * Last-resort company name for component prop defaults. Every real caller
 * passes the settings-fed value; this only fires when a component is
 * rendered without one (tests, previews). Its one source is the settings
 * seed in ./defaults.ts — not a literal here.
 */
export const FALLBACK_SHORT_NAME = DEFAULT_SETTINGS.identity.appShortName;

/** App identity edges derived from one settings snapshot. */
export function appIdentity(settings: Settings) {
  return {
    /** Browser tab title / installed app's full name. */
    title: settings.identity.appTitle,
    /** Short brand name (breadcrumb root, installed app's short name). */
    shortName: settings.identity.appShortName,
    /** Registered (legal) company name — prints and legal surfaces. */
    companyName: settings.company.name,
    /** Download filename prefix for CSV exports ("" = no prefix). */
    csvFilePrefix: settings.identity.csvFilePrefix,
  };
}

/**
 * Download filename for a CSV export: "<prefix>-<rest>" — or the bare
 * rest when the prefix is blank. With the seeded prefix ("hacien") the
 * names are exactly the historical ones.
 */
export function csvDownloadName(csvFilePrefix: string, rest: string): string {
  const prefix = csvFilePrefix.trim();
  return prefix ? `${prefix}-${rest}` : rest;
}
