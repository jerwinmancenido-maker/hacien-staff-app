// Staging QA 2026-11-11 fixes (FINISH REPORT 22:03 PHT):
// 1. #193 markers: SOs converted before the quoteItemId stamp existed
//    (SO-2026-0006) showed no Changed markers despite a real change. The
//    view now falls back to matching quote lines by sortOrder when (and
//    only when) the line counts still agree.
// 2. #186: Documents-tab numbers must open a NEW tab (QA requirement);
//    PO editor header textareas (Notes + the two address boxes) must
//    auto-grow like the line descriptions already do.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const views = readFileSync("src/lib/quotes/views.ts", "utf8");
const soPage = readFileSync("src/app/(app)/sales-orders/[id]/page.tsx", "utf8");
const poEditor = readFileSync("src/components/purchasing/PoEditor.tsx", "utf8");

describe("#193 marker fallback for pre-stamp conversions", () => {
  it("falls back only when no stamped quote items resolved", () => {
    expect(views).toContain("if (!quoteItems.length && so.items.length > 0)");
    expect(views).toContain("where: { quoteId: so.quote.id, removedAt: null }");
  });

  it("requires equal counts, unique sortOrders, and description match at each sortOrder", () => {
    expect(views).toContain("if (all.length === so.items.length)");
    expect(views).toContain("bySort.size === all.length");
    expect(views).toContain("soBySort.size === so.items.length");
    expect(views).toContain("const q = bySort.get(i.sortOrder);");
    expect(views).toContain("q.description !== i.description");
  });
});

describe("#186 Documents numbers open a new tab", () => {
  it("all five number links carry target=_blank", () => {
    for (const frag of [
      'href={`/quotes/${so.quote.id}`} target="_blank"',
      'href={`/billing/billings/${b.id}`} target="_blank"',
      'href={`/billing/collections/${c.id}`} target="_blank"',
      'href={`${base}?tab=deliveries`} target="_blank"',
      'href={`/purchase-orders/${p.id}`} target="_blank"',
    ]) {
      expect(soPage).toContain(frag);
    }
  });

  it("the Overview source-quote line is untouched (not part of the QA finding)", () => {
    expect(soPage).toContain("<Link href={`/quotes/${so.quote.id}`}>{so.quote.number}</Link> <QuoteStatusChip");
  });
});

describe("#186 PO editor header textareas auto-grow", () => {
  it("GrowTextarea wraps growDesc and is used for notes + both address boxes", () => {
    expect(poEditor).toContain("function GrowTextarea(");
    expect(poEditor).toContain('<GrowTextarea id="notes"');
    expect(poEditor).toContain('<GrowTextarea id="deliveryAddressText"');
    expect(poEditor).toContain('<GrowTextarea id="supplierAddressText"');
    expect(poEditor).not.toContain('<textarea id="notes"');
  });
});
