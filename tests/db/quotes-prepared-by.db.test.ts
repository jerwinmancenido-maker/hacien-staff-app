// Quote "Prepared by" picker (2026-11-07) against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=<redacted>

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createQuote, updateQuote, type DocActor } from "@/lib/services/quotes";
import { getQuotePrintModel } from "@/lib/print/views";
import { getQuoteView } from "@/lib/quotes/views";
import { editorStaffUsers } from "@/app/(app)/quotes/editor-data";
import { freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

describe.skipIf(!hasDb)("quote prepared-by picker (MySQL)", () => {
  let creator: DocActor;
  let preparer: DocActor;
  let creatorName: string;
  let preparerName: string;
  let year: number;

  beforeAll(async () => {
    [creator, preparer] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    const [cRow, pRow] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: creator.id }, select: { name: true } }),
      db.user.findUniqueOrThrow({ where: { id: preparer.id }, select: { name: true } }),
    ]);
    creatorName = cRow.name;
    preparerName = pRow.name;
    year = await freshYear();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeQuote(preparedById?: string | null) {
    const customer = await makeCustomer();
    return createQuote(quoteInput(customer.id, year, { preparedById }), creator);
  }

  function metaPrepared(doc: { meta: { label: string; value: string | null }[] }) {
    return doc.meta.find((m) => m.label === "Prepared by")?.value ?? null;
  }

  it("create with no preparer stores the creator, and the print shows the creator", async () => {
    const q = await makeQuote();
    expect(q.preparedById).toBe(creator.id);
    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(metaPrepared(doc)).toBe(creatorName);
    expect(doc.signatories?.[0]?.role).toBe("Prepared by");
    expect(doc.signatories?.[0]?.name).toBe(creatorName);
  });

  it("create with a preparer stores it, and the print shows the preparer, not the creator", async () => {
    const q = await makeQuote(preparer.id);
    expect(q.preparedById).toBe(preparer.id);
    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(metaPrepared(doc)).toBe(preparerName);
    expect(doc.signatories?.[0]?.name).toBe(preparerName);
    const view = await getQuoteView(q.id, creator);
    expect(view?.preparedById).toBe(preparer.id);
    expect(view?.preparedBy).toBe(preparerName);
  });

  it("update can change the preparer, and null goes back to the creator on the print", async () => {
    const q = await makeQuote();
    const changed = await updateQuote(q.id, quoteInput(q.customerId, year, { preparedById: preparer.id }), creator);
    expect(changed.preparedById).toBe(preparer.id);
    const cleared = await updateQuote(q.id, quoteInput(q.customerId, year, { preparedById: null }), creator);
    expect(cleared.preparedById).toBeNull();
    const { doc } = (await getQuotePrintModel(q.id))!;
    expect(metaPrepared(doc)).toBe(creatorName);
    expect(doc.signatories?.[0]?.name).toBe(creatorName);
  });

  it("update with no preparer field keeps the stored preparer", async () => {
    const q = await makeQuote(preparer.id);
    const kept = await updateQuote(q.id, quoteInput(q.customerId, year, {}), creator);
    expect(kept.preparedById).toBe(preparer.id);
  });

  it("update to an unknown user is refused", async () => {
    const q = await makeQuote();
    await expect(updateQuote(q.id, quoteInput(q.customerId, year, { preparedById: "cmissinguser0000000000000" }), creator)).rejects.toThrow(
      DocRuleError,
    );
  });

  it("update to a turned-off user is refused", async () => {
    const off = await makeUser("staff");
    await db.user.update({ where: { id: off.id }, data: { active: false } });
    const q = await makeQuote();
    await expect(updateQuote(q.id, quoteInput(q.customerId, year, { preparedById: off.id }), creator)).rejects.toThrow(
      DocRuleError,
    );
  });

  it("a stored preparer who was turned off since can stay, and the picker still lists them", async () => {
    const off = await makeUser("staff");
    const q = await makeQuote(off.id);
    await db.user.update({ where: { id: off.id }, data: { active: false } });
    // Saving the quote without changing the preparer still works.
    const kept = await updateQuote(q.id, quoteInput(q.customerId, year, {}), creator);
    expect(kept.preparedById).toBe(off.id);
    // The picker keeps the stored preparer listed so the editor can show it.
    const staffUsers = await editorStaffUsers(q.preparedById);
    expect(staffUsers.some((u) => u.id === off.id)).toBe(true);
    expect(staffUsers.some((u) => u.id === creator.id)).toBe(true);
    expect(staffUsers.some((u) => u.id === preparer.id)).toBe(true);
  });
});
