// Pre-printed booklet invoice numbers. The app records them; it never generates
// official invoice numbers. Voided numbers stay used (never reused).

export type BookletRange = { seriesFrom: number; seriesTo: number; label?: string | null };

export type BookletSlotStatus = "free" | "used" | "voided";

export type BookletSlot = {
  invoiceNo: number;
  status: BookletSlotStatus;
  billingId?: string;
  billingNumber?: string;
};

export function inBookletRange(invoiceNo: number, range: BookletRange): boolean {
  return Number.isInteger(invoiceNo) && invoiceNo >= range.seriesFrom && invoiceNo <= range.seriesTo;
}

export function bookletRangeError(invoiceNo: number, range: BookletRange): string | null {
  if (!Number.isInteger(invoiceNo) || invoiceNo < 1) return "Enter a whole booklet invoice number.";
  if (!inBookletRange(invoiceNo, range)) {
    return `Booklet invoice number must be between ${range.seriesFrom} and ${range.seriesTo}.`;
  }
  return null;
}

/** Build the grid for Settings /billing/booklet. Numbers outside the range are omitted. */
export function bookletGrid(
  range: BookletRange,
  used: readonly { invoiceNo: number; id: string; number: string; status: string }[],
): { slots: BookletSlot[]; nextFree: number | null; usedCount: number; voidedCount: number; freeCount: number } {
  const byNo = new Map(used.map((u) => [u.invoiceNo, u]));
  const slots: BookletSlot[] = [];
  let usedCount = 0;
  let voidedCount = 0;
  let nextFree: number | null = null;
  for (let n = range.seriesFrom; n <= range.seriesTo; n++) {
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
  const freeCount = range.seriesTo - range.seriesFrom + 1 - usedCount - voidedCount;
  return { slots, nextFree, usedCount, voidedCount, freeCount };
}
