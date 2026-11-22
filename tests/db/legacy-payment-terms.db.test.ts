// Old records may still carry payment terms outside the current HACIEN
// defaults (e.g. Net 15). Those values must load, print, and remain editable.
// (COD itself left this legacy class on 2026-11-23: it is now a first-class
// structured term in the defaults, with its own Point 2 in terms-block.ts.)

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { getQuotePrintModel, getSalesOrderPrintModel } from "@/lib/print/views";
import { approveQuote, createQuote, convertQuoteToSalesOrder, updateQuote } from "@/lib/services/quotes";
import { saveCustomer } from "@/lib/services/companies";
import { customerSchema } from "@/lib/validation/companies";
import { customerDeliveryAddressId, freshYear, makeUser, quoteInput, tag } from "./fixtures";

const NEW_TERMS = DEFAULT_SETTINGS.lists.paymentTerms;
const LEGACY = "Net 15";

describe.skipIf(!hasDb)("legacy payment terms outside the current options (MySQL)", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    admin = await makeUser("costs");
    expect(NEW_TERMS).not.toContain(LEGACY);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("keeps Net 15 on load, print, and edit/save when the saved term is merged into allowed terms", async () => {
    const year = await freshYear();
    const name = `Legacy Net 15 Customer ${tag()}`;
    // Seed a pre-migration-style customer whose terms are outside today's list.
    const customer = await db.customer.create({
      data: {
        name,
        withholdingType: "NONE",
        defaultWithholding: [],
        defaultTerms: LEGACY,
        address: "Sample address",
      },
    });

    const loaded = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(loaded.defaultTerms).toBe(LEGACY);

    const baseFields = {
      name: loaded.name,
      tin: "",
      withholdingType: "NONE" as const,
      defaultWithholding: [] as string[],
      defaultTerms: LEGACY,
      notes: "",
    };

    // Without merging the saved term, validation fails (new list only).
    expect(customerSchema(NEW_TERMS).safeParse(baseFields).success).toBe(false);

    // Edit path (customers/actions.ts): allow the existing saved term.
    const allowed = [...NEW_TERMS, LEGACY];
    const parsed = customerSchema(allowed).safeParse({
      ...baseFields,
      name: `${loaded.name} Edited`,
    });
    expect(parsed.success).toBe(true);
    const saved = await saveCustomer(customer.id, parsed.data!, admin.id);
    expect(saved.defaultTerms).toBe(LEGACY);
    expect(saved.name).toBe(`${loaded.name} Edited`);

    const q = await createQuote(quoteInput(customer.id, year, { terms: LEGACY }), admin);
    expect(q.terms).toBe(LEGACY);

    // Update keeps the legacy term on the document.
    const updated = await updateQuote(
      q.id,
      quoteInput(customer.id, year, { terms: LEGACY, notes: "still Net 15" }),
      admin,
    );
    expect(updated.terms).toBe(LEGACY);

    const quotePrint = await getQuotePrintModel(q.id);
    expect(quotePrint?.doc.terms).toBe(LEGACY);
    expect(JSON.stringify(quotePrint?.doc)).toContain(LEGACY);

    await approveQuote(q.id, admin);
    const so = await convertQuoteToSalesOrder(
      q.id,
      { buyerPoNo: "PO-1", deliveryAddressId: await customerDeliveryAddressId(customer.id) },
      admin,
    );
    expect(so.terms).toBe(LEGACY);
    const soPrint = await getSalesOrderPrintModel(so.id);
    expect(soPrint?.doc.terms).toBe(LEGACY);
    expect(JSON.stringify(soPrint?.doc)).toContain(LEGACY);
  });
});
