import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Audit C: billing before any delivery warns (never blocks). The warning
// shows on the record-billing form and the fact is noted in the audit
// trail (see tests/db/billing-delivery-warning.db.test.ts).

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("Audit C billing before delivery warning", () => {
  it("the billing form shows a warn notice when nothing was delivered", () => {
    const src = read("src/components/billing/BillingForm.tsx");
    expect(src).toContain("deliveryWarning");
    expect(src).toContain('className="alert warn"');
    expect(src).toContain("Nothing has been delivered on this order yet");
    expect(src).toContain("payment-first");
  });

  it("the new-billing page passes the warning when no delivery exists", () => {
    const src = read("src/app/(app)/billing/billings/new/page.tsx");
    expect(src).toContain("delivery.count");
    expect(src).toContain("voidedAt: null");
    expect(src).toContain("deliveryWarning={deliveredCount === 0}");
  });

  it("recordBilling notes billed-before-delivery in the SO audit row", () => {
    const src = read("src/lib/services/billings.ts");
    expect(src).toContain("billedBeforeDelivery");
  });
});
