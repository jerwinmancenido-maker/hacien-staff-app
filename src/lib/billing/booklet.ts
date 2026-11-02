// Pre-printed booklet invoice numbers. The app records them; it never generates
// official invoice numbers. Voided and spoiled numbers stay used (never reused).

export type BookletType = "SI" | "DR" | "CR";

export const BOOKLET_TYPES: readonly BookletType[] = ["SI", "DR", "CR"];

export const BOOKLET_DOC_TYPES: Record<BookletType, { code: BookletType; label: string; settingsKey: "salesInvoice" | "deliveryReceipt" | "collectionReceipt" }> = {
  SI: { code: "SI", label: "Sales Invoice", settingsKey: "salesInvoice" },
  DR: { code: "DR", label: "Delivery Receipt", settingsKey: "deliveryReceipt" },
  CR: { code: "CR", label: "Collection Receipt", settingsKey: "collectionReceipt" },
};

export type BookletRange = {
  seriesFrom: number;
  seriesTo: number;
  label?: string | null;
  atpNo?: string;
  atpDate?: string;
  printer?: string;
  bookletCount?: number;
  setsPerBooklet?: number;
  isNonVat?: boolean;
};

export type BookletSlotStatus = "free" | "used" | "voided" | "spoiled";

export type BookletSlot = {
  invoiceNo: number;
  status: BookletSlotStatus;
  billingId?: string;
  billingNumber?: string;
  spoiledId?: string;
  spoiledReason?: string;
};

export type UsedDocSlot = {
  invoiceNo: number;
  id?: string;
  number?: string;
  status?: string;
};

export type SpoiledDocSlot = {
  number: number;
  id?: string;
  reason?: string;
};

export function inBookletRange(invoiceNo: number, range: BookletRange): boolean {
  return Number.isInteger(invoiceNo) && invoiceNo >= range.seriesFrom && invoiceNo <= range.seriesTo;
}

export function formatBookletNumber(invoiceNo: number): string {
  if (!Number.isFinite(invoiceNo) || invoiceNo < 0) return String(invoiceNo);
  return String(invoiceNo).padStart(3, "0");
}

/**
 * Parse a staff-entered booklet serial. Accepts plain digits (optional leading
 * zeros) or an optional SI/DR/CR prefix. Rejects mixed OR text and patterns
 * like "12-3" that would otherwise collapse onto the wrong serial.
 */
export function parseBookletSerial(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/^(?:(?:SI|DR|CR)[\s-]*)?(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function bookletRangeError(
  invoiceNo: number,
  range: BookletRange,
  typePrefix = "SI",
): string | null {
  if (!Number.isInteger(invoiceNo) || invoiceNo < 1) return `Enter a whole booklet ${typePrefix} number.`;
  if (!inBookletRange(invoiceNo, range)) {
    return `${typePrefix} no. ${formatBookletNumber(invoiceNo)} is outside the booklet range ${formatBookletNumber(range.seriesFrom)}-${formatBookletNumber(range.seriesTo)} (between ${range.seriesFrom} and ${range.seriesTo}).`;
  }
  return null;
}

export function bookletLowStockWarning(typeName: string, freeCount: number): string | null {
  if (freeCount <= 50) {
    return `${typeName} booklet running low`;
  }
  return null;
}

/** Build the grid for Settings /billing/booklet. Numbers outside the range are omitted. */
export function bookletGrid(
  range: BookletRange,
  used: readonly UsedDocSlot[],
  spoiled: readonly SpoiledDocSlot[] = [],
  typeName = "Sales Invoice",
): {
  slots: BookletSlot[];
  nextFree: number | null;
  usedCount: number;
  voidedCount: number;
  spoiledCount: number;
  freeCount: number;
  warning: string | null;
} {
  const byNo = new Map(used.map((u) => [u.invoiceNo, u]));
  const bySpoiled = new Map(spoiled.map((s) => [s.number, s]));
  const slots: BookletSlot[] = [];
  let usedCount = 0;
  let voidedCount = 0;
  let spoiledCount = 0;
  let nextFree: number | null = null;

  for (let n = range.seriesFrom; n <= range.seriesTo; n++) {
    const sp = bySpoiled.get(n);
    if (sp) {
      spoiledCount += 1;
      slots.push({
        invoiceNo: n,
        status: "spoiled",
        spoiledId: sp.id,
        spoiledReason: sp.reason,
      });
      continue;
    }

    const row = byNo.get(n);
    if (!row) {
      slots.push({ invoiceNo: n, status: "free" });
      if (nextFree === null) nextFree = n;
      continue;
    }

    if (row.status === "VOID") {
      voidedCount += 1;
      slots.push({ invoiceNo: n, status: "voided", billingId: row.id, billingNumber: row.number });
    } else {
      usedCount += 1;
      slots.push({ invoiceNo: n, status: "used", billingId: row.id, billingNumber: row.number });
    }
  }

  const freeCount = range.seriesTo - range.seriesFrom + 1 - usedCount - voidedCount - spoiledCount;
  const warning = bookletLowStockWarning(typeName, freeCount);

  return { slots, nextFree, usedCount, voidedCount, spoiledCount, freeCount, warning };
}
