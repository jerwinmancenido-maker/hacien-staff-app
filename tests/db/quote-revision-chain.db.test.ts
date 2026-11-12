// Phase 2 #5 (db): copyQuote stamps the revision chain — a new revision
// stores the Rev 1 quote's id, a revision of a revision keeps the same
// root, and a plain duplicate (Rev 1) joins no chain. The quote view then
// exposes the whole chain from any member.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { copyQuote, createQuote, type DocActor } from "@/lib/services/quotes";
import { getQuoteView } from "@/lib/quotes/views";
import { makeCustomer, makeUser, quoteInput } from "./fixtures";

describe("quote revision chain (db)", () => {
  let admin: DocActor;

  beforeAll(async () => {
    admin = await makeUser("costs");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("stamps the chain root on new revisions and exposes it in the view", async () => {
    const customer = await makeCustomer();
    const q1 = await createQuote(quoteInput(customer.id, 2026), admin);
    expect(q1.revisionChainId).toBeNull();

    const q2 = await copyQuote(q1.id, admin, 2);
    expect(q2.revisionChainId).toBe(q1.id);

    const q3 = await copyQuote(q2.id, admin, 3);
    expect(q3.revisionChainId).toBe(q1.id);

    const view = await getQuoteView(q3.id, admin);
    expect(view).not.toBeNull();
    expect(view!.revisionChain.map((e) => (e.kind === "quote" ? e.revision : "deleted"))).toEqual([1, 2, 3]);
    expect(view!.revisionChain.map((e) => (e.kind === "quote" ? e.isCurrent : false))).toEqual([false, false, true]);

    const rootView = await getQuoteView(q1.id, admin);
    expect(rootView!.revisionChain).toHaveLength(3);
  });

  it("a plain duplicate (Rev 1) starts no chain", async () => {
    const customer = await makeCustomer();
    const q1 = await createQuote(quoteInput(customer.id, 2026), admin);
    const dup = await copyQuote(q1.id, admin, 1);
    expect(dup.revisionChainId).toBeNull();
    const view = await getQuoteView(dup.id, admin);
    expect(view!.revisionChain).toEqual([]);
  });
});
