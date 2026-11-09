/**
 * Lot grouping moves (2026-11-09, Jerwin's model): items are selected INTO
 * lots. A line moved into a lot becomes one of the lot's components — it
 * keeps its catalog link, description, qty, unit, supplier and cost, and
 * drops its selling price and withholding pick (the lot line's price and
 * withholding govern the group). A component moved out becomes a fresh
 * line whose price starts empty; the caller builds that line (a new line
 * needs editor defaults this module does not own).
 *
 * Pure functions over the editor's line/component shapes.
 */

export interface LotComponentShape {
  key: string;
  id: string | null;
  itemId: string | null;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  unitCost: string;
}

export interface LotLineShape {
  key: string;
  isLot?: boolean;
  components?: LotComponentShape[];
  itemId: string | null;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierUnitCost: string;
}

/** 1-based number of a lot line among the quote's lots (0 = not a lot). */
export function lotNumberOf<L extends LotLineShape>(items: readonly L[], lineKey: string): number {
  let n = 0;
  for (const i of items) {
    if (i.isLot) n += 1;
    if (i.key === lineKey) return i.isLot ? n : 0;
  }
  return 0;
}

/** The lots something can move into: [{key, n}] in quote order. */
export function lotTargets<L extends LotLineShape>(items: readonly L[], exceptKey?: string): { key: string; n: number }[] {
  const out: { key: string; n: number }[] = [];
  let n = 0;
  for (const i of items) {
    if (!i.isLot) continue;
    n += 1;
    if (i.key !== exceptKey) out.push({ key: i.key, n });
  }
  return out;
}

/**
 * Convert a standalone line into a component of the target lot (appended
 * last). The component reuses the line's key (one allocator serves both)
 * and starts unsaved (id null): the old line row is soft-removed on save.
 */
export function moveLineIntoLot<L extends LotLineShape>(items: readonly L[], lineKey: string, lotKey: string): L[] {
  const line = items.find((i) => i.key === lineKey);
  if (!line || line.isLot) return [...items];
  const comp: LotComponentShape = {
    key: line.key,
    id: null,
    itemId: line.itemId,
    description: line.description,
    qty: line.qty,
    unit: line.unit,
    supplierId: line.supplierId,
    unitCost: line.supplierUnitCost,
  };
  return items
    .filter((i) => i.key !== lineKey)
    .map((i) => (i.key === lotKey && i.isLot ? { ...i, components: [...(i.components ?? []), comp] } : i));
}

/** Move a component from one lot to another (appended last). */
export function moveComponentToLot<L extends LotLineShape>(
  items: readonly L[],
  fromLotKey: string,
  compKey: string,
  toLotKey: string,
): L[] {
  if (fromLotKey === toLotKey) return [...items];
  let moved: LotComponentShape | undefined;
  const stripped = items.map((i) => {
    if (i.key !== fromLotKey) return i;
    moved = (i.components ?? []).find((c) => c.key === compKey);
    return { ...i, components: (i.components ?? []).filter((c) => c.key !== compKey) };
  });
  if (!moved) return [...items];
  const comp = moved;
  return stripped.map((i) => (i.key === toLotKey && i.isLot ? { ...i, components: [...(i.components ?? []), comp] } : i));
}

/**
 * Move a component OUT of its lot. `makeLine` builds the new standalone
 * line from the component; it lands immediately after the lot line.
 */
export function moveComponentOut<L extends LotLineShape>(
  items: readonly L[],
  lotKey: string,
  compKey: string,
  makeLine: (comp: LotComponentShape) => L,
): L[] {
  const lot = items.find((i) => i.key === lotKey);
  const comp = (lot?.components ?? []).find((c) => c.key === compKey);
  if (!lot || !comp) return [...items];
  const out: L[] = [];
  for (const i of items) {
    if (i.key === lotKey) {
      out.push({ ...i, components: (i.components ?? []).filter((c) => c.key !== compKey) });
      out.push(makeLine(comp));
    } else {
      out.push(i);
    }
  }
  return out;
}
