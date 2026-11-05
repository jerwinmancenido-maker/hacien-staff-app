import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Audit fixes 2026-11-05, wiring level. These pin the exact failure modes the
 * visual audit found (hardcoded ₱0.00, a missing link, a misleading label, a
 * stale "last activity", a contradictory card, unattributed register rows)
 * so a later edit cannot silently reintroduce them.
 */
describe("audit fix: supplier 'We owe' is wired, not hardcoded", () => {
  it("overview card renders the passed payable balance", () => {
    const f = src("src/components/SupplierOverview.tsx");
    expect(f).toContain("payableBalance");
    expect(f).toContain("formatPeso(payableBalance)");
    expect(f).not.toContain("formatPeso(0)");
  });

  it("supplier list shows the real owed amount and sorts by it", () => {
    const f = src("src/app/(app)/suppliers/page.tsx");
    expect(f).toContain("supplierPayableBalance(x.id)");
    expect(f).toContain("formatPeso(owed)");
    expect(f).toContain("owe: Number(owed)");
  });

  it("customer list shows the real balance due and sorts by it", () => {
    const f = src("src/app/(app)/customers/page.tsx");
    expect(f).toContain("customerArSnapshot(c.id)");
    expect(f).toContain("formatPeso(balanceDue)");
    expect(f).toContain("balance: Number(balanceDue)");
  });
});

describe("audit fix: collection cash take reserves room for prefilled withholding", () => {
  it("auto cash leaves the prefilled split inside the billing balance", () => {
    const f = src("src/components/billing/CollectionForm.tsx");
    expect(f).toContain("Math.max(0, bal - whSum)");
    expect(f).toContain("Math.min(reserve, acc.left)");
  });

  it("prefill follows the typed amount, not the mount-time amount", () => {
    // Regression: the page mounts with amountReceived "", so a mount-only
    // allocation always computed take 0 and wiped the prefilled split before
    // staff typed anything. The split must follow the typed amount, and rows
    // staff edited by hand must keep their values.
    const f = src("src/components/billing/CollectionForm.tsx");
    expect(f).toContain("onAmountChange");
    expect(f).toContain("computeAlloc(openBillings, Number(value) || 0)");
    expect(f).toContain("touched.has(i) ? row : fresh[i]!");
    expect(f).toContain("markTouched(i)");
  });
});

describe("audit fix: supplier statement print is linked", () => {
  it("overview card, list menu, and customer list menu link to the print", () => {
    expect(src("src/components/SupplierOverview.tsx")).toContain(
      "href={`/print/supplier-statements/${supplier.id}`}",
    );
    expect(src("src/app/(app)/suppliers/page.tsx")).toContain(
      "href: `/print/supplier-statements/${x.id}`",
    );
    expect(src("src/app/(app)/customers/page.tsx")).toContain("href: `/print/statements/${c.id}`");
  });
});

describe("audit fix: SO status chip says what it means", () => {
  it("detail page shows 'Fully billed & paid' instead of bare 'Completed'", () => {
    const f = src("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(f).toContain("Fully billed &amp; paid");
    expect(f).not.toContain('>Completed</Chip>');
  });
});

describe("audit fix: last activity counts transactions", () => {
  it("customer page looks at quote / SO / billing / collection / delivery changes", () => {
    const f = src("src/app/(app)/customers/[id]/page.tsx");
    for (const m of ["db.quote.findFirst", "db.salesOrder.findFirst", "db.billing.findFirst", "db.collection.findFirst", "db.delivery.findFirst"]) {
      expect(f).toContain(m);
    }
  });

  it("supplier page looks at PO / bill / payment / receiving changes", () => {
    const f = src("src/app/(app)/suppliers/[id]/page.tsx");
    for (const m of ["db.purchaseOrder.findFirst", "db.supplierBill.findFirst", "db.supplierPayment.findFirst", "db.receivingReport.findFirst"]) {
      expect(f).toContain(m);
    }
  });
});

describe("audit fix: billing 2307 card names both figures", () => {
  it("foot separates billings still missing a 2307 from certificates awaiting receipt", () => {
    const f = src("src/app/(app)/billing/page.tsx");
    expect(f).toContain("still need a 2307 recorded");
    expect(f).toContain("in certificates awaiting receipt");
  });
});

describe("audit fix: register rows name the documents their EWT belongs to", () => {
  it("collection rows list their billings and payment rows list their bills", () => {
    const f = src("src/lib/services/books.ts");
    expect(f).toContain("for ${billed.join(");
    expect(f).toContain("for ${paid.join(");
  });
});
