// S-48: serial numbers on receiving lines and delivery (DR) lines, plus
// search by serial on the Receiving and Sales Orders lists.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSerialNumbers } from "@/lib/serials";
import { receiptInputSchema } from "@/lib/validation/purchasing";
import { parseDeliveryForm } from "@/lib/validation/deliveries";

const src = (p: string) => readFileSync(p, "utf8");

describe("S-48 serial normalization", () => {
  it("joins comma- and newline-separated serials, trims, drops empties", () => {
    expect(normalizeSerialNumbers(" SN1 ,SN2\nSN3 ,, ")).toBe("SN1, SN2, SN3");
    expect(normalizeSerialNumbers("")).toBeNull();
    expect(normalizeSerialNumbers(undefined)).toBeNull();
    expect(normalizeSerialNumbers("  ")).toBeNull();
  });
});

describe("S-48 receipt + delivery input", () => {
  it("accepts receipt lines with or without serials", () => {
    const parsed = receiptInputSchema.safeParse({
      receivedDate: "2026-11-04",
      receivedById: "u1",
      deliveryRef: "",
      notes: "",
      lines: [
        { lineId: "l1", qty: "2", serialNumbers: "A1, A2" },
        { lineId: "l2", qty: "1" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lines[0]?.serialNumbers).toBe("A1, A2");
      expect(parsed.data.lines[1]?.serialNumbers).toBeUndefined();
    }
  });

  it("aligns delivery itemSerials with itemId/itemQty in form order", () => {
    const form = new FormData();
    form.append("drNumber", "DR-1");
    form.append("deliveryDate", "2026-11-04");
    form.append("itemId", "i1");
    form.append("itemQty", "1");
    form.append("itemSerials", "SN-100");
    form.append("itemId", "i2");
    form.append("itemQty", "2");
    form.append("itemSerials", "");
    const parsed = parseDeliveryForm(form);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.items[0]?.serialNumbers).toBe("SN-100");
      expect(parsed.data.items[1]?.serialNumbers).toBe("");
    }
  });
});

describe("S-48 UI + search", () => {
  it("receiving form posts serials per line", () => {
    const s = src("src/components/purchasing/ReceiveForm.tsx");
    expect(s).toContain("serialNumbers: serials[l.id]");
    expect(s).toContain('aria-label={`Serial numbers: ${l.description}`}');
  });

  it("receiving reports and delivered items show serials", () => {
    expect(src("src/components/purchasing/RrTable.tsx")).toContain("Serials: {x.serialNumbers}");
    expect(src("src/components/sales-orders/DeliverySection.tsx")).toContain("Serials: {item.serialNumbers}");
    expect(src("src/components/sales-orders/DeliverySection.tsx")).toContain('name="itemSerials"');
  });

  it("Receiving and Sales Orders searches match serial numbers", () => {
    expect(src("src/lib/purchasing/views.ts")).toContain("serialNumbers: { contains: q }");
    expect(src("src/lib/quotes/views.ts")).toContain("deliveries: { some: { items: { some: { serialNumbers: { contains: q } } } } }");
    expect(src("src/app/(app)/receiving/page.tsx")).toContain("serial");
    expect(src("src/app/(app)/sales-orders/page.tsx")).toContain("serial");
  });

  it("migration adds both columns, additive only", () => {
    const sql = src("prisma/migrations/20261104200000_s48_serial_numbers/migration.sql");
    expect(sql).toContain("ALTER TABLE `ReceivingReportItem` ADD COLUMN `serialNumbers`");
    expect(sql).toContain("ALTER TABLE `DeliveryItem` ADD COLUMN `serialNumbers`");
    expect(sql).not.toMatch(/DROP|RENAME/i);
  });
});
