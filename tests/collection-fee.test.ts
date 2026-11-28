// Collection fee capture (REQ-COLLECTION-FEES-001): an optional fee the
// channel kept out of a collection. Source + pure-helper tests; the money
// cases live in tests/db/collection-fee.db.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectionFeeError, collectionFeeExpenseNotes } from "@/lib/services/collections";
import { collectionInputSchema, parseCollectionForm } from "@/lib/validation/billing";

const read = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("collectionFeeError (pure bounds)", () => {
  it("accepts no fee and a fee below the amount collected", () => {
    expect(collectionFeeError("0.00", "1000.00")).toBeNull();
    expect(collectionFeeError("25.50", "1000.00")).toBeNull();
  });

  it("accepts a fee equal to the amount collected", () => {
    expect(collectionFeeError("1000.00", "1000.00")).toBeNull();
  });

  it("refuses a fee above the amount collected, in plain words", () => {
    expect(collectionFeeError("1000.01", "1000.00")).toBe(
      "Collection fee can't be more than the amount received (₱1000.00). Lower the fee.",
    );
  });

  it("refuses a negative fee", () => {
    expect(collectionFeeError("-1.00", "1000.00")).toBe("Collection fee can't be negative.");
  });
});

describe("collectionFeeExpenseNotes (fingerprint)", () => {
  it("names the collection and the billing it settled", () => {
    expect(collectionFeeExpenseNotes("CR-2026-0008", ["BL-2026-0003"])).toBe(
      "Collection fee withheld from collection - collection CR-2026-0008, billing BL-2026-0003.",
    );
  });

  it("lists every billing when a collection settles more than one", () => {
    expect(collectionFeeExpenseNotes("CR-2026-0009", ["BL-2026-0003", "BL-2026-0004"])).toBe(
      "Collection fee withheld from collection - collection CR-2026-0009, billing BL-2026-0003, BL-2026-0004.",
    );
  });

  it("omits the billing part for an unallocated collection", () => {
    expect(collectionFeeExpenseNotes("CR-2026-0010", [])).toBe(
      "Collection fee withheld from collection - collection CR-2026-0010.",
    );
  });
});

describe("collection input carries the fee", () => {
  const base = {
    customerId: "cust-1",
    date: "2026-11-27",
    method: "GCASH" as const,
    reference: "REF-1",
    checkBank: "",
    checkDate: "",
    receiptNo: "",
    amountReceived: "1000.00",
    notes: "",
    allocations: [],
  };

  it("blank fee parses to 0 (no fee)", () => {
    const parsed = collectionInputSchema.parse({ ...base, feeAmount: "" });
    expect(parsed.feeAmount).toBe("0");
  });

  it("absent fee stays undefined so the service defaults it to 0", () => {
    const parsed = collectionInputSchema.parse({ ...base });
    expect(parsed.feeAmount).toBeUndefined();
  });

  it("a typed fee is carried through", () => {
    const parsed = collectionInputSchema.parse({ ...base, feeAmount: "25.50" });
    expect(parsed.feeAmount).toBe("25.50");
  });

  it("the form parser reads the feeAmount field", () => {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      customerId: "cust-1",
      date: "2026-11-27",
      method: "GCASH",
      reference: "REF-1",
      amountReceived: "1000.00",
      feeAmount: "25.50",
    })) {
      form.set(k, v);
    }
    const parsed = parseCollectionForm(form);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.feeAmount).toBe("25.50");
  });
});

describe("collection fee wiring (source)", () => {
  // NB-CD: the single fee field was generalised into the Deductions
  // section (the fee is now a FEE deduction row). The service-level fee
  // behaviour this file covers is unchanged — feeAmount still parses and
  // still syncs — so this wiring check now asserts the deductions shape.
  it("the record-collection form captures the fee as a deduction row", () => {
    const src = read("src/components/billing/CollectionForm.tsx");
    expect(src).toContain('name="deductionKind"');
    expect(src).toContain('name="deductionAmount"');
    expect(src).toContain("Deductions");
  });

  it("the schema stores the fee and its expense link on the collection", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("feeAmount");
    expect(schema).toContain("feeExpenseId");
    expect(read("prisma/migrations/20261127234500_collection_fee/migration.sql")).toContain(
      "ADD COLUMN `feeAmount`",
    );
  });

  it("voiding a collection voids its fee expense with it", () => {
    const src = read("src/lib/services/collections.ts");
    expect(src).toContain("Voided with collection ${before.number}");
    expect(src).toContain("feeExpense: true");
  });
});
