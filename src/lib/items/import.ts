// Phase 4 #4: CSV import (Items catalog) — parse + validate (PURE).
//
// No DB and no server imports: the caller (preview action / import
// service) supplies the existing-catalog keys for the duplicate check,
// fetched with ONE batched query per file (master plan H9), never one
// query per row. Rows are validated with the item form's OWN schema
// (itemSchema), so an imported item obeys exactly the form's rules.

import Papa from "papaparse";
import { itemSchema, type ItemInput } from "../validation/items";
import { ITEM_IMPORT_COLUMNS, ITEM_IMPORT_MAX_ROWS } from "./import-shared";

export interface ImportRowPreview {
  /** Spreadsheet line number: the header is line 1, first data row is 2. */
  line: number;
  /** Normalised raw cell text per canonical column, for the preview UI. */
  values: Record<string, string>;
  /** Schema-valid item input, or null when the row failed validation. */
  data: ItemInput | null;
  errors: string[];
}

export interface ParseItemsCsvResult {
  /** File-level failure (bad header, too many rows, unparseable). Rows are empty then. */
  fileError: string | null;
  rows: ImportRowPreview[];
}

const CANONICAL = new Set<string>(ITEM_IMPORT_COLUMNS);

/** Header cell -> canonical column key: case/space/underscore-insensitive. */
function canonicalHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s_]+/g, "");
}

export function normalizeSku(sku: string | null | undefined): string {
  return (sku ?? "").trim().toLowerCase();
}

/** Duplicate identity for SKU-less rows: normalised name+brand+model. */
export function itemNameKey(name: string, brand?: string | null, model?: string | null): string {
  return [name, brand ?? "", model ?? ""].map((s) => s.trim().toLowerCase()).join("|");
}

const FORMULA_LEAD = ["=", "+", "-", "@"];

function hasFormulaLeadingCell(cells: string[]): boolean {
  return cells.some((raw) => {
    if (raw.startsWith("\t") || raw.startsWith("\r")) return true;
    const v = raw.trim();
    return v.length > 0 && FORMULA_LEAD.includes(v[0]!);
  });
}

/** Map the CSV kind cell to the schema enum; unknown values pass through so the schema flags them. */
function mapKind(raw: string): string {
  const v = raw.trim();
  if (!v) return "GOODS";
  const lower = v.toLowerCase();
  if (lower === "goods") return "GOODS";
  if (lower === "services" || lower === "service") return "SERVICES";
  return v;
}

/** The import layer strips a leading ₱ and spaces BEFORE the form schema (plan I3). */
function mapPrice(raw: string): string {
  let v = raw.trim();
  if (v.startsWith("₱")) v = v.slice(1).trim();
  return v;
}

export function parseItemsCsv(text: string): ParseItemsCsvResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const fatal = parsed.errors.find((e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter");
  if (fatal) return { fileError: "Could not detect the CSV delimiter — save the file with comma or semicolon separators.", rows: [] };

  const all = parsed.data.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (all.length === 0) return { fileError: "The file is empty.", rows: [] };

  const header = (all[0] ?? []).map(canonicalHeader);
  const unknown = header.filter((h) => !CANONICAL.has(h));
  if (unknown.length > 0) {
    return { fileError: `Unknown column(s): ${unknown.join(", ")}. Allowed: name, unit, brand, model, category, sku, kind, details, defaultUnitPrice.`, rows: [] };
  }
  if (new Set(header).size !== header.length) return { fileError: "The header row has duplicate columns.", rows: [] };
  if (!header.includes("name") || !header.includes("unit")) {
    return { fileError: "The file must have at least the name and unit columns.", rows: [] };
  }

  const dataRows = all.slice(1);
  if (dataRows.length === 0) return { fileError: "The file has a header but no data rows.", rows: [] };
  if (dataRows.length > ITEM_IMPORT_MAX_ROWS) {
    return { fileError: `Too many rows: ${dataRows.length}. The limit is ${ITEM_IMPORT_MAX_ROWS} data rows per file — nothing was parsed.`, rows: [] };
  }

  const rows: ImportRowPreview[] = dataRows.map((cells, i) => {
    const values: Record<string, string> = {};
    header.forEach((col, idx) => {
      values[col] = (cells[idx] ?? "").trim();
    });
    for (const col of ITEM_IMPORT_COLUMNS) if (!(col in values)) values[col] = "";

    const errors: string[] = [];
    if (hasFormulaLeadingCell(cells)) errors.push("A cell starts with =, +, - or @ — formula-leading cells are refused; remove it and re-upload.");

    const result = itemSchema().safeParse({
      name: values.name ?? "",
      brand: values.brand ?? "",
      model: values.model ?? "",
      category: values.category ?? "",
      sku: values.sku ?? "",
      unit: values.unit ?? "",
      kind: mapKind(values.kind ?? ""),
      details: values.details ?? "",
      defaultUnitPrice: mapPrice(values.defaultunitprice ?? ""),
    });
    let data: ItemInput | null = null;
    if (result.success) {
      data = result.data;
    } else {
      for (const issue of result.error.issues) errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
    }
    return { line: i + 2, values, data, errors };
  });

  applyInFileDuplicateChecks(rows);
  return { fileError: null, rows };
}

/** Flag rows that duplicate an EARLIER row in the same file (the earlier row stays clean). */
export function applyInFileDuplicateChecks(rows: ImportRowPreview[]): void {
  const seenSkus = new Set<string>();
  const seenNames = new Set<string>();
  for (const row of rows) {
    if (!row.data) continue;
    const sku = normalizeSku(row.data.sku);
    if (sku) {
      if (seenSkus.has(sku)) row.errors.push(`Duplicate SKU "${row.data.sku}" — already used by an earlier row in this file.`);
      else seenSkus.add(sku);
      continue;
    }
    const key = itemNameKey(row.data.name, row.data.brand, row.data.model);
    if (seenNames.has(key)) row.errors.push("Duplicate item (same name, brand and model) — already used by an earlier row in this file.");
    else seenNames.add(key);
  }
}

export interface ExistingItemKeys {
  /** Normalised SKUs already in the catalog (any active state). */
  skus: ReadonlySet<string>;
  /** itemNameKey() values already in the catalog (any active state). */
  nameKeys: ReadonlySet<string>;
}

/** Flag rows that duplicate the existing catalog. Run AFTER parseItemsCsv. */
export function applyCatalogDuplicateChecks(rows: ImportRowPreview[], existing: ExistingItemKeys): void {
  for (const row of rows) {
    if (!row.data) continue;
    const sku = normalizeSku(row.data.sku);
    if (sku) {
      if (existing.skus.has(sku)) row.errors.push(`Duplicate SKU "${row.data.sku}" — an item with this SKU already exists in the catalog.`);
      continue;
    }
    if (existing.nameKeys.has(itemNameKey(row.data.name, row.data.brand, row.data.model))) {
      row.errors.push("Duplicate item (same name, brand and model) — already in the catalog.");
    }
  }
}
