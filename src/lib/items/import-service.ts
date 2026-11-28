// Phase 4 #4: CSV import (Items catalog) — SERVER-ONLY import service.
//
// Preview: parse + catalog duplicate checks. Confirm: re-parse and
// re-validate the submitted CSV text server-side (the preview is NEVER
// trusted), re-check duplicates INSIDE one all-or-nothing transaction,
// create every row in that transaction stamped with one batch id, and
// write exactly ONE audit row for the whole import (same tx, per the
// audit rule). If any row is invalid or a duplicate at confirm time the
// transaction creates nothing and the per-row errors are returned —
// that is what makes a manual create racing the confirm lose cleanly
// (scenario I7): the confirm aborts as duplicates, no partial write.
//
// Duplicate lookups are BATCHED per file (master plan H9): ONE query for
// all SKUs and ONE query for all name-keys, never one query per row.

import { randomBytes } from "node:crypto";
import { writeAudit } from "../audit";
import { db, type Db, type Tx } from "../db";
import { findNearNameMatches } from "../duplicates";
import {
  applyCatalogDuplicateChecks,
  applyInFileDuplicateChecks,
  itemNameKey,
  normalizeSku,
  parseItemsCsv,
  type ExistingItemKeys,
  type ImportRowPreview,
} from "./import";

export interface ItemsImportPreview {
  fileError: string | null;
  rows: ImportRowPreview[];
}

export type ConfirmItemsImportResult =
  | { ok: true; batchId: string; count: number; itemIds: string[] }
  | { ok: false; fileError: string | null; rows: ImportRowPreview[] };

type ItemReader = Pick<Db | Tx, "item">;

/** Batched catalog keys for the rows' SKUs and SKU-less name+brand+model keys. */
export async function fetchExistingItemKeys(client: ItemReader, rows: ImportRowPreview[]): Promise<ExistingItemKeys> {
  const skus = new Set<string>();
  const wantedNameKeys = new Set<string>();
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.data) continue;
    const sku = normalizeSku(row.data.sku);
    if (sku) {
      skus.add(sku);
      continue;
    }
    wantedNameKeys.add(itemNameKey(row.data.name, row.data.brand, row.data.model));
    names.add(row.data.name);
  }

  const skuSet = new Set<string>();
  if (skus.size > 0) {
    // ONE query for every SKU in the file (MySQL's ci collation matches
    // case-insensitively; results are normalised again in JS).
    const found = await client.item.findMany({
      where: { sku: { in: [...skus] } },
      select: { sku: true },
    });
    for (const item of found) {
      const key = normalizeSku(item.sku);
      if (key) skuSet.add(key);
    }
  }

  const nameKeys = new Set<string>();
  if (wantedNameKeys.size > 0) {
    // ONE query for every SKU-less row: fetch by name, keep only the
    // name+brand+model keys this file actually asks about.
    const found = await client.item.findMany({
      where: { name: { in: [...names] } },
      select: { name: true, brand: true, model: true },
    });
    for (const item of found) {
      const key = itemNameKey(item.name, item.brand, item.model);
      if (wantedNameKeys.has(key)) nameKeys.add(key);
    }
  }

  return { skus: skuSet, nameKeys };
}

function isDuplicateError(error: string): boolean {
  return error.startsWith("Duplicate SKU") || error.startsWith("Duplicate item");
}

/**
 * Parse + validate + catalog duplicate checks, with the rows the user
 * excluded in the preview already dropped. Duplicate errors from the
 * first parse are recomputed after the drop: removing an earlier row
 * can clear a later row's in-file duplicate flag.
 */
async function prepareRows(
  client: ItemReader,
  csvText: string,
  excludeLines: ReadonlySet<number>,
): Promise<ItemsImportPreview> {
  const parsed = parseItemsCsv(csvText);
  if (parsed.fileError) return { fileError: parsed.fileError, rows: [] };
  const rows = parsed.rows.filter((row) => !excludeLines.has(row.line));
  for (const row of rows) row.errors = row.errors.filter((e) => !isDuplicateError(e));
  applyInFileDuplicateChecks(rows);
  const existing = await fetchExistingItemKeys(client, rows);
  applyCatalogDuplicateChecks(rows, existing);
  await applyNearNameWarnings(client, rows);
  return { fileError: null, rows };
}

/**
 * Finding 1364: near-duplicate names (typo-level, or exact name under a
 * different SKU) become row WARNINGS — the shared matcher (lib/duplicates).
 * Warnings never block the import; the preview shows them and the confirm's
 * batch audit row records them. Rows already carrying a duplicate ERROR
 * (exact SKU / exact name+brand+model) are not double-reported.
 */
async function applyNearNameWarnings(client: ItemReader, rows: ImportRowPreview[]): Promise<void> {
  const candidates = rows.filter((row) => row.data && !row.errors.some((e) => isDuplicateError(e)));
  if (!candidates.length) return;
  const catalog = await client.item.findMany({ select: { id: true, name: true, active: true } });
  for (const row of candidates) {
    const matches = findNearNameMatches(catalog, row.data!.name);
    if (!matches.length) continue;
    const names = matches
      .slice(0, 3)
      .map((m) => `"${m.name}"${m.active ? "" : " (inactive)"}`)
      .join(", ");
    row.warnings.push(
      `Similar product already exists: ${names}. This row will still import — check it is not a duplicate.`,
    );
  }
}

/** Preview only — reads the catalog, writes nothing. */
export async function previewItemsImport(csvText: string): Promise<ItemsImportPreview> {
  return prepareRows(db, csvText, new Set());
}

/**
 * Confirm an import. `excludeLines` are spreadsheet line numbers the
 * user removed in the preview; only rows dropped there are skipped —
 * every remaining row is fully re-validated here.
 */
export async function confirmItemsImport(
  csvText: string,
  actorId: string,
  excludeLines: readonly number[] = [],
): Promise<ConfirmItemsImportResult> {
  const excluded = new Set(excludeLines);
  return db.$transaction(async (tx) => {
    const { fileError, rows } = await prepareRows(tx, csvText, excluded);
    if (fileError) return { ok: false as const, fileError, rows: [] };
    if (rows.length === 0) {
      return { ok: false as const, fileError: "Every row was removed in the preview — nothing to import.", rows: [] };
    }
    if (rows.some((row) => row.errors.length > 0)) {
      // Nothing has been written in this transaction, so returning here
      // aborts the whole import: no partial write, no double-create.
      return { ok: false as const, fileError: null, rows };
    }

    const batchId = `imp-${randomBytes(8).toString("hex")}`;
    const itemIds: string[] = [];
    for (const row of rows) {
      const created = await tx.item.create({ data: { ...row.data!, importBatchId: batchId } });
      itemIds.push(created.id);
    }
    // Finding 1364: rows confirmed past a near-duplicate warning are
    // recorded on the batch audit row (the import's confirm IS the confirm).
    const dupeWarnings = rows
      .filter((row) => row.warnings.length > 0)
      .map((row) => ({ line: row.line, name: row.data?.name ?? "", warnings: row.warnings }));
    await writeAudit(tx, {
      userId: actorId,
      entityType: "Item",
      entityId: batchId,
      action: "import",
      after: {
        batchId,
        count: itemIds.length,
        itemIds,
        ...(dupeWarnings.length ? { duplicateNameWarnings: dupeWarnings } : {}),
      },
    });
    return { ok: true as const, batchId, count: itemIds.length, itemIds };
  });
}
