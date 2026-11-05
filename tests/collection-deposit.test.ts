// Audit E: standalone deposit / advance collection. Source tests only;
// the money cases live in tests/db/collection-deposit.db.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("deposit / advance collection", () => {
  it("the record-collection form has a Deposit checkbox that hides the allocation table", () => {
    const src = read("src/components/billing/CollectionForm.tsx");
    expect(src).toContain('name="isDeposit"');
    expect(src).toContain("Deposit / advance");
    expect(src).toContain("isDeposit ? (");
    expect(src).toContain("Apply it to a billing later from Apply credit.");
  });

  it("a deposit with allocations is refused in the service", () => {
    const src = read("src/lib/services/collections.ts");
    expect(src).toContain("A deposit can't be allocated to a billing.");
    expect(src).toContain("input.isDeposit && input.allocations.length > 0");
  });

  it("the collection input accepts an isDeposit flag", () => {
    const src = read("src/lib/validation/billing.ts");
    expect(src).toContain('isDeposit: z.boolean().default(false)');
    expect(src).toContain('form.get("isDeposit") === "on"');
  });

  it("deposits are visible: list, detail, customer page, and statement", () => {
    const views = read("src/lib/billing/views.ts");
    expect(views).toContain("isDeposit: c.isDeposit");
    expect(views).toContain("customerDepositBalance");
    expect(views).toContain("deposits,");
    expect(read("src/app/(app)/billing/collections/page.tsx")).toContain("Deposit</Chip>");
    expect(read("src/app/(app)/billing/collections/[id]/page.tsx")).toContain("Deposit</Chip>");
    expect(read("src/app/(app)/customers/[id]/page.tsx")).toContain("Deposits held");
    expect(read("src/lib/print/views.ts")).toContain('line.isDeposit ? "Deposit" : "Collection"');
  });

  it("a deposit is its own balance, not the whole customer credit", () => {
    const src = read("src/lib/services/collections.ts");
    expect(src).toContain("export async function customerDepositBalance");
    expect(src).toContain("where: { customerId, status: \"POSTED\", isDeposit: true }");
  });
});
