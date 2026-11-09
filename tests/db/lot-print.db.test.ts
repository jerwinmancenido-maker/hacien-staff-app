// Lot prints — DB: the quote and sales-order print models carry the lot
// components' DESCRIPTIONS (owner decision 2026-11-09) and nothing else
// about them — no component costs, quantities or supplier ids anywhere
// in the print model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { getQuotePrintModel, getSalesOrderPrintModel } from "@/lib/print/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput } from "./fixtures";

describe("lot print models (db)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("quote and SO print models list component descriptions, with no cost data", async () => {
    const customer = await makeCustomer();
    const supA = await makeSupplier();
    const supB = await makeSupplier();
    const year = await freshYear();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
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
              { id: null, itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: supA.id, unitCost: "300000" },
              { id: null, itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: supB.id, unitCost: "47000" },
            ],
          },
          {
            id: null,
            description: "Laptop unit",
            kind: "GOODS" as const,
            qty: "1",
            unit: "pc",
            supplierId: supA.id,
            supplierUnitCost: "9000",
            unitPrice: "11000",
          },
        ],
      }),
      admin,
    );

    const quotePrint = await getQuotePrintModel(q.id);
    expect(quotePrint).not.toBeNull();
    const lotLine = quotePrint!.doc.items!.find((i) => i.description.includes("Google Cloud"));
    expect(lotLine?.components).toEqual(["GCP subscription", "Support hours"]);
    const plainLine = quotePrint!.doc.items!.find((i) => i.description === "Laptop unit");
    expect(plainLine?.components).toBeUndefined();

    await approveQuote(q.id, admin);
    const address = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "1 Print St, Pasig", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-PRINT-1", deliveryAddressId: address.id }, admin);

    const soPrint = await getSalesOrderPrintModel(so.id);
    expect(soPrint).not.toBeNull();
    const soLotLine = soPrint!.doc.items!.find((i) => i.description.includes("Google Cloud"));
    expect(soLotLine?.components).toEqual(["GCP subscription", "Support hours"]);

    // Leak check: no component cost or supplier identity anywhere in
    // either model's items (the lot's own price, 600000, is expected).
    // Scoped to items: the full model legitimately carries long numeric
    // strings elsewhere (e.g. the QR svg path data in the footer).
    for (const model of [quotePrint!.doc, soPrint!.doc]) {
      const json = JSON.stringify(model.items);
      expect(json).not.toContain("300000");
      expect(json).not.toContain("47000");
      expect(json).not.toContain(supA.id);
      expect(json).not.toContain(supB.id);
    }
  });
});
