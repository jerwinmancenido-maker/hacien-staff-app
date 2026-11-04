// S-50: returns to supplier (RMA) with optional credit note.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReturn } from "@/lib/purchasing/returns";
import { returnInputSchema } from "@/lib/validation/purchasing";

const src = (p: string) => readFileSync(p, "utf8");
const lines = [
  { id: "l1", description: "Widget\nExtra", receivedQty: "10.00" },
  { id: "l2", description: "Gadget", receivedQty: "0.00" },
];

describe("S-50 return quantity check", () => {
  it("accepts a return within what was received", () => {
    const r = checkReturn(lines, [{ lineId: "l1", qty: "3" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toEqual([{ lineId: "l1", qty: "3.00" }]);
  });

  it("rejects returning more than received", () => {
    const r = checkReturn(lines, [{ lineId: "l1", qty: "11" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.l1).toContain("Only 10 received");
  });

  it("skips blank and zero quantities, and requires at least one line", () => {
    expect(checkReturn(lines, [{ lineId: "l1", qty: "" }]).ok).toBe(false);
    expect(checkReturn(lines, [{ lineId: "l1", qty: "0" }]).ok).toBe(false);
    const mixed = checkReturn(lines, [
      { lineId: "l1", qty: "" },
      { lineId: "l2", qty: "0" },
    ]);
    expect(mixed.ok).toBe(false);
  });

  it("rejects unknown and duplicate lines", () => {
    expect(checkReturn(lines, [{ lineId: "nope", qty: "1" }]).ok).toBe(false);
    expect(
      checkReturn(lines, [
        { lineId: "l1", qty: "1" },
        { lineId: "l1", qty: "1" },
      ]).ok,
    ).toBe(false);
  });
});

describe("S-50 return input", () => {
  const base = { returnDate: "2026-11-04", reason: "", lines: [{ lineId: "l1", qty: "2" }] };

  it("accepts a return with or without a credit note", () => {
    const withNote = returnInputSchema.safeParse({ ...base, creditNoteNumber: "CN-9", creditNoteAmount: "1,500.00" });
    expect(withNote.success).toBe(true);
    if (withNote.success) {
      expect(withNote.data.creditNoteNumber).toBe("CN-9");
      expect(withNote.data.creditNoteAmount).toBe("1500.00");
    }
    const without = returnInputSchema.safeParse(base);
    expect(without.success).toBe(true);
    if (without.success) {
      expect(without.data.creditNoteNumber).toBeNull();
      expect(without.data.creditNoteAmount).toBeNull();
    }
  });

  it("rejects a zero or negative credit note amount", () => {
    expect(returnInputSchema.safeParse({ ...base, creditNoteAmount: "0" }).success).toBe(false);
    expect(returnInputSchema.safeParse({ ...base, creditNoteAmount: "-5" }).success).toBe(false);
  });
});

describe("S-50 UI + migration", () => {
  it("PO page has a Returns tab and the return form posts quantities", () => {
    const page = src("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(page).toContain('"returns"');
    expect(page).toContain("Returns to supplier");
    expect(src("src/components/purchasing/PoActions.tsx")).toContain("Return items");
    expect(src("src/components/purchasing/ReturnForm.tsx")).toContain("Return now");
    expect(src("src/components/purchasing/ReturnForm.tsx")).toContain("Reference only");
  });

  it("migration creates the return tables and extends the doc series enum", () => {
    const sql = src("prisma/migrations/20261104220000_s50_supplier_returns/migration.sql");
    expect(sql).toContain("CREATE TABLE `SupplierReturn`");
    expect(sql).toContain("CREATE TABLE `SupplierReturnItem`");
    expect(sql).toContain("'SUPPLIER_RETURN'");
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
