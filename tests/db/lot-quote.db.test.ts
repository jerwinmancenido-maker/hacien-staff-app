// Lot (bundle) lines, Phase B1 — DB: creating a quote with a lot line
// persists its components and costs the line from them; editing replaces
// the component set (soft-remove, never delete); copying a quote carries
// the components along.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { copyQuote, createQuote, updateQuote, type DocActor } from "@/lib/services/quotes";
import { makeCustomer, makeSupplier, makeUser, quoteInput } from "./fixtures";

describe("lot quote lines (db)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const lotItems = (supA: string, supB: string, secondCost = "50000") => [
    {
      id: null,
      description: "Google Cloud Platform Services",
      kind: "SERVICES" as const,
      qty: "1",
      unit: "lot",
      supplierId: null,
      supplierUnitCost: "0",
      unitPrice: "600000",
      isLot: true,
      components: [
        { id: null, itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: supA, unitCost: "300000" },
        { id: null, itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: supB, unitCost: secondCost },
      ],
    },
  ];

  async function loadItem(quoteId: string) {
    return db.quoteItem.findFirstOrThrow({
      where: { quoteId, removedAt: null },
      include: { components: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
  }

  it("creates a lot line with components and component-driven totals", async () => {
    const customer = await makeCustomer();
    const supA = await makeSupplier();
    const supB = await makeSupplier();
    const q = await createQuote(quoteInput(customer.id, 2026, { items: lotItems(supA.id, supB.id) }), admin);

    const item = await loadItem(q.id);
    expect(item.isLot).toBe(true);
    expect(item.components).toHaveLength(2);
    expect(item.components[0]!.supplierId).toBe(supA.id);
    expect(item.components[1]!.supplierId).toBe(supB.id);
    expect(item.supplierTotal.toFixed(2)).toBe("400000.00");
    expect(item.margin.toFixed(2)).toBe("200000.00");
    expect(item.supplierUnitCost.toFixed(2)).toBe("0.00");
    const stored = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(stored.supplierCost.toFixed(2)).toBe("400000.00");
    expect(stored.contractPrice.toFixed(2)).toBe("600000.00");
  });

  it("editing a lot replaces its components (old set soft-removed)", async () => {
    const customer = await makeCustomer();
    const supA = await makeSupplier();
    const supB = await makeSupplier();
    const q = await createQuote(quoteInput(customer.id, 2026, { items: lotItems(supA.id, supB.id) }), admin);
    const before = await loadItem(q.id);

    const edited = lotItems(supA.id, supB.id, "75000");
    edited[0]!.id = before.id as never;
    await updateQuote(q.id, quoteInput(customer.id, 2026, { items: edited }), admin);

    const after = await loadItem(q.id);
    expect(after.components).toHaveLength(2);
    expect(after.supplierTotal.toFixed(2)).toBe("450000.00");
    // The replaced rows still exist, soft-removed; nothing was hard-deleted.
    const removed = await db.quoteItemComponent.count({ where: { quoteItemId: before.id, removedAt: { not: null } } });
    expect(removed).toBe(2);
    const all = await db.quoteItemComponent.count({ where: { quoteItemId: before.id } });
    expect(all).toBe(4);
  });

  it("copying a quote carries the lot and its components", async () => {
    const customer = await makeCustomer();
    const supA = await makeSupplier();
    const supB = await makeSupplier();
    const q = await createQuote(quoteInput(customer.id, 2026, { items: lotItems(supA.id, supB.id) }), admin);
    const copy = await copyQuote(q.id, admin, 2);
    const item = await loadItem(copy.id);
    expect(item.isLot).toBe(true);
    expect(item.components).toHaveLength(2);
    expect(item.supplierTotal.toFixed(2)).toBe("400000.00");
  });
});
