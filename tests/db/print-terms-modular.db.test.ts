// Modular terms block on the quote and SO prints (lawyer & CPA sign-off
// 2026-11-06) against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=<redacted>
//
// The printed block follows the quote: point 2 matches the payment terms,
// point 3 takes the per-quote lead time, point 5 has goods/services
// variants, point 6 prints only for business customers, point 7 stays on
// every quote. The SO carries the source quote's block.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { COD_POINT2_TEXT } from "@/lib/print/terms-block";
import { getQuotePrintModel, getSalesOrderPrintModel } from "@/lib/print/views";
import {
  approveQuote,
  convertQuoteToSalesOrder,
  createQuote,
} from "@/lib/services/quotes";
import {
  customerDeliveryAddressId,
  freshYear,
  makeCustomer,
  makeUser,
  quoteInput,
  tag,
} from "./fixtures";

describe.skipIf(!hasDb)("modular terms block on quote and SO prints (MySQL)", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-print-terms-uploads-"));
    [admin] = await Promise.all([makeUser("costs")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("goods quote prints the matching payment, lead time, 5A and point 6", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        terms: "Net 30 (approved accounts only)",
        leadTimeDays: 10,
      }),
      admin,
    );
    const model = await getQuotePrintModel(q.id);
    expect(model).not.toBeNull();
    const block = model!.doc.termsBlock!;
    expect(block).toHaveLength(7);
    expect(block[1]).toContain("2. Payment: Net 30 calendar days from delivery and invoice date");
    expect(block[2]).toContain("3. Estimated lead time: 10 business days from our order confirmation");
    expect(block[4]).toContain("5. Unless specific warranty notes");
    expect(block[4]).toContain("warranty is the manufacturer's or distributor's");
    expect(block[5]).toContain("6. If you withhold tax, tell us before paying and give us a signed BIR Form 2307 upon payment.");
    expect(block[6]).toContain("7. HACIEN keeps ownership of the goods until they are fully paid.");
    expect(block[6]).toContain("Full Terms of Sale apply: haciensolutions.com/terms-of-sale");
  });

  it("services-only quote for a private individual skips points 4 and 6 and uses 5B", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    await db.customer.update({ where: { id: customer.id }, data: { isIndividual: true } });
    const q = await createQuote(
      quoteInput(customer.id, year, {
        terms: "100% upfront (software and special orders)",
        items: [
          { id: null, description: "Setup service", kind: "SERVICES", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "0", unitPrice: "5000" },
        ],
      }),
      admin,
    );
    const model = await getQuotePrintModel(q.id);
    expect(model).not.toBeNull();
    const block = model!.doc.termsBlock!;
    expect(block).toHaveLength(5);
    expect(block.map((p) => p.split(".")[0])).toEqual(["1", "2", "3", "5", "7"]);
    expect(block[1]).toContain("2. Payment: 100% payment upon order confirmation");
    expect(block[2]).toContain("3. Lead times are estimates, not fixed deadlines, and are subject to supplier stock.");
    expect(block[3]).toContain("5. Unless specific warranty notes");
    expect(block[3]).toContain("services are performed in line with the agreed scope");
    expect(block[4]).toContain("7. HACIEN keeps ownership");
  });

  it("the SO carries the source quote's terms block", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        terms: "50% down, 50% on delivery",
        leadTimeDays: 7,
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      q.id,
      { buyerPoNo: `PO-TERMS-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 16)) },
    );
    const quoteModel = await getQuotePrintModel(q.id);
    const soModel = await getSalesOrderPrintModel(so.id);
    expect(soModel).not.toBeNull();
    expect(soModel!.doc.termsBlock).toEqual(quoteModel!.doc.termsBlock);
    expect(soModel!.doc.termsBlock![1]).toContain("2. Payment: 50% down payment upon order confirmation");
    expect(soModel!.doc.termsBlock![2]).toContain("3. Estimated lead time: 7 business days");
  });

  it("COD quote prints the COD Point 2, a generated COD Remarks row, and guarded notes", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        terms: "COD",
        notes: "Deliver to Gate 3. Ask for Net 30 terms.",
      }),
      admin,
    );
    const model = await getQuotePrintModel(q.id);
    expect(model).not.toBeNull();
    // Remarks row is generated from the structured term.
    expect(model!.doc.terms).toBe("COD");
    const block = model!.doc.termsBlock!;
    expect(block).toHaveLength(7);
    expect(block[1]).toBe(`2. ${COD_POINT2_TEXT}`);
    expect(block.join(" ")).not.toContain("50% down payment when you order");
    expect(block.join(" ")).not.toContain("50% down payment upon order confirmation");
    // The free-text note's typed payment term never reaches the print.
    expect(model!.doc.notes).toBe("Deliver to Gate 3. Ask for terms.");
    // The SO carries the same COD block and Remarks row.
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(
      q.id,
      { buyerPoNo: `PO-COD-${tag()}`, deliveryAddressId },
      admin,
      { date: new Date(Date.UTC(year, 2, 16)) },
    );
    const soModel = await getSalesOrderPrintModel(so.id);
    expect(soModel).not.toBeNull();
    expect(soModel!.doc.terms).toBe("COD");
    expect(soModel!.doc.termsBlock).toEqual(block);
  });

  it("custom-terms quote prints its own text with the Option 3A anti-fraud sentence", async () => {
    const year = await freshYear();
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        terms: "30% on order, 40% on delivery, 30% within 15 days of acceptance",
      }),
      admin,
    );
    const model = await getQuotePrintModel(q.id);
    expect(model).not.toBeNull();
    expect(model!.doc.termsBlock![1]).toBe(
      "2. Payment: 30% on order, 40% on delivery, 30% within 15 days of acceptance. Pay by bank transfer, check or cash, only to the account printed on this document (or to our authorized representative against an official HACIEN Sales Invoice or Collection Receipt).",
    );
    expect(model!.doc.termsBlock!.join(" ")).not.toContain("50% down payment when you order");
  });
});
