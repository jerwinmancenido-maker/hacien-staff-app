// Phase 4 #4: CSV import (Items catalog) — PURE, client-safe helpers.
//
// This module has NO server imports (no settings, no DB) so client
// components can use the constants and the env check without dragging
// the server settings/db chain into the browser bundle. The server-only
// flag check lives in import-enabled.ts.

/** Maximum data rows per file (master plan §8, scenario I5). */
export const ITEM_IMPORT_MAX_ROWS = 1000;

/** Recognised columns (header row, case-insensitive, order-free). */
export const ITEM_IMPORT_COLUMNS = [
  "name",
  "unit",
  "brand",
  "model",
  "category",
  "sku",
  "kind",
  "details",
  "defaultunitprice",
] as const;

/** Sync check from env only (useful in unit tests without DB). */
export function itemsImportEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean | null {
  const raw = (env.ITEMS_IMPORT_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}
