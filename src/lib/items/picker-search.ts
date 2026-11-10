/**
 * Interprets a catalog-picker search response for the quote editor.
 *
 * A failed search (HTTP error, an `{ ok: false }` body, or an unparseable
 * response) must NOT be presented as "no product found": on live
 * (REQ-PICKER-001) a bare 500 from /api/items/search rendered as an empty
 * list, indistinguishable from an empty catalog. `failed` lets the picker
 * show a real "Search failed, try again." state instead.
 */
export type PickerSearchOutcome<T> = { items: T[]; failed: boolean };

export function pickerSearchOutcome<T>(resOk: boolean, body: unknown): PickerSearchOutcome<T> {
  if (!resOk) return { items: [], failed: true };
  if (body == null || typeof body !== "object") return { items: [], failed: true };
  const b = body as { ok?: unknown; items?: unknown };
  if (b.ok !== true || !Array.isArray(b.items)) return { items: [], failed: true };
  return { items: b.items as T[], failed: false };
}
